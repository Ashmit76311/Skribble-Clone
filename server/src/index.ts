import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { PORT, CLIENT_URL } from "./config.js";
import { RoomManager } from "./RoomManager.js";
import { registerHandlers } from "./handlers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProd =
  process.env.NODE_ENV === "production" ||
  process.env.NODE_ENV === "prod" ||
  (!process.env.NODE_ENV &&
    fs.existsSync(path.resolve(__dirname, "../../client/dist")));

const app = express();
app.set("trust proxy", 1);
if (!isProd) {
  app.use(cors({ origin: CLIENT_URL }));
}
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
  cors: isProd ? undefined : { origin: CLIENT_URL, methods: ["GET", "POST"] },
});

registerHandlers(io, manager);

if (isProd) {
  const possiblePaths = [
    path.resolve(__dirname, "../../client/dist"),
    path.resolve(__dirname, "../client/dist"),
    path.resolve(process.cwd(), "client/dist"),
  ];
  const clientDist =
    possiblePaths.find((p) => fs.existsSync(p)) || possiblePaths[0];

  app.use(express.static(clientDist));
  app.get("*", (req, res) => {
    if (path.extname(req.path)) {
      return res.status(404).send("Not Found");
    }
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

server.listen(PORT, "0.0.0.0", () =>
  console.log(`server running on port ${PORT}`)
);
