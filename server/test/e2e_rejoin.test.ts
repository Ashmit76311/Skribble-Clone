import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { io as Client } from "socket.io-client";
import { SocketEvent, GamePhase } from "@skribbl/shared";

const SERVER_URL = "http://localhost:3001";

function createSocket() {
  return Client(SERVER_URL, {
    transports: ["websocket"],
    forceNew: true,
  });
}

function waitFor(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("E2E Session Rejoin Flow", () => {
  test("Lobby refresh keeps player slot without name taken error, and no tokens leaked in broadcasts", async () => {
    const s1 = createSocket();
    const s2 = createSocket();

    await new Promise<void>((resolve) => s1.on("connect", () => resolve()));
    await new Promise<void>((resolve) => s2.on("connect", () => resolve()));

    // s1 creates room
    const createRes: any = await new Promise((resolve) => {
      s1.emit(SocketEvent.CreateRoom, { name: "HostAlice", settings: { maxPlayers: 4 } }, resolve);
    });

    assert.ok(createRes.token, "Host got a secret token");
    assert.ok(createRes.playerId, "Host got a stable playerId");
    const roomCode = createRes.room.code;
    const aliceToken = createRes.token;
    const aliceId = createRes.playerId;

    // Verify token is NOT in room.players or room data
    for (const p of createRes.room.players) {
      assert.equal((p as any).token, undefined);
    }

    // s2 joins room and watches for broadcasts
    let receivedTokensInBroadcast = false;
    s2.on(SocketEvent.PlayerJoined, (data: any) => {
      if (JSON.stringify(data).includes(aliceToken)) {
        receivedTokensInBroadcast = true;
      }
    });

    const joinRes: any = await new Promise((resolve) => {
      s2.emit(SocketEvent.JoinRoom, { name: "BobGuesser", code: roomCode }, resolve);
    });
    assert.ok(joinRes.token, "Bob got a secret token");
    assert.notEqual(joinRes.token, aliceToken);
    // Verify Bob's room data doesn't contain Alice's token or his own in players array
    for (const p of joinRes.room.players) {
      assert.equal((p as any).token, undefined);
    }

    // Now Alice "refreshes" tab: s1 disconnects, s1_refreshed connects
    s1.disconnect();
    await waitFor(100);

    const s1Refreshed = createSocket();
    await new Promise<void>((resolve) => s1Refreshed.on("connect", () => resolve()));

    // Alice rejoins using code and token
    const rejoinRes: any = await new Promise((resolve) => {
      s1Refreshed.emit(SocketEvent.RejoinRoom, { code: roomCode, token: aliceToken }, resolve);
    });

    assert.equal(rejoinRes.error, undefined, "Rejoin should succeed without error");
    assert.equal(rejoinRes.playerId, aliceId, "Player ID remains unchanged");
    assert.equal(rejoinRes.room.players.length, 2, "Room still has exactly 2 players");
    assert.equal(rejoinRes.room.players.find((p: any) => p.name === "HostAlice")?.id, aliceId);
    assert.equal(receivedTokensInBroadcast, false, "Alice token was never leaked in broadcasts");

    // Test cross-room token rejection:
    const s3 = createSocket();
    await new Promise<void>((resolve) => s3.on("connect", () => resolve()));
    const otherRoomRes: any = await new Promise((resolve) => {
      s3.emit(SocketEvent.CreateRoom, { name: "Charlie", settings: {} }, resolve);
    });

    // Trying to use Alice's token in Charlie's room should fail
    const invalidRejoin: any = await new Promise((resolve) => {
      s3.emit(SocketEvent.RejoinRoom, { code: otherRoomRes.room.code, token: aliceToken }, resolve);
    });
    assert.ok(invalidRejoin.error, "Token for one room cannot be used in another room");

    s1Refreshed.disconnect();
    s2.disconnect();
    s3.disconnect();
  });

  test("2-player game survives guesser refresh and drawer refresh mid-turn", async () => {
    const s1 = createSocket();
    const s2 = createSocket();

    await new Promise<void>((resolve) => s1.on("connect", () => resolve()));
    await new Promise<void>((resolve) => s2.on("connect", () => resolve()));

    const createRes: any = await new Promise((resolve) => {
      s1.emit(
        SocketEvent.CreateRoom,
        {
          name: "DrawerPlayer",
          settings: { drawTime: 30, wordCount: 3, rounds: 2 },
        },
        resolve
      );
    });
    const code = createRes.room.code;
    const drawerToken = createRes.token;
    const drawerId = createRes.playerId;

    const joinRes: any = await new Promise((resolve) => {
      s2.emit(SocketEvent.JoinRoom, { name: "GuesserPlayer", code }, resolve);
    });
    const guesserToken = joinRes.token;
    const guesserId = joinRes.playerId;

    // Start game
    s1.emit(SocketEvent.StartGame);

    // Wait for RoundStart with word options for the drawer
    const wordOptions = await new Promise<string[]>((resolve) => {
      s1.on(SocketEvent.RoundStart, (data: any) => {
        if (data.wordOptions) resolve(data.wordOptions);
      });
    });

    const chosenWord = wordOptions[0];
    s1.emit(SocketEvent.SelectWord, { word: chosenWord });

    // Drawer draws a stroke
    await waitFor(100);
    s1.emit(SocketEvent.DrawStart, { x: 0.1, y: 0.1, color: "#000000", size: 5, tool: "brush" });
    s1.emit(SocketEvent.DrawMove, { x: 0.2, y: 0.2 });
    s1.emit(SocketEvent.DrawEnd);
    await waitFor(100);

    // Guesser refreshes tab
    s2.disconnect();
    await waitFor(100);

    const s2Refreshed = createSocket();
    await new Promise<void>((resolve) => s2Refreshed.on("connect", () => resolve()));

    const guesserRejoin: any = await new Promise((resolve) => {
      s2Refreshed.emit(SocketEvent.RejoinRoom, { code, token: guesserToken }, resolve);
    });

    assert.equal(guesserRejoin.error, undefined);
    assert.equal(guesserRejoin.playerId, guesserId);
    assert.equal(guesserRejoin.room.phase, GamePhase.DRAWING);
    assert.equal(guesserRejoin.strokes.length, 1, "Guesser got canvas stroke on rejoin");
    assert.equal(guesserRejoin.room.word, null, "Guesser does NOT see secret word");
    assert.ok(guesserRejoin.room.endsAt, "Timer endsAt is preserved");

    // Drawer refreshes tab
    s1.disconnect();
    await waitFor(100);

    const s1Refreshed = createSocket();
    await new Promise<void>((resolve) => s1Refreshed.on("connect", () => resolve()));

    const drawerRejoin: any = await new Promise((resolve) => {
      s1Refreshed.emit(SocketEvent.RejoinRoom, { code, token: drawerToken }, resolve);
    });

    assert.equal(drawerRejoin.error, undefined);
    assert.equal(drawerRejoin.playerId, drawerId);
    assert.equal(drawerRejoin.room.phase, GamePhase.DRAWING);
    assert.equal(drawerRejoin.room.word, chosenWord, "Drawer still has the secret word on rejoin");
    assert.equal(drawerRejoin.strokes.length, 1, "Drawer still has their drawing intact");

    s1Refreshed.disconnect();
    s2Refreshed.disconnect();
  });
});
