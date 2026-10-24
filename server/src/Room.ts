import { Server } from "socket.io";
import { GamePhase, RoomData, RoomSettings, WordMode } from "@skribbl/shared";
import { Player } from "./Player.js";
import { Game } from "./Game.js";

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(v)));
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
  };
}

export function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++)
    code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export class Room {
  code: string;
  players: Player[] = [];
  settings: RoomSettings;
  phase = GamePhase.LOBBY;
  game: Game | null = null;

  constructor(code: string, settings: RoomSettings) {
    this.code = code;
    this.settings = validateSettings(settings);
  }

  get host(): Player | undefined {
    return this.players.find((p) => p.isHost);
  }

  addPlayer(player: Player): string | null {
    if (this.players.length >= this.settings.maxPlayers) return "Room is full";
    if (this.phase !== GamePhase.LOBBY) return "Game already in progress";
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
    if (player.isHost && this.players.length > 0) {
      this.players[0].isHost = true;
    }
    if (this.game) {
      this.game.removePlayer(id);
    }
    return player;
  }

  startGame(io: Server): string | null {
    if (this.players.length < 2) return "Need at least 2 players";
    if (this.phase !== GamePhase.LOBBY) return "Game already in progress";

    this.game = new Game(io, this.code, this.settings, this.players, () => {
      this.phase = GamePhase.GAME_OVER;
    });
    this.phase = GamePhase.WORD_SELECT;
    this.game.start();
    return null;
  }

  resetToLobby() {
    if (this.game) {
      this.game.destroy();
      this.game = null;
    }
    this.phase = GamePhase.LOBBY;
    this.players.forEach((p) => {
      p.score = 0;
      p.isDrawing = false;
      p.hasGuessed = false;
    });
  }

  broadcast(io: Server, event: string, data: unknown) {
    io.to(this.code).emit(event, data);
  }

  toJSON(): RoomData {
    return {
      code: this.code,
      players: this.players.map((p) => p.toJSON()),
      settings: this.settings,
      phase: this.game ? this.game.currentPhase : this.phase,
      hostId: this.host?.id ?? "",
      currentRound: this.game ? this.game.currentRound : 0,
      totalRounds: this.settings.rounds,
      currentDrawer: this.game?.drawer?.id ?? null,
      wordLength: this.game?.currentWordLength ?? null,
      endsAt: this.game?.endsAtTimestamp ?? null,
    };
  }
}
