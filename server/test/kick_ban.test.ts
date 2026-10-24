import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Server as SocketServer } from "socket.io";
import { io as Client } from "socket.io-client";
import { SocketEvent, GamePhase, WordMode } from "@skribbl/shared";
import { Room } from "../src/Room.js";
import { Player } from "../src/Player.js";
import { RoomManager } from "../src/RoomManager.js";
import { registerHandlers } from "../src/handlers.js";

const defaultSettings = {
  maxPlayers: 8,
  rounds: 3,
  drawTime: 60,
  wordCount: 3,
  hints: 2,
  wordMode: WordMode.Normal,
  isPublic: true,
};

describe("Kick and Ban Unit Logic", () => {
  test("Room banPlayer records id, ip, and deviceId, and isBanned checks them", () => {
    const room = new Room("TEST1", defaultSettings);
    const p = new Player("s1", "BadActor", "1.2.3.4", "dev-123");

    assert.equal(room.isBanned(p.id), false);
    assert.equal(room.isBanned(undefined, "1.2.3.4"), false);

    room.banPlayer(p);

    assert.equal(room.isBanned(p.id), true);
    assert.equal(room.isBanned(undefined, "1.2.3.4"), true);
    assert.equal(room.isBanned(undefined, undefined, "dev-123"), true);
    assert.equal(room.isBanned("other-id", "5.6.7.8"), false);
  });

  test("addPlayer rejects banned players", () => {
    const room = new Room("TEST2", defaultSettings);
    const p1 = new Player("s1", "Alice");
    room.addPlayer(p1);

    const bad = new Player("s2", "Bob", "10.0.0.1");
    room.banPlayer(bad);

    const err = room.addPlayer(bad);
    assert.equal(err, "You are banned from this room");
  });
});

describe("Kick and Ban Socket Integration", () => {
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

  test("Non-host cannot kick, host cannot kick themselves", async () => {
    const { httpServer, io, manager, createClient } = await setupServer();
    const s1 = createClient();
    const s2 = createClient();

    await Promise.all([
      new Promise<void>((r) => s1.on("connect", () => r())),
      new Promise<void>((r) => s2.on("connect", () => r())),
    ]);

    const createRes: any = await new Promise((r) =>
      s1.emit(SocketEvent.CreateRoom, { name: "Host", settings: defaultSettings }, r)
    );
    const roomCode = createRes.room.code;
    const hostId = createRes.playerId;

    const joinRes: any = await new Promise((r) =>
      s2.emit(SocketEvent.JoinRoom, { name: "Guest", code: roomCode }, r)
    );
    const guestId = joinRes.playerId;

    // Non-host tries to kick host
    let s2Error = "";
    s2.on(SocketEvent.Error, (d: any) => {
      s2Error = d.message;
    });
    s2.emit(SocketEvent.KickPlayer, { playerId: hostId });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(s2Error, "Only the host can kick players");

    // Host tries to kick self
    let s1Error = "";
    s1.on(SocketEvent.Error, (d: any) => {
      s1Error = d.message;
    });
    s1.emit(SocketEvent.KickPlayer, { playerId: hostId });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(s1Error, "You cannot kick yourself");

    s1.disconnect();
    s2.disconnect();
    const testRoom = manager.getRoom(roomCode);
    if (testRoom?.game) testRoom.game.destroy();
    manager.deleteRoom(roomCode);
    io.close();
    httpServer.close();
  });

  test("Host kicks player in lobby, token invalidated, cannot rejoin with token", async () => {
    const { httpServer, io, manager, createClient } = await setupServer();
    const s1 = createClient();
    const s2 = createClient();

    await Promise.all([
      new Promise<void>((r) => s1.on("connect", () => r())),
      new Promise<void>((r) => s2.on("connect", () => r())),
    ]);

    const createRes: any = await new Promise((r) =>
      s1.emit(SocketEvent.CreateRoom, { name: "Host", settings: defaultSettings }, r)
    );
    const roomCode = createRes.room.code;

    const joinRes: any = await new Promise((r) =>
      s2.emit(SocketEvent.JoinRoom, { name: "Bob", code: roomCode }, r)
    );
    const bobToken = joinRes.token;
    const bobId = joinRes.playerId;

    let kickedMsg = "";
    s2.on(SocketEvent.Kicked, (d: any) => {
      kickedMsg = d.message;
    });

    let playerLeftId = "";
    s1.on(SocketEvent.PlayerLeft, (d: any) => {
      playerLeftId = d.playerId;
    });

    // Host kicks Bob
    s1.emit(SocketEvent.KickPlayer, { playerId: bobId, ban: false });
    await new Promise((r) => setTimeout(r, 150));

    assert.equal(kickedMsg, "You were kicked from the room");
    assert.equal(playerLeftId, bobId);

    // Bob tries to rejoin using old token
    const s2Rejoin = createClient();
    await new Promise<void>((r) => s2Rejoin.on("connect", () => r()));
    const rejoinRes: any = await new Promise((r) =>
      s2Rejoin.emit(SocketEvent.RejoinRoom, { code: roomCode, token: bobToken }, r)
    );
    assert.ok(rejoinRes.error);

    s1.disconnect();
    s2.disconnect();
    s2Rejoin.disconnect();
    const testRoom = manager.getRoom(roomCode);
    if (testRoom?.game) testRoom.game.destroy();
    manager.deleteRoom(roomCode);
    io.close();
    httpServer.close();
  });

  test("Host bans player, banned player cannot rejoin or join with new name", async () => {
    const { httpServer, io, manager, createClient } = await setupServer();
    const s1 = createClient();
    const s2 = createClient();

    await Promise.all([
      new Promise<void>((r) => s1.on("connect", () => r())),
      new Promise<void>((r) => s2.on("connect", () => r())),
    ]);

    const createRes: any = await new Promise((r) =>
      s1.emit(SocketEvent.CreateRoom, { name: "Host", settings: defaultSettings }, r)
    );
    const roomCode = createRes.room.code;

    const joinRes: any = await new Promise((r) =>
      s2.emit(SocketEvent.JoinRoom, { name: "Troublemaker", code: roomCode }, r)
    );
    const badId = joinRes.playerId;

    let bannedMsg = "";
    s2.on(SocketEvent.Kicked, (d: any) => {
      bannedMsg = d.message;
    });

    // Host bans player
    s1.emit(SocketEvent.KickPlayer, { playerId: badId, ban: true });
    await new Promise((r) => setTimeout(r, 150));

    assert.equal(bannedMsg, "You were banned from the room");

    // S2 tries to join again
    const s2New = createClient();
    await new Promise<void>((r) => s2New.on("connect", () => r()));
    const tryJoinRes: any = await new Promise((r) =>
      s2New.emit(SocketEvent.JoinRoom, { name: "NewIdentity", code: roomCode }, r)
    );
    assert.equal(tryJoinRes.error, "You are banned from this room");

    s1.disconnect();
    s2.disconnect();
    s2New.disconnect();
    const testRoom = manager.getRoom(roomCode);
    if (testRoom?.game) testRoom.game.destroy();
    manager.deleteRoom(roomCode);
    io.close();
    httpServer.close();
  });

  test("Host kicks current drawer mid-game: skips drawer and game continues", async () => {
    const { httpServer, io, manager, createClient } = await setupServer();
    const s1 = createClient();
    const s2 = createClient();
    const s3 = createClient();

    await Promise.all([
      new Promise<void>((r) => s1.on("connect", () => r())),
      new Promise<void>((r) => s2.on("connect", () => r())),
      new Promise<void>((r) => s3.on("connect", () => r())),
    ]);

    const createRes: any = await new Promise((r) =>
      s1.emit(SocketEvent.CreateRoom, { name: "Host", settings: defaultSettings }, r)
    );
    const roomCode = createRes.room.code;

    const join2: any = await new Promise((r) =>
      s2.emit(SocketEvent.JoinRoom, { name: "Bob", code: roomCode }, r)
    );
    const join3: any = await new Promise((r) =>
      s3.emit(SocketEvent.JoinRoom, { name: "Charlie", code: roomCode }, r)
    );

    // Ready up
    s2.emit(SocketEvent.PlayerReady, { ready: true });
    s3.emit(SocketEvent.PlayerReady, { ready: true });
    await new Promise((r) => setTimeout(r, 100));

    // Start game
    let roundStartDrawer = "";
    s1.on(SocketEvent.RoundStart, (d: any) => {
      roundStartDrawer = d.drawerId;
    });
    s1.emit(SocketEvent.StartGame);
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(roundStartDrawer);

    // Find who is drawing
    const drawerId = roundStartDrawer;

    // Check round end event when drawer is kicked
    let roundEnded = false;
    let roundEndWord = "";
    s1.on(SocketEvent.RoundEnd, (d: any) => {
      roundEnded = true;
      roundEndWord = d.word;
    });

    // If host was drawer, kick Bob instead. If Bob or Charlie was drawer, kick them!
    const targetToKick = drawerId === createRes.playerId ? join2.playerId : drawerId;
    s1.emit(SocketEvent.KickPlayer, { playerId: targetToKick, ban: false });

    await new Promise((r) => setTimeout(r, 200));

    if (targetToKick === drawerId) {
      assert.equal(roundEnded, true);
      assert.equal(roundEndWord, "(skipped)");
    }

    s1.disconnect();
    s2.disconnect();
    s3.disconnect();
    const testRoom = manager.getRoom(roomCode);
    if (testRoom?.game) testRoom.game.destroy();
    manager.deleteRoom(roomCode);
    io.close();
    httpServer.close();
  });
});
