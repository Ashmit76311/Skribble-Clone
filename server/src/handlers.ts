import { Server, Socket } from "socket.io";
import { GamePhase, SocketEvent } from "@skribbl/shared";
import type {
  CreateRoomPayload,
  JoinRoomPayload,
  RejoinRoomPayload,
  SelectWordPayload,
  DrawStartPayload,
  DrawMovePayload,
  ChatMessagePayload,
  KickPlayerPayload,
  UpdateSettingsPayload,
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

function getClientIp(socket: Socket): string {
  const forwarded = socket.handshake.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return socket.handshake.address || "";
}

export function registerHandlers(io: Server, manager: RoomManager) {
  io.on("connection", (socket) => {
    socket.on(SocketEvent.CreateRoom, (data: CreateRoomPayload, cb) => {
      const name = data.name?.trim();
      if (!name) return cb({ error: "Name is required" });

      const room = manager.createRoom(data.settings || {});
      const ip = getClientIp(socket);
      const player = new Player(socket.id, name, ip);
      room.addPlayer(player);
      socket.join(room.code);
      manager.trackSocket(socket.id, room.code);
      cb({
        room: room.toJSON(player.id),
        token: player.token,
        playerId: player.id,
      });
    });

    socket.on(SocketEvent.JoinRoom, (data: JoinRoomPayload, cb) => {
      const name = data.name?.trim();
      if (!name) return cb({ error: "Name is required" });

      const room = manager.getRoom(data.code);
      if (!room) return cb({ error: "Room not found" });

      const ip = getClientIp(socket);
      if (room.isBanned(undefined, ip)) {
        return cb({ error: "You are banned from this room" });
      }

      const player = new Player(socket.id, name, ip);
      const err = room.addPlayer(player);
      if (err) return cb({ error: err });

      socket.join(room.code);
      manager.trackSocket(socket.id, room.code);

      socket.to(room.code).emit(SocketEvent.PlayerJoined, {
        player: player.toJSON(),
        players: room.players.map((p) => p.toJSON()),
      });

      cb({
        room: room.toJSON(player.id),
        token: player.token,
        playerId: player.id,
      });

      if (room.game) {
        socket.emit(SocketEvent.GameState, {
          room: room.game.buildRoomData(player.id),
          strokes: room.game.currentStrokes,
          hint: null,
        });
      }
    });

    socket.on(SocketEvent.RejoinRoom, (data: RejoinRoomPayload, cb) => {
      if (!data?.code || !data?.token) {
        return cb({ error: "Room code and token are required" });
      }

      const room = manager.getRoom(data.code);
      if (!room) return cb({ error: "Room not found" });

      const ip = getClientIp(socket);
      if (room.isBanned(undefined, ip)) {
        return cb({ error: "You are banned from this room" });
      }

      const player = room.getPlayerByToken(data.token);
      if (!player) return cb({ error: "Invalid token or expired session" });

      if (room.isBanned(player.id, ip, player.deviceId)) {
        return cb({ error: "You are banned from this room" });
      }

      // Cancel grace timer if active
      if (player.disconnectTimer) {
        clearTimeout(player.disconnectTimer);
        player.disconnectTimer = null;
      }

      const now = Date.now();
      const offlineDuration = player.disconnectedAt ? now - player.disconnectedAt : 0;
      const timeSinceLastMsg = now - player.lastReconnectedMsgAt;

      // Only send if player was offline for > 5s and don't repeat within 30s
      if (offlineDuration > 5_000 && timeSinceLastMsg > 30_000) {
        player.lastReconnectedMsgAt = now;
        const reconnectedMsg: ChatMessagePayload = {
          name: "System",
          text: `${player.name} reconnected`,
          type: "system",
        };
        room.addChatMessage(reconnectedMsg, "all");
        io.to(room.code).emit(SocketEvent.ChatMessage, reconnectedMsg);
      }
      player.disconnectedAt = null;

      // Attach new socket connection
      player.socketId = socket.id;
      player.isConnected = true;
      socket.join(room.code);
      manager.trackSocket(socket.id, room.code);

      const roomData = room.game
        ? room.game.buildRoomData(player.id)
        : room.toJSON(player.id);
      const strokes = room.game ? room.game.currentStrokes : [];
      const chatHistory = room.getChatHistoryForPlayer(player);

      if (room.game) {
        room.game.broadcastState();
      } else {
        room.broadcastLobbyState(io);
      }

      const wordOptions =
        room.game &&
        room.game.currentPhase === GamePhase.WORD_SELECT &&
        room.game.drawer?.id === player.id
          ? room.game.wordOptionsList
          : undefined;

      cb({
        room: roomData,
        strokes,
        hasGuessed: player.hasGuessed,
        chatHistory,
        playerId: player.id,
        token: player.token,
        wordOptions,
      });
    });

    socket.on(SocketEvent.StartGame, () => {
      const room = manager.getRoomForSocket(socket.id);
      if (!room) return;
      const player = room.getPlayerBySocketId(socket.id);
      if (!player?.isHost) {
        return socket.emit(SocketEvent.Error, { message: "Only host can start" });
      }
      const err = room.startGame(io);
      if (err) {
        return socket.emit(SocketEvent.Error, { message: err });
      }
    });

    socket.on(SocketEvent.PlayerReady, (data: { ready: boolean }) => {
      const room = manager.getRoomForSocket(socket.id);
      if (!room || room.phase !== GamePhase.LOBBY) return;
      const player = room.getPlayerBySocketId(socket.id);
      if (!player || player.isHost) return;
      player.isReady = !!data?.ready;
      room.broadcastLobbyState(io);
    });

    socket.on(SocketEvent.UpdateSettings, (data: UpdateSettingsPayload) => {
      const room = manager.getRoomForSocket(socket.id);
      if (!room || room.phase !== GamePhase.LOBBY) return;
      const player = room.getPlayerBySocketId(socket.id);
      if (!player?.isHost) {
        return socket.emit(SocketEvent.Error, {
          message: "Only the host can update room settings",
        });
      }
      if (!data?.settings) return;
      room.updateSettings(data.settings);
      room.broadcastLobbyState(io);
    });

    socket.on(SocketEvent.KickPlayer, (data: KickPlayerPayload) => {
      const room = manager.getRoomForSocket(socket.id);
      if (!room) return;
      const caller = room.getPlayerBySocketId(socket.id);
      if (!caller?.isHost) {
        return socket.emit(SocketEvent.Error, {
          message: "Only the host can kick players",
        });
      }
      if (!data?.playerId) return;
      if (data.playerId === caller.id) {
        return socket.emit(SocketEvent.Error, {
          message: "You cannot kick yourself",
        });
      }

      const target = room.players.find((p) => p.id === data.playerId);
      if (!target) {
        return socket.emit(SocketEvent.Error, {
          message: "Player not found",
        });
      }

      const isBan = !!data.ban;
      if (isBan) {
        room.banPlayer(target);
      }

      // Invalidate target's token so they cannot rejoin
      target.token = "";

      // Notify target socket if connected and leave room
      const targetSocket = io.sockets.sockets.get(target.socketId);
      if (targetSocket) {
        targetSocket.emit(SocketEvent.Kicked, {
          message: isBan
            ? "You were banned from the room"
            : "You were kicked from the room",
          banned: isBan,
        });
        targetSocket.leave(room.code);
        manager.removeSocket(targetSocket.id);
      }

      // Remove player using existing room removal logic
      const removed = room.removePlayer(target.id);
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

      if (removed.isHost && room.host) {
        room.broadcast(io, SocketEvent.HostChanged, {
          hostId: room.host.id,
        });
      }

      if (room.game) {
        room.game.broadcastState();
      } else {
        room.broadcastLobbyState(io);
      }
    });

    socket.on(SocketEvent.SelectWord, (data: SelectWordPayload) => {
      const room = manager.getRoomForSocket(socket.id);
      if (!room || !room.game) return;
      const player = room.getPlayerBySocketId(socket.id);
      if (!player || !data?.word) return;
      room.game.chooseWord(player.id, data.word);
    });

    socket.on(SocketEvent.DrawStart, (data: DrawStartPayload) => {
      const room = manager.getRoomForSocket(socket.id);
      if (!room || !room.game) return;
      const player = room.getPlayerBySocketId(socket.id);
      if (!player) return;
      room.game.handleDrawStart(player.id, data);
    });

    socket.on(SocketEvent.DrawMove, (data: DrawMovePayload) => {
      const room = manager.getRoomForSocket(socket.id);
      if (!room || !room.game) return;
      const player = room.getPlayerBySocketId(socket.id);
      if (!player) return;
      room.game.handleDrawMove(player.id, data);
    });

    socket.on(SocketEvent.DrawEnd, () => {
      const room = manager.getRoomForSocket(socket.id);
      if (!room || !room.game) return;
      const player = room.getPlayerBySocketId(socket.id);
      if (!player) return;
      room.game.handleDrawEnd(player.id);
    });

    socket.on(SocketEvent.CanvasClear, () => {
      const room = manager.getRoomForSocket(socket.id);
      if (!room || !room.game) return;
      const player = room.getPlayerBySocketId(socket.id);
      if (!player) return;
      room.game.handleClear(player.id);
    });

    socket.on(SocketEvent.DrawUndo, () => {
      const room = manager.getRoomForSocket(socket.id);
      if (!room || !room.game) return;
      const player = room.getPlayerBySocketId(socket.id);
      if (!player) return;
      room.game.handleUndo(player.id);
    });

    socket.on(SocketEvent.EndTurn, () => {
      const room = manager.getRoomForSocket(socket.id);
      if (!room || !room.game) return;
      const player = room.getPlayerBySocketId(socket.id);
      if (!player || room.game.drawer?.id !== player.id) return;
      room.game.endTurn();
    });

    socket.on(SocketEvent.Chat, (data: { text: string }) => {
      if (!checkRateLimit(socket.id)) return;
      const room = manager.getRoomForSocket(socket.id);
      if (!room || !data?.text) return;
      const player = room.getPlayerBySocketId(socket.id);
      if (!player) return;

      if (room.game) {
        room.game.handleChat(player.id, data.text);
      } else {
        const text = data.text.trim().slice(0, 200);
        if (!text) return;
        const msg: ChatMessagePayload = {
          playerId: player.id,
          name: player.name,
          text,
          type: "chat",
        };
        room.addChatMessage(msg, "all");
        io.to(room.code).emit(SocketEvent.ChatMessage, msg);
      }
    });

    socket.on(SocketEvent.Guess, (data: { text: string }) => {
      if (!checkRateLimit(socket.id)) return;
      const room = manager.getRoomForSocket(socket.id);
      if (!room || !room.game || !data?.text) return;
      const player = room.getPlayerBySocketId(socket.id);
      if (!player) return;
      room.game.handleGuess(player.id, data.text);
    });

    socket.on(SocketEvent.PlayAgain, () => {
      const room = manager.getRoomForSocket(socket.id);
      if (!room) return;
      const player = room.getPlayerBySocketId(socket.id);
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

    socket.on(SocketEvent.GetGameState, () => {
      const room = manager.getRoomForSocket(socket.id);
      if (!room) return;
      const player = room.getPlayerBySocketId(socket.id);
      if (!player) return;

      if (room.game) {
        socket.emit(SocketEvent.GameState, {
          room: room.game.buildRoomData(player.id),
          strokes: room.game.currentStrokes,
          hint: room.game.hintManager?.getMaskedHint() ?? null,
        });
      } else {
        socket.emit(SocketEvent.GameState, {
          room: room.toJSON(player.id),
          strokes: [],
          hint: null,
        });
      }
    });

    socket.on("disconnect", () => {
      chatTimestamps.delete(socket.id);
      const room = manager.getRoomForSocket(socket.id);
      if (!room) return;

      const player = room.getPlayerBySocketId(socket.id);
      manager.removeSocket(socket.id);
      if (!player) return;

      // Mark offline, do not remove immediately
      player.isConnected = false;
      player.disconnectedAt = Date.now();

      // Disconnected guessers don't count toward "everyone has guessed"
      if (room.game && room.game.currentPhase === GamePhase.DRAWING) {
        room.game.checkAllGuessed();
      }

      // Broadcast offline state to everyone
      if (room.game) {
        room.game.broadcastState();
      } else {
        room.broadcastLobbyState(io);
      }

      // Start 30s grace timer
      if (player.disconnectTimer) {
        clearTimeout(player.disconnectTimer);
      }

      player.disconnectTimer = setTimeout(() => {
        player.disconnectTimer = null;
        const removed = room.removePlayer(player.id);
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

        if (removed.isHost && room.host) {
          room.broadcast(io, SocketEvent.HostChanged, {
            hostId: room.host.id,
          });
        }

        if (room.game) {
          room.game.broadcastState();
        }
      }, 30_000);
    });
  });
}
