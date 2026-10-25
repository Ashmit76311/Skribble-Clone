import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Server as SocketServer } from "socket.io";
import { io as Client } from "socket.io-client";
import { SocketEvent, GamePhase, WordMode, RoomSettings } from "@skribbl/shared";
import { Room, validateCustomWords, validateSettings } from "../src/Room.js";
import { Player } from "../src/Player.js";
import { Game } from "../src/Game.js";
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

describe("Custom Words Validation", () => {
  test("trims and lowercases words", () => {
    const input = ["  Apple ", "BANANA  ", "  oRaNgE  "];
    const result = validateCustomWords(input);
    assert.deepEqual(result, ["apple", "banana", "orange"]);
  });

  test("removes duplicate words", () => {
    const input = ["apple", "banana", "apple", "BANANA", "Apple"];
    const result = validateCustomWords(input);
    assert.deepEqual(result, ["apple", "banana"]);
  });

  test("allows letters, spaces, and hyphens", () => {
    const input = ["ice cream", "super-man", "t-shirt", "red apple pie"];
    const result = validateCustomWords(input);
    assert.deepEqual(result, ["ice cream", "super-man", "t-shirt", "red apple pie"]);
  });

  test("rejects words shorter than 2 or longer than 30 characters", () => {
    const tooShort = "a";
    const tooLong = "a".repeat(31);
    const valid = "ab";
    const result = validateCustomWords([tooShort, tooLong, valid]);
    assert.deepEqual(result, ["ab"]);
  });

  test("rejects numbers, punctuation, and symbols", () => {
    const input = ["cat123", "dog!", "bird?", "fish#", "elephant."];
    const result = validateCustomWords(input);
    assert.deepEqual(result, []);
  });

  test("caps at maximum 100 words", () => {
    const words = Array.from({ length: 150 }, (_, i) => {
      const a = String.fromCharCode(97 + Math.floor(i / 26));
      const b = String.fromCharCode(97 + (i % 26));
      return `word ${a} ${b}`;
    });
    const result = validateCustomWords(words);
    assert.equal(result.length, 100);
  });

  test("parses comma and newline separated strings", () => {
    const input = "apple, banana\norange,grape\r\nstrawberry";
    const result = validateCustomWords(input);
    assert.deepEqual(result, ["apple", "banana", "orange", "grape", "strawberry"]);
  });

  test("validateSettings handles customWords and useCustomOnly", () => {
    const settings = validateSettings({
      customWords: ["cat", "dog"],
      useCustomOnly: true,
    });
    assert.deepEqual(settings.customWords, ["cat", "dog"]);
    assert.equal(settings.useCustomOnly, true);

    const defaultClean = validateSettings({});
    assert.deepEqual(defaultClean.customWords, []);
    assert.equal(defaultClean.useCustomOnly, false);
  });
});

describe("Custom Words Selection and Secrecy", () => {
  test("useCustomOnly with enough words picks only custom words", () => {
    const customWords = ["pizza", "burger", "taco", "sushi", "pasta"];
    const settings: RoomSettings = {
      ...defaultSettings,
      wordCount: 3,
      customWords,
      useCustomOnly: true,
    };

    const host = new Player("p1", "Alice");
    const guest = new Player("p2", "Bob");
    const mockIo = createMockIo();

    const game = new Game(mockIo, "ROOM1", settings, [host, guest], () => {});
    try {
      game.start();

      const options = game.wordOptionsList;
      assert.equal(options.length, 3);
      for (const opt of options) {
        assert.ok(customWords.includes(opt), `Expected ${opt} to be in custom words`);
      }
    } finally {
      game.destroy();
    }
  });

  test("useCustomOnly with fewer than wordCount words falls back to mixing with normal list", () => {
    const customWords = ["uniqueunicorn"];
    const settings: RoomSettings = {
      ...defaultSettings,
      wordCount: 3,
      customWords,
      useCustomOnly: true, // Only 1 custom word, but wordCount is 3
    };

    const host = new Player("p1", "Alice");
    const guest = new Player("p2", "Bob");
    const mockIo = createMockIo();

    const game = new Game(mockIo, "ROOM2", settings, [host, guest], () => {});
    try {
      game.start();

      const options = game.wordOptionsList;
      assert.equal(options.length, 3);
    } finally {
      game.destroy();
    }
  });

  test("no repeats within game across turns", () => {
    const customWords = ["wordone", "wordtwo", "wordthree", "wordfour", "wordfive"];
    const settings: RoomSettings = {
      ...defaultSettings,
      wordCount: 2,
      customWords,
      useCustomOnly: true,
    };

    const host = new Player("p1", "Alice");
    const guest = new Player("p2", "Bob");
    const mockIo = createMockIo();

    const game = new Game(mockIo, "ROOM3", settings, [host, guest], () => {});
    try {
      game.start();

      const firstOptions = [...game.wordOptionsList];
      const chosen = firstOptions[0];
      game.chooseWord(game.drawer!.id, chosen);

      // Advance turn immediately in test
      (game as any).clearTimer();
      (game as any).advanceTurnIndex();
      (game as any).startTurn();

      // Second turn options must not contain previously chosen word
      const secondOptions = game.wordOptionsList;
      assert.ok(
        !secondOptions.includes(chosen),
        `Chosen word "${chosen}" should not repeat in second turn options`
      );
    } finally {
      game.destroy();
    }
  });

  test("Combination mode works with custom words", () => {
    const customWords = ["sun", "flower", "moon", "star"];
    const settings: RoomSettings = {
      ...defaultSettings,
      wordCount: 2,
      wordMode: WordMode.Combination,
      customWords,
      useCustomOnly: true,
    };

    const host = new Player("p1", "Alice");
    const guest = new Player("p2", "Bob");
    const mockIo = createMockIo();

    const game = new Game(mockIo, "ROOM4", settings, [host, guest], () => {});
    try {
      game.start();

      const options = game.wordOptionsList;
      assert.equal(options.length, 2);
      for (const opt of options) {
        const parts = opt.split(" ");
        assert.equal(parts.length, 2, "Combination mode should join 2 words");
        assert.ok(customWords.includes(parts[0]));
        assert.ok(customWords.includes(parts[1]));
      }
    } finally {
      game.destroy();
    }
  });

  test("Custom words secrecy: non-hosts and guessers never receive customWords", () => {
    const customWords = ["secretone", "secrettwo", "secretthree"];
    const settings: RoomSettings = {
      ...defaultSettings,
      customWords,
      useCustomOnly: true,
    };

    const room = new Room("SECRET", settings);
    const host = new Player("h1", "Host");
    host.isHost = true;
    const guest = new Player("g1", "Guest");

    room.addPlayer(host);
    room.addPlayer(guest);

    // In lobby: host can see customWords, guest gets empty array
    const hostData = room.toJSON(host.id);
    const guestData = room.toJSON(guest.id);

    assert.deepEqual(hostData.settings.customWords, customWords);
    assert.deepEqual(guestData.settings.customWords, []);

    // During game: buildRoomData never includes customWords for anyone
    const mockIo = createMockIo();
    const game = new Game(mockIo, room.code, settings, room.players, () => {});
    try {
      game.start();

      const drawerData = game.buildRoomData(game.drawer!.id);
      const otherPlayer = room.players.find((p) => p.id !== game.drawer!.id)!;
      const guesserData = game.buildRoomData(otherPlayer.id);

      assert.deepEqual(drawerData.settings.customWords, []);
      assert.deepEqual(guesserData.settings.customWords, []);

      // Drawer gets wordOptions, guesser does not
      assert.ok(drawerData.wordOptions && drawerData.wordOptions.length > 0);
      assert.equal(guesserData.wordOptions, undefined);
    } finally {
      game.destroy();
    }
  });
});

describe("Custom Words Socket Integration", () => {
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

  test("Host updates custom words via update_settings, non-host cannot", async () => {
    const { httpServer, io, manager, createClient } = await setupServer();
    const s1 = createClient();
    const s2 = createClient();

    await Promise.all([
      new Promise<void>((r) => s1.on("connect", () => r())),
      new Promise<void>((r) => s2.on("connect", () => r())),
    ]);

    // Host creates room with custom words
    const createRes: any = await new Promise((r) =>
      s1.emit(
        SocketEvent.CreateRoom,
        {
          name: "Alice",
          settings: {
            ...defaultSettings,
            customWords: ["cat", "dog"],
            useCustomOnly: true,
          },
        },
        r
      )
    );

    const roomCode = createRes.room.code;
    assert.deepEqual(createRes.room.settings.customWords, ["cat", "dog"]);
    assert.equal(createRes.room.settings.useCustomOnly, true);

    // Guest joins room
    const joinRes: any = await new Promise((r) =>
      s2.emit(SocketEvent.JoinRoom, { name: "Bob", code: roomCode }, r)
    );

    // Guest must NOT receive custom words in settings
    assert.deepEqual(joinRes.room.settings.customWords, []);
    assert.equal(joinRes.room.settings.useCustomOnly, true);

    // Guest tries to emit update_settings -> error
    let s2Error = "";
    s2.on(SocketEvent.Error, (d: any) => {
      s2Error = d.message;
    });
    s2.emit(SocketEvent.UpdateSettings, {
      settings: { customWords: ["hacked"] },
    });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(s2Error, "Only the host can update room settings");

    // Host updates settings
    let hostReceivedState: any = null;
    let guestReceivedState: any = null;

    s1.on(SocketEvent.GameState, (data: any) => {
      hostReceivedState = data;
    });
    s2.on(SocketEvent.GameState, (data: any) => {
      guestReceivedState = data;
    });

    s1.emit(SocketEvent.UpdateSettings, {
      settings: {
        customWords: ["falcon", "eagle", "hawk", "owl"],
        useCustomOnly: true,
      },
    });

    await new Promise((r) => setTimeout(r, 150));

    assert.ok(hostReceivedState, "Host should have received GameState");
    assert.deepEqual(hostReceivedState.room.settings.customWords, [
      "falcon",
      "eagle",
      "hawk",
      "owl",
    ]);

    assert.ok(guestReceivedState, "Guest should have received GameState");
    assert.deepEqual(guestReceivedState.room.settings.customWords, []);
    assert.equal(guestReceivedState.room.settings.useCustomOnly, true);

    s1.disconnect();
    s2.disconnect();
    const testRoom = manager.getRoom(roomCode);
    if (testRoom?.game) testRoom.game.destroy();
    manager.deleteRoom(roomCode);
    io.close();
    httpServer.close();
  });
});
