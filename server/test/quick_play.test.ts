import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Server as SocketServer } from "socket.io";
import { io as Client } from "socket.io-client";
import { SocketEvent, GamePhase, WordMode, RoomSettings } from "@skribbl/shared";
import { Room } from "../src/Room.js";
import { Player } from "../src/Player.js";
import { RoomManager } from "../src/RoomManager.js";
import { registerHandlers } from "../src/handlers.js";

const defaultSettings: RoomSettings = {
  maxPlayers: 8,
  rounds: 3,
  drawTime: 60,
  wordCount: 3,
  hints: 2,
  wordMode: WordMode.Normal,
  isPublic: true,
  customWords: [],
  useCustomOnly: false,
};

describe("Quick Play Room Choice Unit Logic", () => {
  test("listPublicRooms returns eligible rooms and hides private, full, or in-game rooms", () => {
    const manager = new RoomManager();

    // 1. Eligible public room in lobby
    const r1 = manager.createRoom({ isPublic: true, maxPlayers: 8 });
    r1.addPlayer(new Player("s1", "Alice"));

    // 2. Private room in lobby
    const r2 = manager.createRoom({ isPublic: false, maxPlayers: 8 });
    r2.addPlayer(new Player("s2", "Bob"));

    // 3. Full public room
    const r3 = manager.createRoom({ isPublic: true, maxPlayers: 2 });
    r3.addPlayer(new Player("s3", "Charlie"));
    r3.addPlayer(new Player("s4", "Dave"));

    // 4. Public room that is playing
    const r4 = manager.createRoom({ isPublic: true, maxPlayers: 8 });
    r4.addPlayer(new Player("s5", "Eve"));
    r4.phase = GamePhase.DRAWING;

    const publicRooms = manager.listPublicRooms();
    assert.equal(publicRooms.length, 1);
    assert.equal(publicRooms[0].code, r1.code);
  });

  test("findQuickPlayRoom returns null when no candidate room exists", () => {
    const manager = new RoomManager();
    const result = manager.findQuickPlayRoom();
    assert.equal(result, null);
  });

  test("findQuickPlayRoom finds available public room and skips banned rooms", () => {
    const manager = new RoomManager();
    const r1 = manager.createRoom({ isPublic: true, maxPlayers: 8 });
    const host = new Player("s1", "Alice");
    r1.addPlayer(host);

    // Player not banned can find r1
    const found = manager.findQuickPlayRoom("player-2", "dev-2");
    assert.ok(found);
    assert.equal(found.code, r1.code);

    // If player deviceId is banned in r1, findQuickPlayRoom skips it
    r1.bannedIds.add("dev-2");
    const bannedSearch = manager.findQuickPlayRoom("player-2", "dev-2");
    assert.equal(bannedSearch, null);
  });
});

describe("Quick Play Socket Integration", () => {
  async function setupServer() {
    const httpServer = createServer();
    const io = new SocketServer(httpServer);
    const manager = new RoomManager();
    registerHandlers(io, manager);

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as any).port;
    const url = `http://localhost:${port}`;

    return {
      httpServer,
      io,
      manager,
      url,
      createClient: () =>
        Client(url, { transports: ["websocket"], forceNew: true }),
    };
  }

  test("empty name is rejected", async () => {
    const { httpServer, io, manager, createClient } = await setupServer();
    const s1 = createClient();
    await new Promise<void>((r) => s1.on("connect", () => r()));

    const res: any = await new Promise((r) =>
      s1.emit(SocketEvent.QuickPlay, { name: "   " }, r)
    );
    assert.equal(res.error, "Name is required");

    s1.disconnect();
    io.close();
    httpServer.close();
  });

  test("two quick play clicks land in the same room", async () => {
    const { httpServer, io, manager, createClient } = await setupServer();
    const s1 = createClient();
    const s2 = createClient();

    await Promise.all([
      new Promise<void>((r) => s1.on("connect", () => r())),
      new Promise<void>((r) => s2.on("connect", () => r())),
    ]);

    // s1 clicks Quick Play -> creates a new room
    const res1: any = await new Promise((r) =>
      s1.emit(SocketEvent.QuickPlay, { name: "PlayerOne" }, r)
    );
    assert.ok(res1.room);
    assert.ok(res1.token);
    assert.ok(res1.playerId);
    assert.equal(res1.room.players.length, 1);

    const roomCode1 = res1.room.code;

    // s2 clicks Quick Play -> joins the existing room
    let playerJoinedData: any = null;
    s1.on(SocketEvent.PlayerJoined, (data: any) => {
      playerJoinedData = data;
    });

    const res2: any = await new Promise((r) =>
      s2.emit(SocketEvent.QuickPlay, { name: "PlayerTwo" }, r)
    );
    assert.ok(res2.room);
    assert.equal(res2.room.code, roomCode1, "Both players should land in the same room");
    assert.equal(res2.room.players.length, 2);

    await new Promise((r) => setTimeout(r, 100));
    assert.ok(playerJoinedData, "s1 should receive player_joined event");
    assert.equal(playerJoinedData.player.name, "PlayerTwo");

    s1.disconnect();
    s2.disconnect();
    const testRoom = manager.getRoom(roomCode1);
    if (testRoom?.game) testRoom.game.destroy();
    manager.deleteRoom(roomCode1);
    io.close();
    httpServer.close();
  });

  test("when room is full, quick play creates a new room", async () => {
    const { httpServer, io, manager, createClient } = await setupServer();
    const s1 = createClient();
    const s2 = createClient();
    const s3 = createClient();

    await Promise.all([
      new Promise<void>((r) => s1.on("connect", () => r())),
      new Promise<void>((r) => s2.on("connect", () => r())),
      new Promise<void>((r) => s3.on("connect", () => r())),
    ]);

    // Host manually creates a public room with maxPlayers = 2
    const createRes: any = await new Promise((r) =>
      s1.emit(
        SocketEvent.CreateRoom,
        {
          name: "HostAlice",
          settings: { ...defaultSettings, maxPlayers: 2, isPublic: true },
        },
        r
      )
    );
    const fullRoomCode = createRes.room.code;

    // Second player joins room -> now 2/2 (full)
    await new Promise((r) =>
      s2.emit(SocketEvent.JoinRoom, { name: "Bob", code: fullRoomCode }, r)
    );

    // Third player clicks Quick Play -> should not join fullRoomCode, should create new room
    const res3: any = await new Promise((r) =>
      s3.emit(SocketEvent.QuickPlay, { name: "Charlie" }, r)
    );
    assert.ok(res3.room);
    assert.notEqual(res3.room.code, fullRoomCode, "Should not join the full room");
    assert.equal(res3.room.players.length, 1);

    s1.disconnect();
    s2.disconnect();
    s3.disconnect();
    [fullRoomCode, res3.room.code].forEach((c) => {
      const room = manager.getRoom(c);
      if (room?.game) room.game.destroy();
      manager.deleteRoom(c);
    });
    io.close();
    httpServer.close();
  });
});
