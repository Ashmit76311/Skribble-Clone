import { io } from "socket.io-client";

const URL =
  import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.DEV ? "http://localhost:3001" : window.location.origin);

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem("skribbl_device_id");
    if (!id) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : Math.random().toString(36).substring(2) + Date.now().toString(36);
      localStorage.setItem("skribbl_device_id", id);
    }
    return id;
  } catch {
    return "dev-" + Math.random().toString(36).substring(2);
  }
}

export const deviceId = getDeviceId();

export const socket = io(URL, {
  auth: { deviceId },
});

