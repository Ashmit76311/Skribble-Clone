import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Server } from "socket.io";
import { createServer } from "node:http";
import { GamePhase, WordMode } from "@skribbl/shared";
import { RoomManager } from "../src/RoomManager.js";
import { Room } from "../src/Room.js";
import { Player } from "../src/Player.js";
import { Game } from "../src/Game.js";

describe("Session Rejoin & Player Identity", () => {
  test("Players have distinct stable id and secret token", () => {
    const p1 = new Player("socket_1", "Alice");
    const p2 = new Player("socket_2", "Bob");

    assert.notEqual(p1.id, p1.token);
    assert.notEqual(p1.id, p2.id);
    assert.notEqual(p1.token, p2.token);
    assert.equal(p1.socketId, "socket_1");
    assert.equal(p1.isConnected, true);

    const json = p1.toJSON();
    assert.equal(json.id, p1.id);
    assert.equal(json.name, "Alice");
    assert.equal(json.isConnected, true);
    // Secret token and socketId must never be exposed in toJSON()
    assert.equal((json as any).token, undefined);
    assert.equal((json as any).socketId, undefined);
  });

  test("Room lookup by token works within room and rejects cross-room tokens", () => {
    const manager = new RoomManager();
    const room1 = manager.createRoom({});
    const room2 = manager.createRoom({});

    const p1 = new Player("sock_1", "Alice");
    const p2 = new Player("sock_2", "Bob");
    room1.addPlayer(p1);
    room2.addPlayer(p2);

    assert.equal(room1.getPlayerByToken(p1.token), p1);
    assert.equal(room1.getPlayerByToken(p2.token), undefined);
    assert.equal(room2.getPlayerByToken(p2.token), p2);
    assert.equal(room2.getPlayerByToken(p1.token), undefined);
  });

  test("Disconnect marks player offline, prevents duplicate name joins", () => {
    const room = new Room("TEST1", {
      maxPlayers: 8,
      rounds: 3,
      drawTime: 80,
      wordCount: 3,
      hints: 2,
      wordMode: WordMode.Normal,
      isPublic: true,
    });
    const p1 = new Player("sock_1", "Alice");
    room.addPlayer(p1);

    // Player goes offline
    p1.isConnected = false;

    // A new join_room with the same name is rejected
    const p2 = new Player("sock_2", "Alice");
    const err = room.addPlayer(p2);
    assert.equal(err, "Name already taken");
  });

  test("Chat history filters messages based on recipient role", () => {
    const room = new Room("TEST2", {
      maxPlayers: 8,
      rounds: 3,
      drawTime: 80,
      wordCount: 3,
      hints: 2,
      wordMode: WordMode.Normal,
      isPublic: true,
    });

    const drawer = new Player("sock_d", "Drawer");
    const guesser1 = new Player("sock_g1", "Guesser1");
    const guesser2 = new Player("sock_g2", "Guesser2");

    room.addPlayer(drawer);
    room.addPlayer(guesser1);
    room.addPlayer(guesser2);

    // Mock an active game
    const dummyIo = { to: () => ({ emit: () => {} }) } as unknown as Server;
    room.startGame(dummyIo);
    // Force drawing phase
    (room.game as any).phase = GamePhase.DRAWING;
    (room.game as any).currentWord = "apple";
    // Set drawer explicitly
    (room.game as any).turnOrder = [drawer.id, guesser1.id, guesser2.id];
    (room.game as any).turnIndex = 0;

    guesser1.hasGuessed = true;
    guesser2.hasGuessed = false;

    room.addChatMessage({ name: "System", text: "Game started", type: "system" }, "all");
    room.addChatMessage({ playerId: guesser2.id, name: "Guesser2", text: "banana", type: "guess" }, "non_guessers");
    room.addChatMessage({ playerId: guesser1.id, name: "Guesser1", text: "nice drawing", type: "chat" }, "drawer_or_guessed");

    // Drawer should see "all" and "drawer_or_guessed", but NOT wrong guesses
    const drawerChat = room.getChatHistoryForPlayer(drawer);
    assert.equal(drawerChat.some((m) => m.text === "Game started"), true);
    assert.equal(drawerChat.some((m) => m.text === "nice drawing"), true);
    assert.equal(drawerChat.some((m) => m.text === "banana"), false);

    // Guesser1 (already guessed) should see "all" and "drawer_or_guessed", but NOT wrong guesses
    const g1Chat = room.getChatHistoryForPlayer(guesser1);
    assert.equal(g1Chat.some((m) => m.text === "nice drawing"), true);
    assert.equal(g1Chat.some((m) => m.text === "banana"), false);

    // Guesser2 (has not guessed) should see "all" and "non_guessers", but NOT drawer/guessed chat
    const g2Chat = room.getChatHistoryForPlayer(guesser2);
    assert.equal(g2Chat.some((m) => m.text === "Game started"), true);
    assert.equal(g2Chat.some((m) => m.text === "banana"), true);
    assert.equal(g2Chat.some((m) => m.text === "nice drawing"), false);

    room.resetToLobby();
  });

  test("Disconnected guessers do not block all-guessed turn completion", () => {
    const room = new Room("TEST3", {
      maxPlayers: 8,
      rounds: 3,
      drawTime: 80,
      wordCount: 3,
      hints: 2,
      wordMode: WordMode.Normal,
      isPublic: true,
    });

    const drawer = new Player("sock_d", "Drawer");
    const g1 = new Player("sock_g1", "Guesser1");
    const g2 = new Player("sock_g2", "Guesser2");

    room.addPlayer(drawer);
    room.addPlayer(g1);
    room.addPlayer(g2);

    let roundEnded = false;
    const dummyIo = {
      to: () => ({
        emit: (event: string) => {
          if (event === "round_end") roundEnded = true;
        },
      }),
    } as unknown as Server;

    room.startGame(dummyIo);
    const game = room.game!;
    (game as any).phase = GamePhase.DRAWING;
    (game as any).currentWord = "apple";
    (game as any).turnOrder = [drawer.id, g1.id, g2.id];
    (game as any).turnIndex = 0;

    // g1 guesses correctly
    g1.hasGuessed = true;
    game.checkAllGuessed();
    // g2 hasn't guessed, so turn should not end yet
    assert.equal(roundEnded, false);

    // g2 disconnects
    g2.isConnected = false;
    game.checkAllGuessed();
    // Now all connected non-drawers (g1) have guessed, so turn ends
    assert.equal(roundEnded, true);

    room.resetToLobby();
  });

  test("Room clearAllTimers clears player grace timers", () => {
    const room = new Room("TEST4", {
      maxPlayers: 8,
      rounds: 3,
      drawTime: 80,
      wordCount: 3,
      hints: 2,
      wordMode: WordMode.Normal,
      isPublic: true,
    });

    const p = new Player("sock_1", "Alice");
    room.addPlayer(p);
    p.disconnectTimer = setTimeout(() => {}, 30000);

    room.clearAllTimers();
    assert.equal(p.disconnectTimer, null);
  });

  test("Drawer disconnect grace timer expiration removes drawer and ends turn", () => {
    const room = new Room("TEST5", {
      maxPlayers: 8,
      rounds: 3,
      drawTime: 80,
      wordCount: 3,
      hints: 2,
      wordMode: WordMode.Normal,
      isPublic: true,
    });

    const drawer = new Player("sock_d", "Drawer");
    const g1 = new Player("sock_g1", "Guesser1");
    const g2 = new Player("sock_g2", "Guesser2");

    room.addPlayer(drawer);
    room.addPlayer(g1);
    room.addPlayer(g2);

    let skippedWord: string | null = null;
    const dummyIo = {
      to: () => ({
        emit: (event: string, data: any) => {
          if (event === "round_end") skippedWord = data.word;
        },
      }),
    } as unknown as Server;

    room.startGame(dummyIo);
    const game = room.game!;
    (game as any).phase = GamePhase.DRAWING;
    (game as any).currentWord = "apple";
    (game as any).turnOrder = [drawer.id, g1.id, g2.id];
    (game as any).turnIndex = 0;

    // Grace timer expires: removePlayer is called on drawer
    const removed = room.removePlayer(drawer.id);
    assert.equal(removed?.id, drawer.id);
    assert.equal(skippedWord, "(skipped)");
    assert.equal(game.currentPhase, GamePhase.ROUND_END);

    room.resetToLobby();
  });

  test("2-player game ends only after disconnected player is removed (< 2 players)", () => {
    const room = new Room("TEST6", {
      maxPlayers: 8,
      rounds: 3,
      drawTime: 80,
      wordCount: 3,
      hints: 2,
      wordMode: WordMode.Normal,
      isPublic: true,
    });

    const p1 = new Player("sock_1", "P1");
    const p2 = new Player("sock_2", "P2");
    room.addPlayer(p1);
    room.addPlayer(p2);

    let gameOver = false;
    const dummyIo = {
      to: () => ({
        emit: (event: string) => {
          if (event === "game_over") gameOver = true;
        },
      }),
    } as unknown as Server;

    room.startGame(dummyIo);
    const game = room.game!;
    (game as any).phase = GamePhase.DRAWING;

    // P2 disconnects (marked offline): game does NOT end yet
    p2.isConnected = false;
    assert.equal(gameOver, false);
    assert.equal(game.currentPhase, GamePhase.DRAWING);

    // Grace timer expires: P2 is removed -> players.length becomes 1 (< 2)
    room.removePlayer(p2.id);
    assert.equal(gameOver, true);
    assert.equal(game.currentPhase, GamePhase.GAME_OVER);

    room.resetToLobby();
  });

  test("Reconnect system message timing rules: > 5s offline and 30s cooldown", () => {
    const player = new Player("sock_1", "Alice");

    // Simulating reconnect check logic:
    function shouldSendReconnect(p: Player, now: number): boolean {
      const offlineDuration = p.disconnectedAt ? now - p.disconnectedAt : 0;
      const timeSinceLastMsg = now - p.lastReconnectedMsgAt;
      if (offlineDuration > 5_000 && timeSinceLastMsg > 30_000) {
        p.lastReconnectedMsgAt = now;
        p.disconnectedAt = null;
        return true;
      }
      p.disconnectedAt = null;
      return false;
    }

    const t0 = 100_000;
    // 1. Quick refresh (offline for 1.5 seconds) -> suppressed
    player.disconnectedAt = t0;
    assert.equal(shouldSendReconnect(player, t0 + 1_500), false);

    // 2. Offline for 6 seconds, first time -> sent
    player.disconnectedAt = t0 + 10_000;
    assert.equal(shouldSendReconnect(player, t0 + 16_000), true);
    assert.equal(player.lastReconnectedMsgAt, t0 + 16_000);

    // 3. Disconnects again and offline for 6 seconds, but only 20 seconds since last msg -> suppressed (cooldown)
    player.disconnectedAt = t0 + 30_000;
    assert.equal(shouldSendReconnect(player, t0 + 36_000), false);

    // 4. Offline for 6 seconds, 35 seconds since last msg -> sent
    player.disconnectedAt = t0 + 55_000;
    assert.equal(shouldSendReconnect(player, t0 + 61_000), true);
  });

  test("Game over caps currentRound to totalRounds and clears drawer and player flags", () => {
    const room = new Room("TEST7", {
      maxPlayers: 8,
      rounds: 2,
      drawTime: 80,
      wordCount: 3,
      hints: 2,
      wordMode: WordMode.Normal,
      isPublic: true,
    });

    const p1 = new Player("sock_1", "Alice");
    const p2 = new Player("sock_2", "Bob");
    room.addPlayer(p1);
    room.addPlayer(p2);

    const dummyIo = {
      to: () => ({
        emit: () => {},
      }),
    } as unknown as Server;

    room.startGame(dummyIo);
    const game = room.game!;

    // Simulate drawing and guessed flags
    p1.isDrawing = true;
    p2.hasGuessed = true;

    // Simulate reaching round beyond total rounds (round 3 in a 2-round game)
    (game as any).round = 3;
    (game as any).endGame();

    assert.equal(game.currentPhase, GamePhase.GAME_OVER);
    assert.equal(game.currentRound, 2, "currentRound must not exceed total rounds");
    assert.equal(game.drawer, undefined, "drawer must be undefined on GAME_OVER");

    const roomData = game.buildRoomData(p1.id);
    assert.equal(roomData.currentRound, 2, "RoomData currentRound must not exceed total rounds");
    assert.equal(roomData.currentDrawer, null, "RoomData currentDrawer must be null on GAME_OVER");

    for (const p of roomData.players) {
      assert.equal(p.isDrawing, false, "Player isDrawing must be false on GAME_OVER");
      assert.equal(p.hasGuessed, false, "Player hasGuessed must be false on GAME_OVER");
    }

    // Reset to lobby
    room.resetToLobby();
    const lobbyData = room.toJSON();
    assert.equal(lobbyData.phase, GamePhase.LOBBY);
    assert.equal(lobbyData.currentDrawer, null);
    for (const p of lobbyData.players) {
      assert.equal(p.isDrawing, false, "Player isDrawing must be false in lobby");
      assert.equal(p.hasGuessed, false, "Player hasGuessed must be false in lobby");
    }
  });
});

