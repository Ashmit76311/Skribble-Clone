import { Server, Socket } from "socket.io";
import { SocketEvent } from "@skribbl/shared";
import type {
  CreateRoomPayload,
  JoinRoomPayload,
  SelectWordPayload,
  DrawStartPayload,
  DrawMovePayload,
} from "@skribbl/shared";
import { RoomManager } from "./RoomManager.js";
import { Player } from "./Player.js";

const chatTimestamps = new Map<string, number[]>();

function checkRateLimit(socketId: string): boolean {
  const now = Date.now();
  const times = chatTimestamps.get(socketId) ?? [];
  const valid = times.filter((t) => now - t < 2000);
  if (valid.length >= 5) return false;
  valid.push(now);
  chatTimestamps.set(socketId, valid);
  return true;
}

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

      if (room.game) {
        socket.emit(SocketEvent.GameState, {
          room: room.toJSON(),
          strokes: room.game.currentStrokes,
          hint: null,
        });
      }
    });

    socket.on(SocketEvent.StartGame, () => {
      const room = manager.getRoomForSocket(socket.id);
      if (!room) return;
      const player = room.players.find((p) => p.id === socket.id);
      if (!player?.isHost) {
        return socket.emit(SocketEvent.Error, { message: "Only host can start" });
      }
      const err = room.startGame(io);
      if (err) {
        return socket.emit(SocketEvent.Error, { message: err });
      }
    });

    socket.on(SocketEvent.SelectWord, (data: SelectWordPayload) => {
      const room = manager.getRoomForSocket(socket.id);
      if (!room || !room.game) return;
      if (!data?.word) return;
      room.game.chooseWord(socket.id, data.word);
    });

    socket.on(SocketEvent.DrawStart, (data: DrawStartPayload) => {
      const room = manager.getRoomForSocket(socket.id);
      if (!room || !room.game) return;
      room.game.handleDrawStart(socket.id, data);
    });

    socket.on(SocketEvent.DrawMove, (data: DrawMovePayload) => {
      const room = manager.getRoomForSocket(socket.id);
      if (!room || !room.game) return;
      room.game.handleDrawMove(socket.id, data);
    });

    socket.on(SocketEvent.DrawEnd, () => {
      const room = manager.getRoomForSocket(socket.id);
      if (!room || !room.game) return;
      room.game.handleDrawEnd(socket.id);
    });

    socket.on(SocketEvent.CanvasClear, () => {
      const room = manager.getRoomForSocket(socket.id);
      if (!room || !room.game) return;
      room.game.handleClear(socket.id);
    });

    socket.on(SocketEvent.DrawUndo, () => {
      const room = manager.getRoomForSocket(socket.id);
      if (!room || !room.game) return;
      room.game.handleUndo(socket.id);
    });

    socket.on(SocketEvent.EndTurn, () => {
      const room = manager.getRoomForSocket(socket.id);
      if (!room || !room.game) return;
      if (room.game.drawer?.id !== socket.id) return;
      room.game.endTurn();
    });

    socket.on(SocketEvent.Chat, (data: { text: string }) => {
      if (!checkRateLimit(socket.id)) return;
      const room = manager.getRoomForSocket(socket.id);
      if (!room || !data?.text) return;

      if (room.game) {
        room.game.handleChat(socket.id, data.text);
      } else {
        const player = room.players.find((p) => p.id === socket.id);
        if (!player) return;
        const text = data.text.trim().slice(0, 200);
        if (!text) return;
        io.to(room.code).emit(SocketEvent.ChatMessage, {
          playerId: player.id,
          name: player.name,
          text,
          type: "chat",
        });
      }
    });

    socket.on(SocketEvent.Guess, (data: { text: string }) => {
      if (!checkRateLimit(socket.id)) return;
      const room = manager.getRoomForSocket(socket.id);
      if (!room || !room.game || !data?.text) return;
      room.game.handleGuess(socket.id, data.text);
    });

    socket.on(SocketEvent.PlayAgain, () => {
      const room = manager.getRoomForSocket(socket.id);
      if (!room) return;
      const player = room.players.find((p) => p.id === socket.id);
      if (!player?.isHost) {
        return socket.emit(SocketEvent.Error, { message: "Only host can restart" });
      }
      room.resetToLobby();
      room.broadcast(io, SocketEvent.GameState, {
        room: room.toJSON(),
        strokes: [],
        hint: null,
      });
    });

    socket.on("disconnect", () => {
      chatTimestamps.delete(socket.id);
      const room = manager.getRoomForSocket(socket.id);
      if (!room) return;

      const removed = room.removePlayer(socket.id);
      manager.removeSocket(socket.id);
      if (!removed) return;

      if (room.players.length === 0) {
        if (room.game) room.game.destroy();
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
