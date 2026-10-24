import { Server, Socket } from "socket.io";
import { SocketEvent } from "@skribbl/shared";
import type { CreateRoomPayload, JoinRoomPayload } from "@skribbl/shared";
import { RoomManager } from "./RoomManager.js";
import { Player } from "./Player.js";

export function registerHandlers(io: Server, manager: RoomManager) {
  io.on("connection", (socket) => {
    console.log(`connected: ${socket.id}`);

    socket.on(SocketEvent.CreateRoom, (data: CreateRoomPayload, cb) => {
      const name = data.name?.trim();
      if (!name) return cb({ error: "Name is required" });

      const room = manager.createRoom(data.settings || {});
      const player = new Player(socket.id, name);
      room.addPlayer(player);
      socket.join(room.code);
      manager.trackSocket(socket.id, room.code);
      cb({ room: room.toJSON() });
    });

    socket.on(SocketEvent.JoinRoom, (data: JoinRoomPayload, cb) => {
      const name = data.name?.trim();
      if (!name) return cb({ error: "Name is required" });

      const room = manager.getRoom(data.code);
      if (!room) return cb({ error: "Room not found" });

      const player = new Player(socket.id, name);
      const err = room.addPlayer(player);
      if (err) return cb({ error: err });

      socket.join(room.code);
      manager.trackSocket(socket.id, room.code);

      socket.to(room.code).emit(SocketEvent.PlayerJoined, {
        player: player.toJSON(),
        players: room.players.map((p) => p.toJSON()),
      });

      cb({ room: room.toJSON() });
    });

    socket.on(SocketEvent.StartGame, () => {
      const room = manager.getRoomForSocket(socket.id);
      if (!room) return;
      const player = room.players.find((p) => p.id === socket.id);
      if (!player?.isHost) {
        return socket.emit(SocketEvent.Error, { message: "Only host can start" });
      }
      if (room.players.length < 2) {
        return socket.emit(SocketEvent.Error, { message: "Need at least 2 players" });
      }
      // placeholder until Phase 2 game engine
      room.broadcast(io, SocketEvent.GameState, { room: room.toJSON() });
    });

    socket.on("disconnect", () => {
      const room = manager.getRoomForSocket(socket.id);
      if (!room) return;

      const removed = room.removePlayer(socket.id);
      manager.removeSocket(socket.id);
      if (!removed) return;

      if (room.players.length === 0) {
        manager.deleteRoom(room.code);
        return;
      }

      room.broadcast(io, SocketEvent.PlayerLeft, {
        playerId: removed.id,
        name: removed.name,
        players: room.players.map((p) => p.toJSON()),
      });

      // host was reassigned inside removePlayer
      if (removed.isHost) {
        room.broadcast(io, SocketEvent.HostChanged, {
          hostId: room.host!.id,
        });
      }
    });
  });
}
