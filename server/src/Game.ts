import { Server } from "socket.io";
import { GamePhase, SocketEvent } from "@skribbl/shared";
import type { RoomSettings, Stroke, Point, DrawStartPayload, DrawMovePayload } from "@skribbl/shared";
import { Player } from "./Player.js";
import words from "../words.json" with { type: "json" };

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
  private endsAt: number | null = null;
  private onEnd: () => void;
  private strokes: Stroke[] = [];
  private pendingStroke: Stroke | null = null;
  private lastDrawMoveTime = 0;

  constructor(
    io: Server,
    roomCode: string,
    settings: RoomSettings,
    players: Player[],
    onEnd: () => void
  ) {
    this.io = io;
    this.roomCode = roomCode;
    this.settings = settings;
    this.players = players;
    this.onEnd = onEnd;
    this.wordPool = allWords();
  }

  get currentPhase() {
    return this.phase;
  }

  get currentRound() {
    return this.round;
  }

  get drawer(): Player | undefined {
    const id = this.turnOrder[this.turnIndex];
    return this.players.find((p) => p.id === id);
  }

  get endsAtTimestamp() {
    return this.endsAt;
  }

  get currentWordLength() {
    return this.currentWord?.length ?? null;
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

    this.players.forEach((p) => {
      p.isDrawing = false;
      p.hasGuessed = false;
    });

    const drawer = this.drawer;
    if (!drawer) return this.endGame();
    drawer.isDrawing = true;

    const available = this.wordPool.filter((w) => !this.usedWords.has(w));
    if (available.length < this.settings.wordCount) {
      this.usedWords.clear();
    }
    const pool = this.wordPool.filter((w) => !this.usedWords.has(w));
    this.wordOptions = pickRandom(pool, this.settings.wordCount);

    this.endsAt = Date.now() + WORD_SELECT_TIME;

    this.io.to(drawer.id).emit(SocketEvent.RoundStart, {
      round: this.round,
      drawerId: drawer.id,
      endsAt: this.endsAt,
      wordOptions: this.wordOptions,
    });

    this.broadcast(SocketEvent.RoundStart, {
      round: this.round,
      drawerId: drawer.id,
      endsAt: this.endsAt,
    }, drawer.id);

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

    this.endsAt = Date.now() + this.settings.drawTime * 1000;

    this.broadcast(SocketEvent.WordChosen, {
      wordLength: word.length,
      endsAt: this.endsAt,
    }, this.drawer?.id);

    if (this.drawer) {
      this.io.to(this.drawer.id).emit(SocketEvent.WordChosen, {
        wordLength: word.length,
        endsAt: this.endsAt,
        word,
      });
    }

    this.broadcastState();
    this.setTimer(this.settings.drawTime * 1000, () => this.endTurn());
    return true;
  }

  private autoPickWord() {
    if (this.phase !== GamePhase.WORD_SELECT) return;
    const word = this.wordOptions[Math.floor(Math.random() * this.wordOptions.length)];
    if (this.drawer) this.chooseWord(this.drawer.id, word);
  }

  endTurn() {
    if (this.phase !== GamePhase.DRAWING && this.phase !== GamePhase.WORD_SELECT) return;
    this.clearTimer();
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
    this.phase = GamePhase.GAME_OVER;
    this.endsAt = null;
    this.currentWord = null;

    this.players.forEach((p) => {
      p.isDrawing = false;
      p.hasGuessed = false;
    });

    const sorted = [...this.players].sort((a, b) => b.score - a.score);
    const leaderboard = sorted.map((p) => p.toJSON());

    this.io.to(this.roomCode).emit(SocketEvent.GameOver, {
      winner: leaderboard[0],
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
      this.currentWord = null;
      this.endsAt = null;
      this.phase = GamePhase.ROUND_END;

      const scores: Record<string, number> = {};
      this.players.forEach((p) => (scores[p.id] = p.score));

      this.io.to(this.roomCode).emit(SocketEvent.RoundEnd, {
        word: "(skipped)",
        scores,
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
  }

  get currentStrokes() {
    return this.strokes;
  }

  handleDrawStart(playerId: string, data: DrawStartPayload) {
    if (this.phase !== GamePhase.DRAWING) return false;
    if (this.drawer?.id !== playerId) return false;
    if (!data || !this.validateCoord(data.x) || !this.validateCoord(data.y)) return false;
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
    if (!data || !this.validateCoord(data.x) || !this.validateCoord(data.y)) return false;

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
    this.io.to(this.roomCode).emit(SocketEvent.DrawUndo, { strokes: this.strokes });
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
    return {
      phase: this.phase,
      round: this.round,
      totalRounds: this.settings.rounds,
      drawerId: this.drawer?.id ?? null,
      wordLength: this.currentWord?.length ?? null,
      word: isDrawer ? this.currentWord : null,
      endsAt: this.endsAt,
      players: this.players.map((p) => p.toJSON()),
    };
  }

  private broadcastState() {
    for (const p of this.players) {
      this.io.to(p.id).emit(SocketEvent.GameState, {
        room: this.buildRoomData(p.id),
        strokes: this.strokes,
        hint: null,
      });
    }
  }

  private buildRoomData(forPlayerId: string) {
    const host = this.players.find((p) => p.isHost);
    return {
      code: this.roomCode,
      players: this.players.map((p) => p.toJSON()),
      settings: this.settings,
      phase: this.phase,
      hostId: host?.id ?? "",
      currentRound: this.round,
      totalRounds: this.settings.rounds,
      currentDrawer: this.drawer?.id ?? null,
      wordLength: this.currentWord?.length ?? null,
      endsAt: this.endsAt,
      word: forPlayerId === this.drawer?.id ? this.currentWord : null,
    };
  }

  private broadcast(event: string, data: unknown, excludeId?: string) {
    for (const p of this.players) {
      if (p.id !== excludeId) {
        this.io.to(p.id).emit(event, data);
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
}
