import { PlayerData } from "@skribbl/shared";
import crypto from "crypto";

export class Player {
  id: string;
  token: string;
  socketId: string;
  name: string;
  score = 0;
  isHost = false;
  isDrawing = false;
  hasGuessed = false;
  isConnected = true;
  disconnectTimer: NodeJS.Timeout | null = null;

  constructor(socketId: string, name: string) {
    this.id = crypto.randomUUID();
    this.token = crypto.randomUUID();
    this.socketId = socketId;
    this.name = name;
  }

  toJSON(): PlayerData {
    return {
      id: this.id,
      name: this.name,
      score: this.score,
      isHost: this.isHost,
      isDrawing: this.isDrawing,
      hasGuessed: this.hasGuessed,
      isConnected: this.isConnected,
    };
  }
}
