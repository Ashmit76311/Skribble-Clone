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
  isReady = false;
  ip?: string;
  deviceId?: string;
  disconnectTimer: NodeJS.Timeout | null = null;
  disconnectedAt: number | null = null;
  lastReconnectedMsgAt = 0;

  constructor(socketId: string, name: string, ip?: string, deviceId?: string) {
    this.id = crypto.randomUUID();
    this.token = crypto.randomUUID();
    this.socketId = socketId;
    this.name = name;
    this.ip = ip;
    this.deviceId = deviceId;
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
      isReady: this.isHost || this.isReady,
    };
  }
}
