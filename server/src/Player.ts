import { PlayerData } from "@skribbl/shared";

export class Player {
  id: string;
  name: string;
  score = 0;
  isHost = false;

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

  toJSON(): PlayerData {
    return {
      id: this.id,
      name: this.name,
      score: this.score,
      isHost: this.isHost,
      isDrawing: false,
      hasGuessed: false,
      isConnected: true,
    };
  }
}
