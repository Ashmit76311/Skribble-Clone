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

interface Props {
  room: RoomData;
  setRoom: React.Dispatch<React.SetStateAction<RoomData | null>>;
  onLeave: () => void;
}

export default function GameScreen({ room, setRoom, onLeave }: Props) {
  const [wordOptions, setWordOptions] = useState<string[]>([]);
  const [roundEndWord, setRoundEndWord] = useState<string | null>(null);
  const [roundEndScores, setRoundEndScores] = useState<Record<string, number>>({});
  const [roundEndTurnPoints, setRoundEndTurnPoints] = useState<Record<string, number>>({});
  const [gameOverData, setGameOverData] = useState<GameOverPayload | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [maskedHint, setMaskedHint] = useState<string | null>(room.hint ?? null);

  const [messages, setMessages] = useState<ChatMessagePayload[]>([]);
  const [chatInput, setChatInput] = useState("");
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const isDebug =
    import.meta.env.VITE_DEBUG === "true" ||
    localStorage.getItem("debug") === "true";

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
            }
          : prev
      );
    }

    function onHintUpdate(data: HintUpdatePayload) {
      setMaskedHint(data.hint);
      setRoom((prev) => (prev ? { ...prev, hint: data.hint } : prev));
    }

    function onGuessResult(data: GuessResultPayload) {
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
              players: data.leaderboard,
            }
          : prev
      );
    }

    function onGameState(data: GameStatePayload) {
      setRoom(data.room);
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

  const isDrawer = room.currentDrawer === socket.id;
  const isHost = room.hostId === socket.id;
  const me = room.players.find((p) => p.id === socket.id);
  const hasGuessed = me?.hasGuessed ?? false;
  const drawer = room.players.find((p) => p.id === room.currentDrawer);

  function pickWord(word: string) {
    socket.emit(SocketEvent.SelectWord, { word });
    setWordOptions([]);
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
          <span className="blanks">{displayHint}</span>
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

  return (
    <div className="game-screen">
      <header className="game-topbar">
        <div className="topbar-left">
          <span className="round-badge">
            Round {room.currentRound} of {room.totalRounds}
          </span>
        </div>
        <div className="topbar-center">{renderWordPrompt()}</div>
        <div className="topbar-right">
          <span className="timer-badge">{timeLeft}s</span>
          <button className="btn btn-sm btn-danger" onClick={onLeave}>
            Leave
          </button>
        </div>
      </header>

      <div className="game-body">
        <aside className="game-sidebar">
          <h3>Scoreboard</h3>
          <ul className="sidebar-player-list">
            {sortedPlayers.map((p, idx) => {
              const drawing = p.id === room.currentDrawer;
              return (
                <li
                  key={p.id}
                  className={`sidebar-player ${drawing ? "active-drawer" : ""} ${
                    p.hasGuessed ? "player-guessed" : ""
                  }`}
                >
                  <div className="player-meta">
                    <span className="player-name">
                      #{idx + 1} {p.name}
                    </span>
                    <span className="player-score">{p.score} pts</span>
                  </div>
                  <div className="player-tags">
                    {drawing && <span className="tag-drawing">Drawing</span>}
                    {p.hasGuessed && <span className="tag-guessed">Guessed</span>}
                    {p.isHost && <span className="host-badge">Host</span>}
                    {p.id === socket.id && <span className="you-badge">You</span>}
                  </div>
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
                      {wordOptions.map((w) => (
                        <button
                          key={w}
                          className="btn btn-word"
                          onClick={() => pickWord(w)}
                        >
                          {w}
                        </button>
                      ))}
                    </div>
                    <span className="subtext">Auto-selects in {timeLeft}s</span>
                  </>
                ) : (
                  <>
                    <h2>{drawer?.name ?? "Drawer"} is choosing a word...</h2>
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
                      <div key={p.id} className="score-item">
                        <span className="score-name">{p.name}</span>
                        {diff > 0 && (
                          <span className="score-diff">+{diff} pts</span>
                        )}
                        <span className="score-total">
                          {roundEndScores[p.id] ?? p.score} pts
                        </span>
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
              <div className="overlay-card">
                <h2>Game Over</h2>
                {gameOverData?.winners && gameOverData.winners.length > 1 ? (
                  <div className="winner-box">
                    <span className="winner-label">It's a Tie! Winners:</span>
                    <span className="winner-name">
                      {gameOverData.winners.map((w) => w.name).join(", ")}
                    </span>
                    <span className="winner-score">
                      {gameOverData.winners[0].score} pts each
                    </span>
                  </div>
                ) : (
                  gameOverData?.winner && (
                    <div className="winner-box">
                      <span className="winner-label">Winner</span>
                      <span className="winner-name">
                        {gameOverData.winner.name}
                      </span>
                      <span className="winner-score">
                        {gameOverData.winner.score} pts
                      </span>
                    </div>
                  )
                )}
                <div className="leaderboard-table">
                  {(gameOverData?.leaderboard ?? sortedPlayers).map((p, idx) => (
                    <div key={p.id} className="leaderboard-item">
                      <span className="rank">#{idx + 1}</span>
                      <span className="name">{p.name}</span>
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
            <h3>Chat</h3>
            {room.phase === GamePhase.DRAWING && (
              <span className="chat-channel-badge">
                {isDrawer || hasGuessed ? "Guessed Channel" : "Guessing"}
              </span>
            )}
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
                <div key={idx} className="chat-msg">
                  <span className="chat-author">{m.name}: </span>
                  <span className="chat-text">{m.text}</span>
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
