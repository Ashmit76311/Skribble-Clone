import { useEffect, useState, FormEvent } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { socket } from "../socket";
import { SocketEvent } from "@skribbl/shared";
import type {
  RoomData,
  PlayerJoinedPayload,
  PlayerLeftPayload,
  HostChangedPayload,
  ErrorPayload,
} from "@skribbl/shared";
import { useToast, ToastContainer } from "../components/Toast";

export default function Lobby() {
  const { code } = useParams<{ code: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { toasts, addToast } = useToast();

  const [room, setRoom] = useState<RoomData | null>(
    (location.state as any)?.room ?? null
  );
  const [name, setName] = useState(() => localStorage.getItem("name") || "");
  const [needsName, setNeedsName] = useState(false);

  useEffect(() => {
    if (room) return;

    // opened via invite link — need to join
    const saved = localStorage.getItem("name");
    if (saved) {
      joinRoom(saved);
    } else {
      setNeedsName(true);
    }
  }, []);

  useEffect(() => {
    socket.on(SocketEvent.PlayerJoined, onPlayerJoined);
    socket.on(SocketEvent.PlayerLeft, onPlayerLeft);
    socket.on(SocketEvent.HostChanged, onHostChanged);
    socket.on(SocketEvent.Error, onError);

    return () => {
      socket.off(SocketEvent.PlayerJoined, onPlayerJoined);
      socket.off(SocketEvent.PlayerLeft, onPlayerLeft);
      socket.off(SocketEvent.HostChanged, onHostChanged);
      socket.off(SocketEvent.Error, onError);
    };
  }, [room]);

  function onPlayerJoined(data: PlayerJoinedPayload) {
    setRoom((prev) => (prev ? { ...prev, players: data.players } : prev));
  }

  function onPlayerLeft(data: PlayerLeftPayload) {
    setRoom((prev) => (prev ? { ...prev, players: data.players } : prev));
    addToast(`${data.name} left`);
  }

  function onHostChanged(data: HostChangedPayload) {
    setRoom((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        hostId: data.hostId,
        players: prev.players.map((p) => ({
          ...p,
          isHost: p.id === data.hostId,
        })),
      };
    });
  }

  function onError(data: ErrorPayload) {
    addToast(data.message);
  }

  function joinRoom(playerName: string) {
    socket.emit(
      SocketEvent.JoinRoom,
      { name: playerName, code: code! },
      (res: any) => {
        if (res.error) {
          addToast(res.error);
          setTimeout(() => navigate("/"), 2000);
          return;
        }
        setRoom(res.room);
        setNeedsName(false);
      }
    );
  }

  function handleNameSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return addToast("Enter a name");
    localStorage.setItem("name", trimmed);
    joinRoom(trimmed);
  }

  function copyLink() {
    navigator.clipboard.writeText(window.location.href);
    addToast("Link copied");
  }

  function startGame() {
    socket.emit(SocketEvent.StartGame);
  }

  function leaveRoom() {
    socket.disconnect();
    socket.connect();
    navigate("/");
  }

  const isHost = room?.hostId === socket.id;
  const canStart = isHost && (room?.players.length ?? 0) >= 2;

  if (needsName) {
    return (
      <div className="home">
        <h1 className="title">skribbl</h1>
        <div className="card">
          <h2>Enter your name</h2>
          <form onSubmit={handleNameSubmit} className="join-form">
            <input
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              className="input"
              autoFocus
            />
            <button type="submit" className="btn btn-primary">
              Join
            </button>
          </form>
        </div>
        <ToastContainer toasts={toasts} />
      </div>
    );
  }

  if (!room) {
    return (
      <div className="home">
        <p>Joining room...</p>
        <ToastContainer toasts={toasts} />
      </div>
    );
  }

  return (
    <div className="lobby">
      <h1 className="title">skribbl</h1>

      <div className="lobby-header">
        <span className="room-code">Room: {room.code}</span>
        <button className="btn btn-sm" onClick={copyLink}>
          Copy Link
        </button>
        <button className="btn btn-sm btn-danger" onClick={leaveRoom}>
          Leave
        </button>
      </div>

      <div className="card">
        <h2>Players ({room.players.length}/{room.settings.maxPlayers})</h2>
        <ul className="player-list">
          {room.players.map((p) => (
            <li key={p.id} className="player-item">
              <span>{p.name}</span>
              {p.isHost && <span className="host-badge">host</span>}
              {p.id === socket.id && <span className="you-badge">you</span>}
            </li>
          ))}
        </ul>
      </div>

      <div className="card settings-summary">
        <h2>Settings</h2>
        <div className="settings-info">
          <span>Rounds: {room.settings.rounds}</span>
          <span>Draw Time: {room.settings.drawTime}s</span>
          <span>Word Count: {room.settings.wordCount}</span>
          <span>Hints: {room.settings.hints}</span>
          <span>Mode: {room.settings.wordMode}</span>
        </div>
      </div>

      {isHost && (
        <button
          className="btn btn-primary btn-start"
          disabled={!canStart}
          onClick={startGame}
        >
          {canStart ? "Start Game" : "Need at least 2 players"}
        </button>
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}
