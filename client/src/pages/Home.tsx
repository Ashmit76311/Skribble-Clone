import { useState, useEffect, FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { socket } from "../socket";
import { SocketEvent, WordMode } from "@skribbl/shared";
import type { RoomSettings } from "@skribbl/shared";
import { useToast, ToastContainer } from "../components/Toast";

const API_BASE =
  import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.DEV ? "http://localhost:3001" : "");

const defaults: RoomSettings = {
  maxPlayers: 8,
  rounds: 3,
  drawTime: 80,
  wordCount: 3,
  hints: 2,
  wordMode: WordMode.Normal,
  isPublic: true,
  customWords: [],
  useCustomOnly: false,
};

interface PublicRoom {
  code: string;
  playerCount: number;
  maxPlayers: number;
  hostName: string;
}

export default function Home() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toasts, addToast } = useToast();
  const [name, setName] = useState(() => localStorage.getItem("name") || "");
  const [settings, setSettings] = useState<RoomSettings>({ ...defaults });
  const [customWordsText, setCustomWordsText] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);

  useEffect(() => {
    fetchPublicRooms();
  }, []);

  useEffect(() => {
    if (location.state?.toast) {
      addToast(location.state.toast);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state]);

  async function fetchPublicRooms() {
    try {
      const res = await fetch(`${API_BASE}/api/rooms/public`);
      setPublicRooms(await res.json());
    } catch {}
  }

  function saveName() {
    const trimmed = name.trim();
    if (!trimmed) {
      addToast("Enter a name");
      return null;
    }
    localStorage.setItem("name", trimmed);
    return trimmed;
  }

  function createRoom(e: FormEvent) {
    e.preventDefault();
    const n = saveName();
    if (!n) return;
    const customWords = customWordsText
      ? customWordsText
          .split(/[,\n\r]+/)
          .map((w) => w.trim().toLowerCase())
          .filter((w) => w.length >= 2 && w.length <= 30 && /^[a-z -]+$/.test(w) && /[a-z]/.test(w))
      : [];
    const finalSettings: RoomSettings = {
      ...settings,
      customWords: Array.from(new Set(customWords)).slice(0, 100),
    };
    socket.emit(SocketEvent.CreateRoom, { name: n, settings: finalSettings }, (res: any) => {
      if (res.error) return addToast(res.error);
      if (res.token) {
        sessionStorage.setItem(
          `session_${res.room.code.toUpperCase()}`,
          JSON.stringify({ code: res.room.code, token: res.token, playerId: res.playerId })
        );
      }
      navigate(`/room/${res.room.code}`, {
        state: { room: res.room, playerId: res.playerId },
      });
    });
  }

  function joinRoom(code: string) {
    const n = saveName();
    if (!n) return;
    socket.emit(SocketEvent.JoinRoom, { name: n, code }, (res: any) => {
      if (res.error) return addToast(res.error);
      if (res.token) {
        sessionStorage.setItem(
          `session_${res.room.code.toUpperCase()}`,
          JSON.stringify({ code: res.room.code, token: res.token, playerId: res.playerId })
        );
      }
      navigate(`/room/${res.room.code}`, {
        state: { room: res.room, playerId: res.playerId },
      });
    });
  }

  function joinByCode(e: FormEvent) {
    e.preventDefault();
    if (!joinCode.trim()) return addToast("Enter a room code");
    joinRoom(joinCode.trim());
  }

  function updateSetting<K extends keyof RoomSettings>(key: K, val: RoomSettings[K]) {
    setSettings((s) => ({ ...s, [key]: val }));
  }

  return (
    <div className="home">
      <h1 className="title">skribbl</h1>

      <div className="name-section">
        <input
          type="text"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          className="input"
        />
      </div>

      <div className="card">
        <h2>Create Room</h2>
        <form onSubmit={createRoom} className="create-form">
          <div className="settings-grid">
            <label>
              Players
              <input
                type="number"
                min={2}
                max={20}
                value={settings.maxPlayers}
                onChange={(e) => updateSetting("maxPlayers", +e.target.value)}
              />
            </label>
            <label>
              Rounds
              <input
                type="number"
                min={2}
                max={10}
                value={settings.rounds}
                onChange={(e) => updateSetting("rounds", +e.target.value)}
              />
            </label>
            <label>
              Draw Time
              <input
                type="number"
                min={15}
                max={240}
                value={settings.drawTime}
                onChange={(e) => updateSetting("drawTime", +e.target.value)}
              />
            </label>
            <label>
              Words
              <input
                type="number"
                min={1}
                max={5}
                value={settings.wordCount}
                onChange={(e) => updateSetting("wordCount", +e.target.value)}
              />
            </label>
            <label>
              Hints
              <input
                type="number"
                min={0}
                max={5}
                value={settings.hints}
                onChange={(e) => updateSetting("hints", +e.target.value)}
              />
            </label>
            <label>
              Word Mode
              <select
                value={settings.wordMode}
                onChange={(e) => updateSetting("wordMode", e.target.value as WordMode)}
              >
                <option value={WordMode.Normal}>Normal</option>
                <option value={WordMode.Hidden}>Hidden</option>
                <option value={WordMode.Combination}>Combination</option>
              </select>
            </label>
          </div>
          <div className="custom-words-field">
            <label>
              Custom Words
              <textarea
                className="input custom-words-textarea"
                placeholder="Custom words separated by commas or new lines..."
                value={customWordsText}
                onChange={(e) => setCustomWordsText(e.target.value)}
                rows={3}
              />
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={settings.useCustomOnly}
                onChange={(e) => updateSetting("useCustomOnly", e.target.checked)}
              />
              Use custom words exclusively
            </label>
          </div>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.isPublic}
              onChange={(e) => updateSetting("isPublic", e.target.checked)}
            />
            Public room
          </label>
          <button type="submit" className="btn btn-primary">
            Create
          </button>
        </form>
      </div>

      <div className="card">
        <h2>Join Room</h2>
        <form onSubmit={joinByCode} className="join-form">
          <input
            type="text"
            placeholder="Room code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            maxLength={6}
            className="input"
          />
          <button type="submit" className="btn">
            Join
          </button>
        </form>
      </div>

      {publicRooms.length > 0 && (
        <div className="card">
          <h2>Public Rooms</h2>
          <div className="public-rooms">
            {publicRooms.map((r) => (
              <div key={r.code} className="room-row">
                <span>
                  {r.hostName}'s room — {r.playerCount}/{r.maxPlayers}
                </span>
                <button className="btn btn-sm" onClick={() => joinRoom(r.code)}>
                  Join
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}
