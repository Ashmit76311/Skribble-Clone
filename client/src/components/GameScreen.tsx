import { useState, useEffect, useRef, FormEvent } from "react";
import { socket } from "../socket";
import { GamePhase, SocketEvent, WordMode } from "@skribbl/shared";
import type {
  RoomData,
  RoundStartPayload,
  WordChosenPayload,
  RoundEndPayload,
  GameOverPayload,
  GameStatePayload,
  Stroke,
  ChatMessagePayload,
  GuessResultPayload,
  HintUpdatePayload,
} from "@skribbl/shared";
import Canvas from "./Canvas";
import Avatar from "./Avatar";
import { isMuted, toggleMuted, playCorrectSound } from "../audio";

interface Props {
  room: RoomData;
  setRoom: React.Dispatch<React.SetStateAction<RoomData | null>>;
  myPlayerId: string;
  initialStrokes?: Stroke[];
  initialMessages?: ChatMessagePayload[];
  initialWordOptions?: string[];
  onLeave: () => void;
}

const CONFETTI_COLORS = [
  "#6c63ff",
  "#2dd4a8",
  "#f5a623",
  "#ef4565",
  "#a78bfa",
  "#38bdf8",
];

const CONFETTI_PIECES = Array.from({ length: 30 }, (_, i) => ({
  id: i,
  left: `${(i * 3.3 + 1.5) % 100}%`,
  duration: `${2.2 + (i % 5) * 0.35}s`,
  delay: `${(i % 7) * 0.25}s`,
  rotate: `${360 + (i * 73) % 720}deg`,
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  isCircle: i % 2 === 0,
}));

export default function GameScreen({
  room,
  setRoom,
  myPlayerId,
  initialStrokes,
  initialMessages,
  initialWordOptions,
  onLeave,
}: Props) {
  const [wordOptions, setWordOptions] = useState<string[]>(
    room.wordOptions && room.wordOptions.length > 0
      ? room.wordOptions
      : (initialWordOptions ?? [])
  );
  const [roundEndWord, setRoundEndWord] = useState<string | null>(null);
  const [roundEndScores, setRoundEndScores] = useState<Record<string, number>>({});
  const [roundEndTurnPoints, setRoundEndTurnPoints] = useState<Record<string, number>>({});
  const [gameOverData, setGameOverData] = useState<GameOverPayload | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [strokes, setStrokes] = useState<Stroke[]>(initialStrokes ?? []);
  const [maskedHint, setMaskedHint] = useState<string | null>(room.hint ?? null);

  const [revealedIndices, setRevealedIndices] = useState<Set<number>>(new Set());
  const prevHintRef = useRef<string | null>(room.hint ?? null);

  const [flashes, setFlashes] = useState<Record<string, { points: number; id: number }>>({});
  const [muted, setMutedState] = useState(() => isMuted());

  const [messages, setMessages] = useState<ChatMessagePayload[]>(initialMessages ?? []);
  const [chatInput, setChatInput] = useState("");
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const [confirmKick, setConfirmKick] = useState<{
    playerId: string;
    ban: boolean;
  } | null>(null);
  const [activeMenuPlayerId, setActiveMenuPlayerId] = useState<string | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  function executeKick(playerId: string, ban: boolean) {
    socket.emit(SocketEvent.KickPlayer, { playerId, ban });
    setConfirmKick(null);
    setActiveMenuPlayerId(null);
  }

  const isDebug =
    import.meta.env.DEV &&
    (import.meta.env.VITE_DEBUG === "true" ||
      localStorage.getItem("debug") === "true");

  useEffect(() => {
    socket.emit(SocketEvent.GetGameState);
  }, []);

  useEffect(() => {
    if (initialStrokes && initialStrokes.length > 0) {
      setStrokes(initialStrokes);
    }
  }, [initialStrokes]);

  useEffect(() => {
    if (initialMessages && initialMessages.length > 0) {
      setMessages(initialMessages);
    }
  }, [initialMessages]);

  useEffect(() => {
    if (initialWordOptions && initialWordOptions.length > 0) {
      setWordOptions(initialWordOptions);
    }
  }, [initialWordOptions]);

  useEffect(() => {
    if (room.wordOptions && room.wordOptions.length > 0) {
      setWordOptions(room.wordOptions);
    }
  }, [room.wordOptions]);

  useEffect(() => {
    if (room.hint) {
      setMaskedHint(room.hint);
    }
  }, [room.hint]);

  // Track newly revealed hint letters to highlight them briefly
  useEffect(() => {
    if (!maskedHint) {
      prevHintRef.current = null;
      setRevealedIndices(new Set());
      return;
    }
    const prev = prevHintRef.current;
    if (prev && prev !== maskedHint) {
      const newlyRevealed = new Set<number>();
      for (let i = 0; i < maskedHint.length; i++) {
        const c = maskedHint[i];
        if (c !== "_" && c !== " " && (!prev[i] || prev[i] === "_")) {
          newlyRevealed.add(i);
        }
      }
      if (newlyRevealed.size > 0) {
        setRevealedIndices(newlyRevealed);
        const timer = setTimeout(() => {
          setRevealedIndices(new Set());
        }, 700);
        prevHintRef.current = maskedHint;
        return () => clearTimeout(timer);
      }
    }
    prevHintRef.current = maskedHint;
  }, [maskedHint]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    function onRoundStart(data: RoundStartPayload) {
      setWordOptions(data.wordOptions ?? []);
      setRoundEndWord(null);
      setGameOverData(null);
      setMaskedHint(null);
      setRoom((prev) =>
        prev
          ? {
              ...prev,
              phase: GamePhase.WORD_SELECT,
              currentRound: data.round,
              currentDrawer: data.drawerId,
              endsAt: data.endsAt,
              wordOptions: data.wordOptions ?? prev.wordOptions,
              word: null,
              hint: null,
              players: prev.players.map((p) => ({
                ...p,
                isDrawing: p.id === data.drawerId,
                hasGuessed: false,
              })),
            }
          : prev
      );
    }

    function onWordChosen(data: WordChosenPayload) {
      setWordOptions([]);
      if (data.hint) setMaskedHint(data.hint);
      setRoom((prev) =>
        prev
          ? {
              ...prev,
              phase: GamePhase.DRAWING,
              wordLength: data.wordLength,
              endsAt: data.endsAt,
              word: data.word ?? prev.word,
              hint: data.hint ?? prev.hint,
              wordOptions: undefined,
            }
          : prev
      );
    }

    function onHintUpdate(data: HintUpdatePayload) {
      setMaskedHint(data.hint);
      setRoom((prev) => (prev ? { ...prev, hint: data.hint } : prev));
    }

    function onGuessResult(data: GuessResultPayload) {
      if (data.correct && data.playerId) {
        playCorrectSound();
        const flashId = Date.now() + Math.random();
        setFlashes((prev) => ({
          ...prev,
          [data.playerId]: { points: data.points ?? 0, id: flashId },
        }));
        setTimeout(() => {
          setFlashes((prev) => {
            if (prev[data.playerId]?.id === flashId) {
              const copy = { ...prev };
              delete copy[data.playerId];
              return copy;
            }
            return prev;
          });
        }, 1200);
      }

      setRoom((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          players: prev.players.map((p) => {
            if (p.id === data.playerId) {
              return {
                ...p,
                hasGuessed: true,
                score: data.scores?.[p.id] ?? p.score,
              };
            }
            return {
              ...p,
              score: data.scores?.[p.id] ?? p.score,
            };
          }),
        };
      });
    }

    function onChatMessage(data: ChatMessagePayload) {
      if (data.type === "correct") {
        playCorrectSound();
      }
      setMessages((prev) => [...prev, data]);
    }

    function onRoundEnd(data: RoundEndPayload) {
      setRoundEndWord(data.word);
      setRoundEndScores(data.scores);
      setRoundEndTurnPoints(data.turnPoints ?? {});
      setRoom((prev) =>
        prev
          ? {
              ...prev,
              phase: GamePhase.ROUND_END,
              currentDrawer: data.nextDrawerId,
              players: prev.players.map((p) => ({
                ...p,
                score: data.scores[p.id] ?? p.score,
              })),
            }
          : prev
      );
    }

    function onGameOver(data: GameOverPayload) {
      setGameOverData(data);
      setRoom((prev) =>
        prev
          ? {
              ...prev,
              phase: GamePhase.GAME_OVER,
              currentDrawer: null,
              currentRound: Math.min(prev.currentRound, prev.totalRounds),
              players: (data.leaderboard ?? prev.players).map((p) => ({
                ...p,
                isDrawing: false,
                hasGuessed: false,
              })),
            }
          : prev
      );
    }

    function onGameState(data: GameStatePayload) {
      setRoom(data.room);
      if (data.room.wordOptions && data.room.wordOptions.length > 0) {
        setWordOptions(data.room.wordOptions);
      }
      if (data.hint) setMaskedHint(data.hint);
      if (data.strokes) setStrokes(data.strokes);
    }

    socket.on(SocketEvent.RoundStart, onRoundStart);
    socket.on(SocketEvent.WordChosen, onWordChosen);
    socket.on(SocketEvent.HintUpdate, onHintUpdate);
    socket.on(SocketEvent.GuessResult, onGuessResult);
    socket.on(SocketEvent.ChatMessage, onChatMessage);
    socket.on(SocketEvent.RoundEnd, onRoundEnd);
    socket.on(SocketEvent.GameOver, onGameOver);
    socket.on(SocketEvent.GameState, onGameState);

    return () => {
      socket.off(SocketEvent.RoundStart, onRoundStart);
      socket.off(SocketEvent.WordChosen, onWordChosen);
      socket.off(SocketEvent.HintUpdate, onHintUpdate);
      socket.off(SocketEvent.GuessResult, onGuessResult);
      socket.off(SocketEvent.ChatMessage, onChatMessage);
      socket.off(SocketEvent.RoundEnd, onRoundEnd);
      socket.off(SocketEvent.GameOver, onGameOver);
      socket.off(SocketEvent.GameState, onGameState);
    };
  }, [setRoom]);

  useEffect(() => {
    if (!room.endsAt) {
      setTimeLeft(0);
      return;
    }
    const update = () => {
      const remain = Math.max(0, Math.ceil((room.endsAt! - Date.now()) / 1000));
      setTimeLeft(remain);
    };
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [room.endsAt]);

  const isDrawer = room.currentDrawer === myPlayerId;
  const isHost = room.hostId === myPlayerId;
  const me = room.players.find((p) => p.id === myPlayerId);
  const hasGuessed = me?.hasGuessed ?? false;
  const drawer = room.players.find((p) => p.id === room.currentDrawer);
  const currentWordOptions =
    room.phase === GamePhase.WORD_SELECT && isDrawer
      ? (room.wordOptions && room.wordOptions.length > 0
          ? room.wordOptions
          : wordOptions)
      : [];

  function pickWord(word: string) {
    socket.emit(SocketEvent.SelectWord, { word });
    setWordOptions([]);
    setRoom((prev) => (prev ? { ...prev, wordOptions: undefined } : prev));
  }

  function endTurn() {
    socket.emit(SocketEvent.EndTurn);
  }

  function playAgain() {
    socket.emit(SocketEvent.PlayAgain);
  }

  function handleSendChat(e: FormEvent) {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text) return;
    socket.emit(SocketEvent.Chat, { text });
    setChatInput("");
  }

  function renderWordPrompt() {
    if (room.phase === GamePhase.DRAWING) {
      if (isDrawer) {
        return (
          <div className="word-prompt drawer-word">
            <span>
              Word: <strong>{room.word}</strong>
            </span>
            {isDebug && (
              <button
                className="btn btn-sm btn-debug"
                onClick={endTurn}
                title="Debug button - visible when VITE_DEBUG=true"
              >
                [DEBUG] End turn
              </button>
            )}
          </div>
        );
      }

      if (hasGuessed) {
        return (
          <div className="word-prompt guesser-word-guessed">
            <span>
              Word: <strong>{room.word}</strong>
            </span>
            <span className="guessed-notice">✓ You guessed!</span>
          </div>
        );
      }

      if (room.settings.wordMode === WordMode.Hidden) {
        return (
          <div className="word-prompt guesser-word">
            <span className="blanks">?</span>
            <span className="word-len">(Hidden mode)</span>
          </div>
        );
      }

      const displayHint =
        maskedHint ||
        (room.wordLength ? Array(room.wordLength).fill("_").join(" ") : "");
      return (
        <div className="word-prompt guesser-word">
          <span className="blanks">
            {displayHint.split("").map((ch, idx) => (
              <span
                key={idx}
                className={revealedIndices.has(idx) ? "hint-char-reveal" : ""}
              >
                {ch}
              </span>
            ))}
          </span>
          {room.wordLength && (
            <span className="word-len">({room.wordLength} letters)</span>
          )}
        </div>
      );
    }

    if (room.phase === GamePhase.WORD_SELECT) {
      return (
        <div className="word-prompt">
          <span>
            {isDrawer
              ? "Choose a word"
              : `${drawer?.name ?? "Drawer"} is choosing a word`}
          </span>
        </div>
      );
    }

    if (room.phase === GamePhase.ROUND_END) {
      return (
        <div className="word-prompt">
          <span>Round ended</span>
        </div>
      );
    }

    return (
      <div className="word-prompt">
        <span>Game over</span>
      </div>
    );
  }

  const sortedPlayers = [...room.players].sort((a, b) => b.score - a.score);
  const sortedLeaderboard = (gameOverData?.leaderboard ?? sortedPlayers);

  const isTimedPhase =
    room.phase === GamePhase.WORD_SELECT || room.phase === GamePhase.DRAWING;
  const timerClass =
    isTimedPhase && timeLeft > 0
      ? timeLeft <= 10
        ? "timer-red"
        : timeLeft <= 20
        ? "timer-amber"
        : ""
      : "";

  return (
    <div className="game-screen">
      <header className="game-topbar">
        <div className="topbar-left">
          <span className="round-badge">
            Round {Math.min(room.currentRound, room.totalRounds)} of {room.totalRounds}
          </span>
        </div>
        <div className="topbar-center">{renderWordPrompt()}</div>
        <div className="topbar-right">
          <span className={`timer-badge ${timerClass}`}>
            {isTimedPhase ? `${timeLeft}s` : "—"}
          </span>
          <button
            type="button"
            className={`mute-btn ${muted ? "muted" : ""}`}
            onClick={() => setMutedState(toggleMuted())}
            title={muted ? "Sound muted (click to unmute)" : "Sound on (click to mute)"}
            aria-label={muted ? "Unmute sound" : "Mute sound"}
          >
            {muted ? "🔇" : "🔊"}
          </button>
          {showLeaveConfirm ? (
            <span className="confirm-leave-group">
              <button
                type="button"
                className="btn btn-sm btn-danger btn-confirm-leave"
                onClick={onLeave}
              >
                Leave?
              </button>
              <button
                type="button"
                className="btn btn-sm btn-cancel-leave"
                onClick={() => setShowLeaveConfirm(false)}
                title="Cancel"
              >
                ✕
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => setShowLeaveConfirm(true)}
            >
              Leave
            </button>
          )}
        </div>
      </header>

      <div className="game-body">
        <aside className="game-sidebar">
          <h3>Scoreboard</h3>
          <ul className="sidebar-player-list">
            {sortedPlayers.map((p, idx) => {
              const drawing =
                isTimedPhase && (p.isDrawing || p.id === room.currentDrawer);
              const guessed =
                room.phase === GamePhase.DRAWING && p.hasGuessed;
              const flash = flashes[p.id];
              return (
                <li
                  key={p.id}
                  className={`sidebar-player ${drawing ? "active-drawer" : ""} ${
                    guessed ? "player-guessed" : ""
                  } ${flash ? "player-score-flash" : ""} ${
                    !p.isConnected ? "player-offline" : ""
                  }`}
                >
                  <div className="player-meta">
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", minWidth: 0, flex: 1 }}>
                      <Avatar name={p.name} seed={p.id} size="sm" />
                      <span className="player-name" title={p.name}>
                        #{idx + 1} {p.name}
                      </span>
                    </div>
                    <span className="player-score">{p.score} pts</span>
                  </div>
                  {flash && flash.points > 0 && (
                    <span className="floating-points">+{flash.points}</span>
                  )}
                  <div className="player-tags">
                    {!p.isConnected && <span className="tag-offline">Offline</span>}
                    {drawing && <span className="tag-drawing">Drawing</span>}
                    {guessed && <span className="tag-guessed">Guessed</span>}
                    {p.isHost && <span className="host-badge">Host</span>}
                    {p.id === myPlayerId && <span className="you-badge">You</span>}
                  </div>
                  {isHost && p.id !== myPlayerId && room.phase !== GamePhase.GAME_OVER && (
                    <div className="sidebar-player-actions">
                      {confirmKick?.playerId === p.id ? (
                        <span className="confirm-group">
                          <button
                            type="button"
                            className="btn btn-xs btn-danger"
                            onClick={() => executeKick(p.id, confirmKick.ban)}
                          >
                            Confirm {confirmKick.ban ? "Ban" : "Kick"}?
                          </button>
                          <button
                            type="button"
                            className="btn btn-xs"
                            onClick={() => setConfirmKick(null)}
                          >
                            ✕
                          </button>
                        </span>
                      ) : (
                        <div className="player-menu-wrapper">
                          <button
                            type="button"
                            className="player-menu-btn"
                            aria-label="Player actions"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveMenuPlayerId(activeMenuPlayerId === p.id ? null : p.id);
                            }}
                          >
                            ⋯
                          </button>
                          {activeMenuPlayerId === p.id && (
                            <div className="player-menu-dropdown">
                              <button
                                type="button"
                                className="player-menu-item btn-kick"
                                onClick={() => {
                                  setActiveMenuPlayerId(null);
                                  setConfirmKick({ playerId: p.id, ban: false });
                                }}
                              >
                                Kick
                              </button>
                              <button
                                type="button"
                                className="player-menu-item btn-ban"
                                onClick={() => {
                                  setActiveMenuPlayerId(null);
                                  setConfirmKick({ playerId: p.id, ban: true });
                                }}
                              >
                                Ban
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </aside>

        <main className="game-board">
          <Canvas
            isDrawer={isDrawer}
            phase={room.phase}
            initialStrokes={strokes}
          />

          {room.phase === GamePhase.WORD_SELECT && (
            <div className="game-overlay">
              <div className="overlay-card">
                {isDrawer ? (
                  <>
                    <h2>Pick a word</h2>
                    <div className="word-buttons">
                      {currentWordOptions.map((w) => (
                        <button
                          key={w}
                          className="btn btn-word"
                          onClick={() => pickWord(w)}
                        >
                          {w}
                        </button>
                      ))}
                    </div>
                    <div className="word-select-countdown">
                      <div
                        className="word-select-countdown-bar"
                        style={{
                          width: `${Math.max(0, Math.min(100, (timeLeft / 15) * 100))}%`,
                        }}
                      />
                    </div>
                    <span className="subtext">Auto-selects in {timeLeft}s</span>
                  </>
                ) : (
                  <>
                    <h2>{drawer?.name ?? "Drawer"} is choosing a word...</h2>
                    <div className="word-select-countdown">
                      <div
                        className="word-select-countdown-bar"
                        style={{
                          width: `${Math.max(0, Math.min(100, (timeLeft / 15) * 100))}%`,
                        }}
                      />
                    </div>
                    <span className="subtext">{timeLeft}s remaining</span>
                  </>
                )}
              </div>
            </div>
          )}

          {room.phase === GamePhase.ROUND_END && (
            <div className="game-overlay">
              <div className="overlay-card">
                <h2>Round finished</h2>
                <p className="round-result">
                  The word was <strong>{roundEndWord}</strong>
                </p>
                <div className="scores-table">
                  {sortedPlayers.map((p) => {
                    const diff = roundEndTurnPoints[p.id] ?? 0;
                    return (
                      <div
                        key={p.id}
                        className={`score-item ${diff > 0 ? "score-item-highlight" : ""}`}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0, flex: 1 }}>
                          <Avatar name={p.name} seed={p.id} size="sm" />
                          <span className="score-name" title={p.name}>{p.name}</span>
                        </div>
                        {diff > 0 && (
                          <span className="score-diff count-up">+{diff}</span>
                        )}
                        <div className="score-total-col">
                          <span className="score-total-label">total</span>
                          <span className="score-total">
                            {roundEndScores[p.id] ?? p.score} pts
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <span className="subtext">Next turn starts soon</span>
              </div>
            </div>
          )}

          {room.phase === GamePhase.GAME_OVER && (
            <div className="game-overlay">
              <div className="confetti-container" aria-hidden="true">
                {CONFETTI_PIECES.map((piece) => (
                  <div
                    key={piece.id}
                    className="confetti-piece"
                    style={{
                      left: piece.left,
                      backgroundColor: piece.color,
                      borderRadius: piece.isCircle ? "50%" : "2px",
                      ["--confetti-duration" as any]: piece.duration,
                      ["--confetti-delay" as any]: piece.delay,
                      ["--confetti-rotate" as any]: piece.rotate,
                    }}
                  />
                ))}
              </div>
              <div className="overlay-card">
                <h2>Game Over</h2>
                {gameOverData?.winners && gameOverData.winners.length > 1 ? (
                  <div className="winner-banner">
                    <span className="winner-banner-crown">👑</span>
                    <span className="winner-banner-text">
                      Tie: <strong className="winner-name">{gameOverData.winners.map((w) => w.name).join(" and ")}</strong> ({gameOverData.winners[0].score} pts each)
                    </span>
                  </div>
                ) : (
                  (gameOverData?.winner || sortedLeaderboard[0]) && (
                    <div className="winner-banner">
                      <span className="winner-banner-crown">👑</span>
                      <span className="winner-banner-text">
                        Winner: <strong className="winner-name">{gameOverData?.winner?.name ?? sortedLeaderboard[0].name}</strong> ({gameOverData?.winner?.score ?? sortedLeaderboard[0].score} pts)
                      </span>
                    </div>
                  )
                )}

                {/* Top 3 Podium */}
                {sortedLeaderboard.length >= 2 && (
                  <div className="podium">
                    {sortedLeaderboard[1] && (
                      <div className="podium-place podium-2">
                        <Avatar name={sortedLeaderboard[1].name} seed={sortedLeaderboard[1].id} size="sm" />
                        <span className="podium-name" title={sortedLeaderboard[1].name}>{sortedLeaderboard[1].name}</span>
                        <div className="podium-bar">2</div>
                        <span className="podium-score">{sortedLeaderboard[1].score} pts</span>
                      </div>
                    )}
                    {sortedLeaderboard[0] && (
                      <div className="podium-place podium-1">
                        <div className="winner-crown" style={{ fontSize: "1.25rem", animation: "none" }}>👑</div>
                        <Avatar name={sortedLeaderboard[0].name} seed={sortedLeaderboard[0].id} size="sm" />
                        <span className="podium-name" title={sortedLeaderboard[0].name}>{sortedLeaderboard[0].name}</span>
                        <div className="podium-bar">1</div>
                        <span className="podium-score">{sortedLeaderboard[0].score} pts</span>
                      </div>
                    )}
                    {sortedLeaderboard[2] && (
                      <div className="podium-place podium-3">
                        <Avatar name={sortedLeaderboard[2].name} seed={sortedLeaderboard[2].id} size="sm" />
                        <span className="podium-name" title={sortedLeaderboard[2].name}>{sortedLeaderboard[2].name}</span>
                        <div className="podium-bar">3</div>
                        <span className="podium-score">{sortedLeaderboard[2].score} pts</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="leaderboard-table">
                  {sortedLeaderboard.map((p, idx) => (
                    <div key={p.id} className="leaderboard-item">
                      <span className="rank">#{idx + 1}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flex: 1, minWidth: 0 }}>
                        <Avatar name={p.name} seed={p.id} size="sm" />
                        <span className="name">{p.name}</span>
                      </div>
                      <span className="score">{p.score} pts</span>
                    </div>
                  ))}
                </div>
                {isHost ? (
                  <button
                    className="btn btn-primary btn-play-again"
                    onClick={playAgain}
                  >
                    Play Again
                  </button>
                ) : (
                  <span className="subtext">Waiting for host to restart</span>
                )}
              </div>
            </div>
          )}
        </main>

        <section className="game-chat-panel">
          <div className="chat-header">
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <h3>Chat</h3>
              {room.phase === GamePhase.DRAWING && (
                <span className="chat-channel-badge">
                  {isDrawer || hasGuessed ? "Guessed Channel" : "Guessing"}
                </span>
              )}
            </div>
          </div>

          <div className="chat-messages">
            {messages.map((m, idx) => {
              if (m.type === "correct") {
                return (
                  <div key={idx} className="chat-msg chat-msg-correct">
                    {m.text}
                  </div>
                );
              }
              if (m.type === "close") {
                return (
                  <div key={idx} className="chat-msg chat-msg-close">
                    {m.text}
                  </div>
                );
              }
              if (m.type === "system") {
                return (
                  <div key={idx} className="chat-msg chat-msg-system">
                    {m.text}
                  </div>
                );
              }
              return (
                <div
                  key={idx}
                  className="chat-msg"
                  style={{ display: "flex", alignItems: "baseline", gap: "0.35rem" }}
                >
                  <Avatar name={m.name} seed={m.playerId || m.name} size="sm" />
                  <div style={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>
                    <span className="chat-author">{m.name}: </span>
                    <span className="chat-text">{m.text}</span>
                  </div>
                </div>
              );
            })}
            <div ref={chatBottomRef} />
          </div>

          <form onSubmit={handleSendChat} className="chat-form">
            <input
              type="text"
              placeholder={
                room.phase === GamePhase.DRAWING && !isDrawer && !hasGuessed
                  ? "Type your guess here..."
                  : "Type a message..."
              }
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              maxLength={200}
              className="chat-input"
            />
          </form>
        </section>
      </div>
    </div>
  );
}
