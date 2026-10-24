import { Server } from "socket.io";
import { GamePhase, SocketEvent, WordMode } from "@skribbl/shared";
import type {
  RoomSettings,
  Stroke,
  DrawStartPayload,
  DrawMovePayload,
  ChatMessagePayload,
  RoomData,
} from "@skribbl/shared";
import { Player } from "./Player.js";
import words from "../words.json" with { type: "json" };
import {
  isCorrectGuess,
  isCloseGuess,
  containsSecretWord,
} from "./wordMatching.js";
import {
  calculateGuesserPoints,
  calculateDrawerPoints,
  determineWinners,
  DRAWER_POINTS_PER_GUESS,
} from "./scoring.js";
import { HintManager } from "./hints.js";

const WORD_SELECT_TIME = 15_000;
const ROUND_END_DELAY = 5_000;

function allWords(): string[] {
  return Object.values(words).flat();
}

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export class Game {
  private io: Server;
  private roomCode: string;
  private settings: RoomSettings;
  private players: Player[];
  private turnOrder: string[] = [];
  private turnIndex = 0;
  private round = 1;
  private phase = GamePhase.LOBBY;
  private currentWord: string | null = null;
  private wordOptions: string[] = [];
  private usedWords = new Set<string>();
  private wordPool: string[];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hintTimers: ReturnType<typeof setTimeout>[] = [];
  private endsAt: number | null = null;
  private onEnd: () => void;
  private onChatMessage?: (
    msg: ChatMessagePayload,
    visibility: "all" | "non_guessers" | "drawer_or_guessed"
  ) => void;
  private strokes: Stroke[] = [];
  private pendingStroke: Stroke | null = null;
  private lastDrawMoveTime = 0;
  private hintManager: HintManager | null = null;
  private guessOrder = 0;
  private turnScores: Record<string, number> = {};

  constructor(
    io: Server,
    roomCode: string,
    settings: RoomSettings,
    players: Player[],
    onEnd: () => void,
    onChatMessage?: (
      msg: ChatMessagePayload,
      visibility: "all" | "non_guessers" | "drawer_or_guessed"
    ) => void
  ) {
    this.io = io;
    this.roomCode = roomCode;
    this.settings = settings;
    this.players = players;
    this.onEnd = onEnd;
    this.onChatMessage = onChatMessage;
    this.wordPool = allWords();
  }

  get currentPhase() {
    return this.phase;
  }

  get currentRound() {
    return Math.min(this.round, this.settings.rounds);
  }

  get drawer(): Player | undefined {
    if (this.phase === GamePhase.GAME_OVER) return undefined;
    const id = this.turnOrder[this.turnIndex];
    return this.players.find((p) => p.id === id);
  }

  get endsAtTimestamp() {
    return this.endsAt;
  }

  get currentWordLength() {
    if (this.hintManager) {
      return this.hintManager.getWordLengthForDisplay();
    }
    return this.currentWord?.length ?? null;
  }

  get wordOptionsList(): string[] {
    return this.wordOptions;
  }

  start() {
    this.turnOrder = this.players.map((p) => p.id);
    this.turnIndex = 0;
    this.round = 1;
    this.startTurn();
  }

  private startTurn() {
    this.phase = GamePhase.WORD_SELECT;
    this.currentWord = null;
    this.strokes = [];
    this.pendingStroke = null;
    this.hintManager = null;
    this.clearHintTimers();
    this.guessOrder = 0;
    this.turnScores = {};

    this.players.forEach((p) => {
      p.isDrawing = false;
      p.hasGuessed = false;
    });

    const drawer = this.drawer;
    if (!drawer) return this.endGame();
    drawer.isDrawing = true;

    const available = this.wordPool.filter((w) => !this.usedWords.has(w));
    if (available.length < this.settings.wordCount * 2) {
      this.usedWords.clear();
    }
    const pool = this.wordPool.filter((w) => !this.usedWords.has(w));

    if (this.settings.wordMode === WordMode.Combination) {
      this.wordOptions = [];
      for (let i = 0; i < this.settings.wordCount; i++) {
        const pair = pickRandom(pool, 2);
        this.wordOptions.push(pair.join(" "));
      }
    } else {
      this.wordOptions = pickRandom(pool, this.settings.wordCount);
    }

    this.endsAt = Date.now() + WORD_SELECT_TIME;

    if (drawer.isConnected && drawer.socketId) {
      this.io.to(drawer.socketId).emit(SocketEvent.RoundStart, {
        round: this.round,
        drawerId: drawer.id,
        endsAt: this.endsAt,
        wordOptions: this.wordOptions,
      });
    }

    this.broadcast(
      SocketEvent.RoundStart,
      {
        round: this.round,
        drawerId: drawer.id,
        endsAt: this.endsAt,
      },
      drawer.id
    );

    this.broadcastState();
    this.setTimer(WORD_SELECT_TIME, () => this.autoPickWord());
  }

  chooseWord(playerId: string, word: string): boolean {
    if (this.phase !== GamePhase.WORD_SELECT) return false;
    if (this.drawer?.id !== playerId) return false;
    if (!this.wordOptions.includes(word)) return false;

    this.currentWord = word;
    this.usedWords.add(word);
    this.phase = GamePhase.DRAWING;
    this.clearTimer();
    this.clearHintTimers();
    this.guessOrder = 0;
    this.turnScores = {};

    this.hintManager = new HintManager(
      word,
      this.settings.hints,
      this.settings.wordMode
    );

    this.endsAt = Date.now() + this.settings.drawTime * 1000;

    const totalHints = this.hintManager.totalHints;
    const drawTimeMs = this.settings.drawTime * 1000;
    if (totalHints > 0) {
      const interval = drawTimeMs / (totalHints + 1);
      for (let i = 1; i <= totalHints; i++) {
        const t = setTimeout(() => {
          if (this.phase !== GamePhase.DRAWING || !this.hintManager) return;
          if (this.hintManager.revealNext()) {
            const hint = this.hintManager.getMaskedHint();
            this.broadcastHint(hint);
          }
        }, interval * i);
        this.hintTimers.push(t);
      }
    }

    const drawerDisplayLength =
      this.hintManager.getWordLengthForDisplay() ?? word.length;
    const guesserDisplayLength = this.hintManager.getWordLengthForDisplay();
    const maskedHint = this.hintManager.getMaskedHint();

    this.broadcast(
      SocketEvent.WordChosen,
      {
        wordLength: guesserDisplayLength ?? 0,
        endsAt: this.endsAt,
        hint: maskedHint,
      },
      this.drawer?.id
    );

    if (this.drawer && this.drawer.isConnected && this.drawer.socketId) {
      this.io.to(this.drawer.socketId).emit(SocketEvent.WordChosen, {
        wordLength: drawerDisplayLength,
        endsAt: this.endsAt,
        word,
        hint: word,
      });
    }

    this.broadcastState();
    this.setTimer(this.settings.drawTime * 1000, () => this.endTurn());
    return true;
  }

  private broadcastHint(hint: string) {
    for (const p of this.players) {
      if (
        p.id !== this.drawer?.id &&
        !p.hasGuessed &&
        p.isConnected &&
        p.socketId
      ) {
        this.io.to(p.socketId).emit(SocketEvent.HintUpdate, { hint });
      }
    }
  }

  private autoPickWord() {
    if (this.phase !== GamePhase.WORD_SELECT) return;
    const word =
      this.wordOptions[Math.floor(Math.random() * this.wordOptions.length)];
    if (this.drawer) this.chooseWord(this.drawer.id, word);
  }

  checkAllGuessed() {
    if (this.phase !== GamePhase.DRAWING) return;
    const activeNonDrawers = this.players.filter(
      (p) => p.id !== this.drawer?.id && p.isConnected
    );
    if (
      activeNonDrawers.length > 0 &&
      activeNonDrawers.every((p) => p.hasGuessed)
    ) {
      this.endTurn();
    }
  }

  handleGuess(playerId: string, rawText: string) {
    if (this.phase !== GamePhase.DRAWING || !this.currentWord) return;
    if (this.drawer?.id === playerId) return;
    const player = this.players.find((p) => p.id === playerId);
    if (!player || player.hasGuessed) return;

    const text = rawText.trim();
    if (!text) return;

    if (isCorrectGuess(text, this.currentWord)) {
      player.hasGuessed = true;
      this.guessOrder++;
      const isFirst = this.guessOrder === 1;
      const remainingMs = Math.max(0, (this.endsAt ?? Date.now()) - Date.now());
      const totalMs = this.settings.drawTime * 1000;
      const points = calculateGuesserPoints(remainingMs, totalMs, isFirst);

      player.score += points;
      this.turnScores[player.id] = (this.turnScores[player.id] ?? 0) + points;

      if (this.drawer) {
        this.drawer.score += DRAWER_POINTS_PER_GUESS;
        this.turnScores[this.drawer.id] =
          (this.turnScores[this.drawer.id] ?? 0) + DRAWER_POINTS_PER_GUESS;
      }

      const scores: Record<string, number> = {};
      this.players.forEach((p) => (scores[p.id] = p.score));

      this.io.to(this.roomCode).emit(SocketEvent.GuessResult, {
        playerId: player.id,
        playerName: player.name,
        correct: true,
        points,
        scores,
      });

      const sysMsg: ChatMessagePayload = {
        name: "System",
        text: `${player.name} guessed the word!`,
        type: "correct",
      };
      this.onChatMessage?.(sysMsg, "all");
      this.io.to(this.roomCode).emit(SocketEvent.ChatMessage, sysMsg);

      // Show full word to the player who guessed
      if (player.isConnected && player.socketId) {
        this.io.to(player.socketId).emit(SocketEvent.WordChosen, {
          wordLength: this.currentWord.length,
          endsAt: this.endsAt!,
          word: this.currentWord,
          hint: this.currentWord,
        });
      }

      this.broadcastState();
      this.checkAllGuessed();
    } else if (isCloseGuess(text, this.currentWord)) {
      if (player.isConnected && player.socketId) {
        this.io.to(player.socketId).emit(SocketEvent.ChatMessage, {
          name: "System",
          text: `'${text}' is close!`,
          type: "close",
        });
      }
    } else {
      // Don't leak secret word if typed in wrong guess
      if (containsSecretWord(text, this.currentWord)) {
        if (player.isConnected && player.socketId) {
          this.io.to(player.socketId).emit(SocketEvent.ChatMessage, {
            name: "System",
            text: "Your message contains the secret word and was blocked!",
            type: "close",
          });
        }
        return;
      }

      const msg: ChatMessagePayload = {
        playerId: player.id,
        name: player.name,
        text,
        type: "guess",
      };

      this.onChatMessage?.(msg, "non_guessers");

      // Broadcast wrong guesses only to non-guessers
      for (const p of this.players) {
        if (
          !p.hasGuessed &&
          p.id !== this.drawer?.id &&
          p.isConnected &&
          p.socketId
        ) {
          this.io.to(p.socketId).emit(SocketEvent.ChatMessage, msg);
        }
      }
    }
  }

  handleChat(playerId: string, rawText: string) {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return;
    const text = rawText?.trim();
    if (!text || text.length > 200) return;

    if (this.phase !== GamePhase.DRAWING) {
      const msg: ChatMessagePayload = {
        playerId: player.id,
        name: player.name,
        text,
        type: "chat",
      };
      this.onChatMessage?.(msg, "all");
      this.io.to(this.roomCode).emit(SocketEvent.ChatMessage, msg);
      return;
    }

    const isDrawer = this.drawer?.id === playerId;
    const hasGuessed = player.hasGuessed;

    if (isDrawer || hasGuessed) {
      // Channel for drawer and players who already guessed
      const msg: ChatMessagePayload = {
        playerId: player.id,
        name: player.name,
        text,
        type: "chat",
      };
      this.onChatMessage?.(msg, "drawer_or_guessed");
      for (const p of this.players) {
        if (
          (p.id === this.drawer?.id || p.hasGuessed) &&
          p.isConnected &&
          p.socketId
        ) {
          this.io.to(p.socketId).emit(SocketEvent.ChatMessage, msg);
        }
      }
    } else {
      // Non-guesser: typing into chat box is treated as a guess
      this.handleGuess(playerId, text);
    }
  }

  endTurn() {
    if (this.phase !== GamePhase.DRAWING && this.phase !== GamePhase.WORD_SELECT)
      return;
    this.clearTimer();
    this.clearHintTimers();
    this.phase = GamePhase.ROUND_END;

    this.players.forEach((p) => {
      p.isDrawing = false;
      p.hasGuessed = false;
    });

    const scores: Record<string, number> = {};
    this.players.forEach((p) => (scores[p.id] = p.score));

    this.advanceTurnIndex();
    const nextDrawer = this.drawer;

    this.io.to(this.roomCode).emit(SocketEvent.RoundEnd, {
      word: this.currentWord ?? "",
      scores,
      turnPoints: this.turnScores,
      nextDrawerId: nextDrawer?.id ?? null,
    });

    this.currentWord = null;
    this.endsAt = null;
    this.broadcastState();

    this.setTimer(ROUND_END_DELAY, () => {
      if (this.round > this.settings.rounds) {
        this.endGame();
      } else {
        this.startTurn();
      }
    });
  }

  private advanceTurnIndex() {
    this.turnIndex++;
    if (this.turnIndex >= this.turnOrder.length) {
      this.turnIndex = 0;
      this.round++;
    }
  }

  private endGame() {
    this.clearTimer();
    this.clearHintTimers();
    this.phase = GamePhase.GAME_OVER;
    if (this.round > this.settings.rounds) {
      this.round = this.settings.rounds;
    }
    this.endsAt = null;
    this.currentWord = null;

    this.players.forEach((p) => {
      p.isDrawing = false;
      p.hasGuessed = false;
      p.isReady = false;
    });

    const { leaderboard, winner, winners } = determineWinners(
      this.players.map((p) => p.toJSON())
    );

    this.io.to(this.roomCode).emit(SocketEvent.GameOver, {
      winner,
      winners,
      leaderboard,
    });

    this.broadcastState();
    this.onEnd();
  }

  removePlayer(id: string) {
    const idx = this.turnOrder.indexOf(id);
    if (idx === -1) return;

    const wasDrawing = this.turnOrder[this.turnIndex] === id;

    this.turnOrder.splice(idx, 1);
    if (this.turnOrder.length === 0) {
      this.endGame();
      return;
    }

    if (idx < this.turnIndex) {
      this.turnIndex--;
    } else if (idx === this.turnIndex) {
      if (this.turnIndex >= this.turnOrder.length) {
        this.turnIndex = 0;
        this.round++;
      }
    }

    if (this.players.length < 2) {
      this.endGame();
      return;
    }

    if (wasDrawing) {
      this.clearTimer();
      this.clearHintTimers();
      this.currentWord = null;
      this.endsAt = null;
      this.phase = GamePhase.ROUND_END;

      const scores: Record<string, number> = {};
      this.players.forEach((p) => (scores[p.id] = p.score));

      this.io.to(this.roomCode).emit(SocketEvent.RoundEnd, {
        word: "(skipped)",
        scores,
        turnPoints: this.turnScores,
        nextDrawerId: this.drawer?.id ?? null,
      });

      this.broadcastState();
      this.setTimer(ROUND_END_DELAY, () => {
        if (this.round > this.settings.rounds) {
          this.endGame();
        } else {
          this.startTurn();
        }
      });
    }
  }

  destroy() {
    this.clearTimer();
    this.clearHintTimers();
  }

  get currentStrokes() {
    return this.strokes;
  }

  handleDrawStart(playerId: string, data: DrawStartPayload) {
    if (this.phase !== GamePhase.DRAWING) return false;
    if (this.drawer?.id !== playerId) return false;
    if (!data || !this.validateCoord(data.x) || !this.validateCoord(data.y))
      return false;
    if (!this.validateColor(data.color)) return false;
    if (!this.validateSize(data.size)) return false;
    if (data.tool !== "brush" && data.tool !== "eraser") return false;

    this.pendingStroke = {
      points: [{ x: data.x, y: data.y }],
      color: data.color,
      size: data.size,
      tool: data.tool,
    };
    this.io.to(this.roomCode).emit(SocketEvent.DrawData, {
      type: "start",
      x: data.x,
      y: data.y,
      color: data.color,
      size: data.size,
      tool: data.tool,
    });
    return true;
  }

  handleDrawMove(playerId: string, data: DrawMovePayload) {
    if (this.phase !== GamePhase.DRAWING) return false;
    if (this.drawer?.id !== playerId) return false;
    if (!this.pendingStroke) return false;
    if (!data || !this.validateCoord(data.x) || !this.validateCoord(data.y))
      return false;

    const now = Date.now();
    if (now - this.lastDrawMoveTime < 10) return false;
    this.lastDrawMoveTime = now;

    this.pendingStroke.points.push({ x: data.x, y: data.y });
    this.io.to(this.roomCode).emit(SocketEvent.DrawData, {
      type: "move",
      x: data.x,
      y: data.y,
    });
    return true;
  }

  handleDrawEnd(playerId: string) {
    if (this.drawer?.id !== playerId) return false;
    if (!this.pendingStroke) return false;

    this.strokes.push(this.pendingStroke);
    this.pendingStroke = null;
    this.io.to(this.roomCode).emit(SocketEvent.DrawData, { type: "end" });
    return true;
  }

  handleClear(playerId: string) {
    if (this.phase !== GamePhase.DRAWING) return false;
    if (this.drawer?.id !== playerId) return false;

    this.strokes = [];
    this.pendingStroke = null;
    this.io.to(this.roomCode).emit(SocketEvent.CanvasClear);
    return true;
  }

  handleUndo(playerId: string) {
    if (this.phase !== GamePhase.DRAWING) return false;
    if (this.drawer?.id !== playerId) return false;
    if (this.strokes.length === 0) return false;

    this.strokes.pop();
    this.io.to(this.roomCode).emit(SocketEvent.DrawUndo, {
      strokes: this.strokes,
    });
    return true;
  }

  private validateCoord(v: number) {
    return typeof v === "number" && v >= 0 && v <= 1;
  }

  private validateColor(c: string) {
    return typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
  }

  private validateSize(s: number) {
    return typeof s === "number" && s >= 1 && s <= 50;
  }

  getStateForPlayer(playerId: string) {
    const isDrawer = this.drawer?.id === playerId;
    const player = this.players.find((p) => p.id === playerId);
    const hasGuessed = player?.hasGuessed ?? false;
    const canSeeWord =
      isDrawer ||
      hasGuessed ||
      this.phase === GamePhase.ROUND_END ||
      this.phase === GamePhase.GAME_OVER;

    const state: any = {
      phase: this.phase,
      round: Math.min(this.round, this.settings.rounds),
      totalRounds: this.settings.rounds,
      drawerId: this.drawer?.id ?? null,
      wordLength: canSeeWord
        ? this.currentWord?.length ?? null
        : this.hintManager?.getWordLengthForDisplay() ?? null,
      word: canSeeWord ? this.currentWord : null,
      hint: canSeeWord
        ? this.currentWord
        : this.hintManager?.getMaskedHint() ?? null,
      endsAt: this.endsAt,
      players: this.players.map((p) => p.toJSON()),
    };

    if (this.phase === GamePhase.WORD_SELECT && isDrawer) {
      state.wordOptions = this.wordOptions;
    }

    return state;
  }

  public broadcastState() {
    for (const p of this.players) {
      if (p.isConnected && p.socketId) {
        const roomData = this.buildRoomData(p.id);
        this.io.to(p.socketId).emit(SocketEvent.GameState, {
          room: roomData,
          strokes: this.strokes,
          hint: roomData.hint ?? null,
        });
      }
    }
  }

  buildRoomData(forPlayerId: string): RoomData {
    const host = this.players.find((p) => p.isHost);
    const player = this.players.find((p) => p.id === forPlayerId);
    const isDrawer = this.drawer?.id === forPlayerId;
    const hasGuessed = player?.hasGuessed ?? false;
    const canSeeWord =
      isDrawer ||
      hasGuessed ||
      this.phase === GamePhase.ROUND_END ||
      this.phase === GamePhase.GAME_OVER;

    const data: RoomData = {
      code: this.roomCode,
      players: this.players.map((p) => p.toJSON()),
      settings: this.settings,
      phase: this.phase,
      hostId: host?.id ?? "",
      currentRound: Math.min(this.round, this.settings.rounds),
      totalRounds: this.settings.rounds,
      currentDrawer: this.drawer?.id ?? null,
      wordLength: canSeeWord
        ? this.currentWord?.length ?? null
        : this.hintManager?.getWordLengthForDisplay() ?? null,
      endsAt: this.endsAt,
      word: canSeeWord ? this.currentWord : null,
      hint: canSeeWord
        ? this.currentWord
        : this.hintManager?.getMaskedHint() ?? null,
    };

    if (this.phase === GamePhase.WORD_SELECT && isDrawer) {
      data.wordOptions = this.wordOptions;
    }

    return data;
  }

  private broadcast(event: string, data: unknown, excludeId?: string) {
    for (const p of this.players) {
      if (p.id !== excludeId && p.isConnected && p.socketId) {
        this.io.to(p.socketId).emit(event, data);
      }
    }
  }

  private setTimer(ms: number, cb: () => void) {
    this.clearTimer();
    this.timer = setTimeout(cb, ms);
  }

  private clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private clearHintTimers() {
    this.hintTimers.forEach((t) => clearTimeout(t));
    this.hintTimers = [];
  }
}
