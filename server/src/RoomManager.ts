import { GamePhase } from "@skribbl/shared";
import { Room, generateCode, validateSettings } from "./Room.js";
import type { RoomSettings } from "@skribbl/shared";

export class RoomManager {
  private rooms = new Map<string, Room>();
  private socketToRoom = new Map<string, string>();

  createRoom(settings: Partial<RoomSettings>): Room {
    let code = generateCode();
    while (this.rooms.has(code)) code = generateCode();
    const room = new Room(code, validateSettings(settings));
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code?.toUpperCase());
  }

  deleteRoom(code: string) {
    this.rooms.delete(code);
  }

  listPublicRooms() {
    return [...this.rooms.values()].filter(
      (r) => r.settings.isPublic && r.phase === GamePhase.LOBBY
    );
  }

  trackSocket(socketId: string, code: string) {
    this.socketToRoom.set(socketId, code);
  }

  getRoomForSocket(socketId: string): Room | undefined {
    const code = this.socketToRoom.get(socketId);
    return code ? this.rooms.get(code) : undefined;
  }

  removeSocket(socketId: string) {
    this.socketToRoom.delete(socketId);
  }
}
