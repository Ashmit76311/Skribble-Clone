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
}

export interface PlayerData {
  id: string;
  name: string;
  score: number;
  isHost: boolean;
  isDrawing: boolean;
  hasGuessed: boolean;
  isConnected: boolean;
}

export interface RoomData {
  code: string;
  players: PlayerData[];
  settings: RoomSettings;
  phase: GamePhase;
  hostId: string;
  currentRound: number;
  currentDrawer: string | null;
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

export interface DrawMovePayload {
  point: Point;
  color: string;
  size: number;
  tool: "brush" | "eraser";
}

export interface DrawStartPayload {
  point: Point;
  color: string;
  size: number;
  tool: "brush" | "eraser";
}

export interface RoundStartPayload {
  round: number;
  drawerId: string;
  drawTime: number;
  wordOptions?: string[];
}

export interface WordChosenPayload {
  wordLength: number;
}

export interface RoundEndPayload {
  word: string;
  scores: Record<string, number>;
}

export interface GameOverPayload {
  players: PlayerData[];
}

export interface GameStatePayload {
  room: RoomData;
  strokes: Stroke[];
  timeLeft: number;
  hint: string | null;
}

export interface GuessResultPayload {
  playerId: string;
  correct: boolean;
  close?: boolean;
  text?: string;
}

export interface ChatMessagePayload {
  playerId: string;
  name: string;
  text: string;
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
