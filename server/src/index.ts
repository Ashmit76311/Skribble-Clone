import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { PORT, CLIENT_URL } from "./config.js";
import { RoomManager } from "./RoomManager.js";
import { registerHandlers } from "./handlers.js";

const app = express();
app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());

const manager = new RoomManager();

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/rooms/public", (_req, res) => {
  const rooms = manager.listPublicRooms().map((r) => ({
    code: r.code,
    playerCount: r.players.length,
    maxPlayers: r.settings.maxPlayers,
    hostName: r.host?.name ?? "",
  }));
  res.json(rooms);
});

app.get("/api/rooms/:code", (req, res) => {
  const room = manager.getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json({
    code: room.code,
    playerCount: room.players.length,
    maxPlayers: room.settings.maxPlayers,
    phase: room.phase,
  });
});

const server = createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_URL, methods: ["GET", "POST"] },
});

registerHandlers(io, manager);

server.listen(PORT, () => console.log(`server running on port ${PORT}`));
