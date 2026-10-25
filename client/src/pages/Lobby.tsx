import { useEffect, useState, FormEvent } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { socket, deviceId } from "../socket";
import { GamePhase, SocketEvent } from "@skribbl/shared";
import type {
  RoomData,
  PlayerJoinedPayload,
  PlayerLeftPayload,
  HostChangedPayload,
  GameStatePayload,
  RoundStartPayload,
  ErrorPayload,
  Stroke,
  ChatMessagePayload,
  RejoinRoomResponse,
} from "@skribbl/shared";
import { useToast, ToastContainer } from "../components/Toast";
import GameScreen from "../components/GameScreen";
import Avatar from "../components/Avatar";

function getStoredSession(code: string): { code: string; token: string; playerId: string } | null {
  try {
    const raw = sessionStorage.getItem(`session_${code.toUpperCase()}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setStoredSession(code: string, token: string, playerId: string) {
  sessionStorage.setItem(
    `session_${code.toUpperCase()}`,
    JSON.stringify({ code, token, playerId })
  );
}

function clearStoredSession(code: string) {
  sessionStorage.removeItem(`session_${code.toUpperCase()}`);
}

export default function Lobby() {
  const { code } = useParams<{ code: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { toasts, addToast } = useToast();

  const [room, setRoom] = useState<RoomData | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string>(() => {
    const session = code ? getStoredSession(code) : null;
    return (location.state as any)?.playerId ?? session?.playerId ?? "";
  });
  const [name, setName] = useState(() => localStorage.getItem("name") || "");
  const [needsName, setNeedsName] = useState(false);

  const [initialStrokes, setInitialStrokes] = useState<Stroke[]>([]);
  const [initialMessages, setInitialMessages] = useState<ChatMessagePayload[]>([]);
  const [initialWordOptions, setInitialWordOptions] = useState<string[]>([]);

  const [customWordsInput, setCustomWordsInput] = useState<string>("");
  const [useCustomOnlyInput, setUseCustomOnlyInput] = useState<boolean>(false);
  const [hasEditedCustomWords, setHasEditedCustomWords] = useState(false);

  function performRejoin(token: string) {
    socket.emit(
      SocketEvent.RejoinRoom,
      { code: code!, token, deviceId },
      (res: RejoinRoomResponse) => {
        if (res.error) {
          clearStoredSession(code!);
          const saved = localStorage.getItem("name");
          if (saved) {
            joinRoom(saved);
          } else {
            setNeedsName(true);
          }
          return;
        }

        if (res.playerId) {
          setMyPlayerId(res.playerId);
          setStoredSession(code!, res.token || token, res.playerId);
        }
        if (res.room) setRoom(res.room);
        if (res.strokes) setInitialStrokes(res.strokes);
        if (res.chatHistory) setInitialMessages(res.chatHistory);
        if (res.wordOptions) setInitialWordOptions(res.wordOptions);
        setNeedsName(false);
      }
    );
  }

  function joinRoom(playerName: string) {
    socket.emit(
      SocketEvent.JoinRoom,
      { name: playerName, code: code!, deviceId },
      (res: any) => {
        if (res.error) {
          addToast(res.error);
          setTimeout(() => navigate("/"), 2000);
          return;
        }
        if (res.token) {
          setStoredSession(code!, res.token, res.playerId);
        }
        setMyPlayerId(res.playerId);
        setRoom(res.room);
        setNeedsName(false);
      }
    );
  }

  useEffect(() => {
    const session = code ? getStoredSession(code) : null;

    if (session?.token) {
      performRejoin(session.token);
    } else if ((location.state as any)?.room) {
      setRoom((location.state as any).room);
      if ((location.state as any)?.playerId) {
        setMyPlayerId((location.state as any).playerId);
      }
    } else {
      const saved = localStorage.getItem("name");
      if (saved) {
        joinRoom(saved);
      } else {
        setNeedsName(true);
      }
    }

    function handleConnect() {
      const activeSession = code ? getStoredSession(code) : null;
      if (activeSession?.token) {
        performRejoin(activeSession.token);
      }
    }

    socket.on("connect", handleConnect);
    return () => {
      socket.off("connect", handleConnect);
    };
  }, [code]);

  useEffect(() => {
    socket.on(SocketEvent.PlayerJoined, onPlayerJoined);
    socket.on(SocketEvent.PlayerLeft, onPlayerLeft);
    socket.on(SocketEvent.HostChanged, onHostChanged);
    socket.on(SocketEvent.GameState, onGameState);
    socket.on(SocketEvent.RoundStart, onRoundStart);
    socket.on(SocketEvent.Error, onError);
    socket.on(SocketEvent.Kicked, onKicked);

    return () => {
      socket.off(SocketEvent.PlayerJoined, onPlayerJoined);
      socket.off(SocketEvent.PlayerLeft, onPlayerLeft);
      socket.off(SocketEvent.HostChanged, onHostChanged);
      socket.off(SocketEvent.GameState, onGameState);
      socket.off(SocketEvent.RoundStart, onRoundStart);
      socket.off(SocketEvent.Error, onError);
      socket.off(SocketEvent.Kicked, onKicked);
    };
  }, [room]);

  function onKicked(data: { message?: string; banned?: boolean }) {
    if (code) clearStoredSession(code);
    navigate("/", {
      state: { toast: data.message || "You were kicked from the room" },
    });
  }

  function onGameState(data: GameStatePayload) {
    setRoom(data.room);
    if (data.room.wordOptions) {
      setInitialWordOptions(data.room.wordOptions);
    }
  }

  function onRoundStart(data: RoundStartPayload) {
    setRoom((prev) =>
      prev
        ? {
            ...prev,
            phase: GamePhase.WORD_SELECT,
            currentRound: data.round,
            currentDrawer: data.drawerId,
            endsAt: data.endsAt,
            wordOptions: data.wordOptions ?? prev.wordOptions,
            players: prev.players.map((p) => ({
              ...p,
              isDrawing: p.id === data.drawerId,
              hasGuessed: false,
            })),
          }
        : prev
    );
    if (data.wordOptions) {
      setInitialWordOptions(data.wordOptions);
    }
  }

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
    if (code) clearStoredSession(code);
    socket.disconnect();
    socket.connect();
    navigate("/");
  }

  const isHost = room?.hostId === myPlayerId;
  const allReady =
    room?.players.every((p) => p.isHost || !p.isConnected || p.isReady) ?? false;
  const enoughPlayers = (room?.players.length ?? 0) >= 2;
  const canStart = isHost && enoughPlayers && allReady;

  function getStartHint(): string | null {
    if (!isHost) return null;
    if (!enoughPlayers) return "Need at least 2 players";
    if (!allReady) return "Waiting for players to ready up";
    return null;
  }

  const me = room?.players.find((p) => p.id === myPlayerId);
  const myReady = me?.isReady ?? false;

  const [confirmKick, setConfirmKick] = useState<{
    playerId: string;
    ban: boolean;
  } | null>(null);

  function executeKick(playerId: string, ban: boolean) {
    socket.emit(SocketEvent.KickPlayer, { playerId, ban });
    setConfirmKick(null);
  }

  function toggleReady() {
    socket.emit(SocketEvent.PlayerReady, { ready: !myReady });
  }

  useEffect(() => {
    if (room?.settings && !hasEditedCustomWords) {
      if (room.settings.customWords && room.settings.customWords.length > 0) {
        setCustomWordsInput(room.settings.customWords.join(", "));
      }
      setUseCustomOnlyInput(!!room.settings.useCustomOnly);
    }
  }, [room?.settings.customWords, room?.settings.useCustomOnly, hasEditedCustomWords]);

  function saveCustomWords() {
    socket.emit(SocketEvent.UpdateSettings, {
      settings: {
        customWords: customWordsInput,
        useCustomOnly: useCustomOnlyInput,
      },
    });
    setHasEditedCustomWords(false);
    addToast("Settings updated");
  }

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

  if (room.phase !== GamePhase.LOBBY) {
    return (
      <>
        <GameScreen
          room={room}
          setRoom={setRoom}
          myPlayerId={myPlayerId}
          initialStrokes={initialStrokes}
          initialMessages={initialMessages}
          initialWordOptions={initialWordOptions}
          onLeave={leaveRoom}
        />
        <ToastContainer toasts={toasts} />
      </>
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
              <div className="player-info">
                <Avatar name={p.name} seed={p.id} size="sm" />
                <span>{p.name}</span>
                {!p.isConnected && <span className="offline-badge">offline</span>}
                {p.isHost && <span className="host-badge">host</span>}
                {p.id === myPlayerId && <span className="you-badge">you</span>}
                {p.isReady && <span className="ready-badge">✓</span>}
                {!p.isHost && p.isConnected && !p.isReady && (
                  <span className="not-ready-badge">✗</span>
                )}
              </div>
              {isHost && p.id !== myPlayerId && (
                <div className="player-actions">
                  {confirmKick?.playerId === p.id ? (
                    <span className="confirm-group">
                      <button
                        className="btn btn-xs btn-danger"
                        onClick={() => executeKick(p.id, confirmKick.ban)}
                      >
                        Confirm {confirmKick.ban ? "Ban" : "Kick"}?
                      </button>
                      <button
                        className="btn btn-xs"
                        onClick={() => setConfirmKick(null)}
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <>
                      <button
                        className="btn btn-xs btn-kick"
                        onClick={() => setConfirmKick({ playerId: p.id, ban: false })}
                      >
                        Kick
                      </button>
                      <button
                        className="btn btn-xs btn-ban"
                        onClick={() => setConfirmKick({ playerId: p.id, ban: true })}
                      >
                        Ban
                      </button>
                    </>
                  )}
                </div>
              )}
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
          {room.settings.useCustomOnly && <span>Custom words only</span>}
          {room.settings.customWords && room.settings.customWords.length > 0 && (
            <span>Custom words: {room.settings.customWords.length}</span>
          )}
        </div>
        {isHost && (
          <div className="custom-words-lobby" style={{ marginTop: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem" }}>
              Custom Words (comma or new line separated)
              <textarea
                className="input custom-words-textarea"
                placeholder="cat, dog, space ship..."
                value={customWordsInput}
                onChange={(e) => {
                  setCustomWordsInput(e.target.value);
                  setHasEditedCustomWords(true);
                }}
                rows={3}
                style={{ width: "100%", marginTop: "0.25rem" }}
              />
            </label>
            <label className="toggle-row" style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
              <input
                type="checkbox"
                checked={useCustomOnlyInput}
                onChange={(e) => {
                  setUseCustomOnlyInput(e.target.checked);
                  setHasEditedCustomWords(true);
                }}
              />
              Use custom words exclusively
            </label>
            <button className="btn btn-sm btn-secondary" onClick={saveCustomWords}>
              Save Words
            </button>
          </div>
        )}
      </div>

      {!isHost && (
        <button
          className={`btn ${myReady ? "btn-danger" : "btn-primary"} btn-ready`}
          onClick={toggleReady}
        >
          {myReady ? "Not Ready" : "Ready"}
        </button>
      )}

      {isHost && (
        <div className="start-section">
          <button
            className="btn btn-primary btn-start"
            disabled={!canStart}
            onClick={startGame}
          >
            Start Game
          </button>
          {getStartHint() && (
            <span className="start-hint">{getStartHint()}</span>
          )}
        </div>
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}

