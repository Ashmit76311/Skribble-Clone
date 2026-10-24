import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Room } from "../src/Room.js";
import { Player } from "../src/Player.js";
import { WordMode } from "@skribbl/shared";

function createMockIo() {
  const emitted: { room: string; event: string; data: any }[] = [];
  return {
    to: (room: string) => ({
      emit: (event: string, data: any) => {
        emitted.push({ room, event, data });
      },
    }),
    emit: (event: string, data: any) => {
      emitted.push({ room: "global", event, data });
    },
    _emitted: emitted,
  } as any;
}

const defaultSettings = {
  maxPlayers: 8,
  rounds: 3,
  drawTime: 60,
  wordCount: 3,
  hints: 2,
  wordMode: WordMode.Normal,
  isPublic: true,
};

describe("Ready-Up Logic", () => {
  test("Host is always serialized as ready", () => {
    const host = new Player("s1", "Alice");
    host.isHost = true;
    assert.equal(host.toJSON().isReady, true);

    const guest = new Player("s2", "Bob");
    assert.equal(guest.toJSON().isReady, false);
    guest.isReady = true;
    assert.equal(guest.toJSON().isReady, true);
  });

  test("startGame fails when fewer than 2 players", () => {
    const room = new Room("TEST1", defaultSettings);
    const host = new Player("s1", "Alice");
    room.addPlayer(host);
    const mockIo = createMockIo();

    const err = room.startGame(mockIo);
    assert.equal(err, "Need at least 2 players");
  });

  test("startGame fails when a connected non-host player is not ready", () => {
    const room = new Room("TEST2", defaultSettings);
    const host = new Player("s1", "Alice");
    const bob = new Player("s2", "Bob");
    room.addPlayer(host);
    room.addPlayer(bob);
    const mockIo = createMockIo();

    const err = room.startGame(mockIo);
    assert.equal(err, "Bob is not ready");
  });

  test("startGame succeeds when all non-host players are ready", () => {
    const room = new Room("TEST3", defaultSettings);
    const host = new Player("s1", "Alice");
    const bob = new Player("s2", "Bob");
    room.addPlayer(host);
    room.addPlayer(bob);
    bob.isReady = true;
    const mockIo = createMockIo();

    const err = room.startGame(mockIo);
    assert.equal(err, null);
    if (room.game) room.game.destroy();
  });

  test("disconnected players do not block startGame", () => {
    const room = new Room("TEST4", defaultSettings);
    const host = new Player("s1", "Alice");
    const bob = new Player("s2", "Bob");
    const charlie = new Player("s3", "Charlie");
    room.addPlayer(host);
    room.addPlayer(bob);
    room.addPlayer(charlie);

    bob.isReady = true;
    charlie.isConnected = false; // Charlie is offline and not ready
    const mockIo = createMockIo();

    const err = room.startGame(mockIo);
    assert.equal(err, null);
    if (room.game) room.game.destroy();
  });

  test("resetToLobby clears isReady flags", () => {
    const room = new Room("TEST5", defaultSettings);
    const host = new Player("s1", "Alice");
    const bob = new Player("s2", "Bob");
    room.addPlayer(host);
    room.addPlayer(bob);
    bob.isReady = true;

    room.resetToLobby();
    assert.equal(bob.isReady, false);
  });

  test("Socket integration: ready blocks and allows start via socket events", async () => {
    const { createServer } = await import("node:http");
    const { Server: SocketServer } = await import("socket.io");
    const { io: Client } = await import("socket.io-client");
    const { registerHandlers } = await import("../src/handlers.js");
    const { RoomManager } = await import("../src/RoomManager.js");
    const { SocketEvent } = await import("@skribbl/shared");

    const httpServer = createServer();
    const io = new SocketServer(httpServer);
    const manager = new RoomManager();
    registerHandlers(io, manager);

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as any).port;
    const url = `http://localhost:${port}`;

    const s1 = Client(url, { transports: ["websocket"], forceNew: true });
    const s2 = Client(url, { transports: ["websocket"], forceNew: true });

    await new Promise<void>((resolve) => s1.on("connect", () => resolve()));
    await new Promise<void>((resolve) => s2.on("connect", () => resolve()));

    // s1 creates room
    const createRes: any = await new Promise((resolve) => {
      s1.emit(
        SocketEvent.CreateRoom,
        { name: "HostAlice", settings: defaultSettings },
        resolve
      );
    });
    const roomCode = createRes.room.code;

    // s2 joins room
    await new Promise((resolve) => {
      s2.emit(SocketEvent.JoinRoom, { name: "Bob", code: roomCode }, resolve);
    });

    // s1 tries to start game before Bob is ready
    let errorMsg = "";
    s1.on(SocketEvent.Error, (data: any) => {
      errorMsg = data.message;
    });
    s1.emit(SocketEvent.StartGame);

    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(errorMsg, "Bob is not ready");

    // s2 readies up
    let s1ReceivedState: any = null;
    s1.on(SocketEvent.GameState, (data: any) => {
      s1ReceivedState = data;
    });
    s2.emit(SocketEvent.PlayerReady, { ready: true });

    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(s1ReceivedState);
    const bobInRoom = s1ReceivedState.room.players.find((p: any) => p.name === "Bob");
    assert.equal(bobInRoom?.isReady, true);

    // Now s1 starts game successfully
    errorMsg = "";
    let gameStarted = false;
    s2.on(SocketEvent.RoundStart, () => {
      gameStarted = true;
    });
    s1.emit(SocketEvent.StartGame);

    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(errorMsg, "");
    assert.equal(gameStarted, true);

    s1.disconnect();
    s2.disconnect();
    const testRoom = manager.getRoom(roomCode);
    if (testRoom?.game) testRoom.game.destroy();
    manager.deleteRoom(roomCode);
    io.close();
    httpServer.close();
  });
});
