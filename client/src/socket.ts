import { io } from "socket.io-client";

const URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";

export const socket = io(URL);
(window as any).socket = socket;
(window as any).__incoming_events__ = [];
socket.onAny((event, ...args) => {
  (window as any).__incoming_events__.push({ event, args });
});
