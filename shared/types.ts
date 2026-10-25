export enum GamePhase {
  LOBBY = "lobby",
  WORD_SELECT = "word_select",
  DRAWING = "drawing",
  ROUND_END = "round_end",
  GAME_OVER = "game_over",
}

export enum WordMode {
  Normal = "normal",
  Hidden = "hidden",
  Combination = "combination",
}

export interface RoomSettings {
  maxPlayers: number;
  rounds: number;
  drawTime: number;
  wordCount: number;
  hints: number;
  wordMode: WordMode;
  isPublic: boolean;
  customWords: string[];
  useCustomOnly: boolean;
}

export interface PlayerData {
  id: string;
  name: string;
  score: number;
  isHost: boolean;
  isDrawing: boolean;
  hasGuessed: boolean;
  isConnected: boolean;
  isReady: boolean;
}

export interface RoomData {
  code: string;
  players: PlayerData[];
  settings: RoomSettings;
  phase: GamePhase;
  hostId: string;
  currentRound: number;
  totalRounds: number;
  currentDrawer: string | null;
  wordLength: number | null;
  endsAt: number | null;
  word?: string | null;
  hint?: string | null;
  wordOptions?: string[];
}

export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  points: Point[];
  color: string;
  size: number;
  tool: "brush" | "eraser";
}

export interface CreateRoomPayload {
  name: string;
  settings: RoomSettings;
}

export interface JoinRoomPayload {
  name: string;
  code: string;
}

export interface GuessPayload {
  text: string;
}

export interface ChatPayload {
  text: string;
}

export interface DrawStartPayload {
  x: number;
  y: number;
  color: string;
  size: number;
  tool: "brush" | "eraser";
}

export interface DrawMovePayload {
  x: number;
  y: number;
}

export interface DrawDataPayload {
  type: "start" | "move" | "end";
  x?: number;
  y?: number;
  color?: string;
  size?: number;
  tool?: "brush" | "eraser";
}

export interface DrawUndoPayload {
  strokes: Stroke[];
}

export interface RoundStartPayload {
  round: number;
  drawerId: string;
  endsAt: number;
  wordOptions?: string[];
}

export interface WordChosenPayload {
  wordLength: number;
  endsAt: number;
  word?: string;
  hint?: string;
}

export interface SelectWordPayload {
  word: string;
}

export interface RoundEndPayload {
  word: string;
  scores: Record<string, number>;
  turnPoints: Record<string, number>;
  nextDrawerId: string | null;
}

export interface GameOverPayload {
  winner: PlayerData;
  winners: PlayerData[];
  leaderboard: PlayerData[];
}

export interface GameStatePayload {
  room: RoomData;
  strokes: Stroke[];
  hint: string | null;
}

export interface GuessResultPayload {
  playerId: string;
  playerName: string;
  correct: boolean;
  points?: number;
  scores?: Record<string, number>;
}

export interface ChatMessagePayload {
  playerId?: string;
  name: string;
  text: string;
  type?: "chat" | "guess" | "correct" | "close" | "system";
}

export interface HostChangedPayload {
  hostId: string;
}

export interface HintUpdatePayload {
  hint: string;
}

export interface TimerPayload {
  timeLeft: number;
}

export interface ErrorPayload {
  message: string;
}

export interface PlayerJoinedPayload {
  player: PlayerData;
  players: PlayerData[];
}

export interface PlayerLeftPayload {
  playerId: string;
  name: string;
  players: PlayerData[];
}

export interface RejoinRoomPayload {
  code: string;
  token: string;
}

export interface RejoinRoomResponse {
  room?: RoomData;
  strokes?: Stroke[];
  hasGuessed?: boolean;
  chatHistory?: ChatMessagePayload[];
  playerId?: string;
  token?: string;
  wordOptions?: string[];
  error?: string;
}

export interface CreateRoomResponse {
  room?: RoomData;
  token?: string;
  playerId?: string;
  error?: string;
}

export interface JoinRoomResponse {
  room?: RoomData;
  token?: string;
  playerId?: string;
  error?: string;
}

export interface KickPlayerPayload {
  playerId: string;
  ban?: boolean;
}

export interface KickedPayload {
  message: string;
  banned?: boolean;
}

export interface UpdateSettingsPayload {
  settings: Partial<RoomSettings>;
}

