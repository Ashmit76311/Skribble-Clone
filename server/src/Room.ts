import { Server } from "socket.io";
import {
  GamePhase,
  RoomData,
  RoomSettings,
  WordMode,
  ChatMessagePayload,
  SocketEvent,
} from "@skribbl/shared";
import { Player } from "./Player.js";
import { Game } from "./Game.js";

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(v)));
}

export function validateCustomWords(raw: unknown): string[] {
  if (!raw) return [];
  const rawList: string[] = Array.isArray(raw)
    ? raw.flatMap((s) => (typeof s === "string" ? s.split(/[,\n\r]+/) : []))
    : typeof raw === "string"
    ? raw.split(/[,\n\r]+/)
    : [];

  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of rawList) {
    const cleaned = item.trim().toLowerCase();
    // 2 to 30 characters each, letters, spaces and hyphens only, must contain at least one letter
    if (
      cleaned.length >= 2 &&
      cleaned.length <= 30 &&
      /^[a-z -]+$/.test(cleaned) &&
      /[a-z]/.test(cleaned)
    ) {
      if (!seen.has(cleaned)) {
        seen.add(cleaned);
        result.push(cleaned);
        if (result.length >= 100) break;
      }
    }
  }

  return result;
}

export function validateSettings(raw: Partial<RoomSettings>): RoomSettings {
  return {
    maxPlayers: clamp(raw.maxPlayers ?? 8, 2, 20),
    rounds: clamp(raw.rounds ?? 3, 2, 10),
    drawTime: clamp(raw.drawTime ?? 80, 15, 240),
    wordCount: clamp(raw.wordCount ?? 3, 1, 5),
    hints: clamp(raw.hints ?? 2, 0, 5),
    wordMode: Object.values(WordMode).includes(raw.wordMode as WordMode)
      ? (raw.wordMode as WordMode)
      : WordMode.Normal,
    isPublic: typeof raw.isPublic === "boolean" ? raw.isPublic : true,
    customWords: validateCustomWords(raw.customWords),
    useCustomOnly: typeof raw.useCustomOnly === "boolean" ? raw.useCustomOnly : false,
  };
}

export function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++)
    code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export interface StoredChatMessage {
  msg: ChatMessagePayload;
  visibility: "all" | "non_guessers" | "drawer_or_guessed";
}

export class Room {
  code: string;
  players: Player[] = [];
  settings: RoomSettings;
  phase = GamePhase.LOBBY;
  game: Game | null = null;
  chatHistory: StoredChatMessage[] = [];
  bannedIds = new Set<string>();

  banPlayer(player: Player) {
    if (player.id) this.bannedIds.add(player.id);
    if (player.deviceId) this.bannedIds.add(player.deviceId);
  }

  isBanned(playerId?: string, deviceId?: string): boolean {
    if (playerId && this.bannedIds.has(playerId)) return true;
    if (deviceId && this.bannedIds.has(deviceId)) return true;
    return false;
  }

  constructor(code: string, settings: RoomSettings) {
    this.code = code;
    this.settings = validateSettings(settings);
  }

  get host(): Player | undefined {
    return this.players.find((p) => p.isHost);
  }

  getPlayerByToken(token: string): Player | undefined {
    return this.players.find((p) => p.token === token);
  }

  getPlayerById(id: string): Player | undefined {
    return this.players.find((p) => p.id === id);
  }

  getPlayerBySocketId(socketId: string): Player | undefined {
    return this.players.find((p) => p.socketId === socketId);
  }

  addChatMessage(
    msg: ChatMessagePayload,
    visibility: "all" | "non_guessers" | "drawer_or_guessed" = "all"
  ) {
    this.chatHistory.push({ msg, visibility });
    if (this.chatHistory.length > 200) {
      this.chatHistory.shift();
    }
  }

  getChatHistoryForPlayer(player: Player): ChatMessagePayload[] {
    const isDrawer = this.game?.drawer?.id === player.id;
    const hasGuessed = player.hasGuessed;
    const isDrawingPhase = this.game?.currentPhase === GamePhase.DRAWING;

    const visible = this.chatHistory.filter((item) => {
      if (item.visibility === "all") return true;
      if (!isDrawingPhase) return true;
      if (item.visibility === "drawer_or_guessed") {
        return isDrawer || hasGuessed;
      }
      if (item.visibility === "non_guessers") {
        return !isDrawer && !hasGuessed;
      }
      return true;
    });

    return visible.slice(-50).map((item) => item.msg);
  }

  addPlayer(player: Player): string | null {
    if (this.isBanned(player.id, player.deviceId)) {
      return "You are banned from this room";
    }
    if (this.players.length >= this.settings.maxPlayers) return "Room is full";
    if (this.phase === GamePhase.GAME_OVER) return "Game is over";
    if (this.players.some((p) => p.name === player.name))
      return "Name already taken";
    this.players.push(player);
    if (this.players.length === 1) player.isHost = true;
    return null;
  }

  removePlayer(id: string): Player | null {
    const idx = this.players.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const [player] = this.players.splice(idx, 1);
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }
    if (player.isHost && this.players.length > 0) {
      this.players[0].isHost = true;
    }
    if (this.game) {
      this.game.removePlayer(id);
    }
    return player;
  }

  clearAllTimers() {
    for (const p of this.players) {
      if (p.disconnectTimer) {
        clearTimeout(p.disconnectTimer);
        p.disconnectTimer = null;
      }
    }
  }

  startGame(io: Server): string | null {
    if (this.players.length < 2) return "Need at least 2 players";
    if (this.phase !== GamePhase.LOBBY) return "Game already in progress";
    const notReady = this.players.find(
      (p) => !p.isHost && p.isConnected && !p.isReady
    );
    if (notReady) return `${notReady.name} is not ready`;

    this.game = new Game(
      io,
      this.code,
      this.settings,
      this.players,
      () => {
        this.phase = GamePhase.GAME_OVER;
      },
      (msg, visibility) => {
        this.addChatMessage(msg, visibility);
      }
    );
    this.phase = GamePhase.WORD_SELECT;
    this.game.start();
    return null;
  }

  resetToLobby() {
    this.clearAllTimers();
    if (this.game) {
      this.game.destroy();
      this.game = null;
    }
    this.phase = GamePhase.LOBBY;
    this.players.forEach((p) => {
      p.score = 0;
      p.isDrawing = false;
      p.hasGuessed = false;
      p.isReady = false;
    });
  }

  updateSettings(newSettings: Partial<RoomSettings>) {
    this.settings = validateSettings({
      ...this.settings,
      ...newSettings,
    });
  }

  broadcast(io: Server, event: string, data: unknown) {
    io.to(this.code).emit(event, data);
  }

  broadcastLobbyState(io: Server) {
    // Broadcast sanitized lobby state (customWords: []) to all players in the room
    io.to(this.code).emit(SocketEvent.GameState, {
      room: this.toJSON(),
      strokes: [],
      hint: null,
    });
    // Send full lobby state (with customWords) specifically to the host
    if (this.host && this.host.isConnected && this.host.socketId) {
      const hostSocket = io.sockets.sockets.get(this.host.socketId);
      if (hostSocket) {
        hostSocket.emit(SocketEvent.GameState, {
          room: this.toJSON(this.host.id),
          strokes: [],
          hint: null,
        });
      } else {
        io.to(this.host.socketId).emit(SocketEvent.GameState, {
          room: this.toJSON(this.host.id),
          strokes: [],
          hint: null,
        });
      }
    }
  }

  toJSON(forPlayerId?: string): RoomData {
    const isHost = this.host?.id === forPlayerId;
    const isLobby = this.phase === GamePhase.LOBBY;
    const settingsToSend: RoomSettings = {
      ...this.settings,
      customWords: isHost && isLobby ? this.settings.customWords : [],
    };
    return {
      code: this.code,
      players: this.players.map((p) => p.toJSON()),
      settings: settingsToSend,
      phase: this.game ? this.game.currentPhase : this.phase,
      hostId: this.host?.id ?? "",
      currentRound: this.game ? this.game.currentRound : 0,
      totalRounds: this.settings.rounds,
      currentDrawer: this.game?.drawer?.id ?? null,
      wordLength: this.game?.currentWordLength ?? null,
      endsAt: this.game?.endsAtTimestamp ?? null,
      hint: null,
    };
  }
}
