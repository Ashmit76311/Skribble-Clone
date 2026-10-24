import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { PORT, CLIENT_URL } from "./config.js";

const app = express();
app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const server = createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_URL, methods: ["GET", "POST"] },
});

io.on("connection", (socket) => {
  console.log(`connected: ${socket.id}`);
  socket.on("disconnect", () => console.log(`disconnected: ${socket.id}`));
});

server.listen(PORT, () => console.log(`server running on port ${PORT}`));
