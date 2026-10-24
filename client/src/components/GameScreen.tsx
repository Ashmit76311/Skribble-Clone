import { useState, useEffect } from "react";
import { socket } from "../socket";
import { GamePhase, SocketEvent } from "@skribbl/shared";
import type {
  RoomData,
  RoundStartPayload,
  WordChosenPayload,
  RoundEndPayload,
  GameOverPayload,
  GameStatePayload,
  Stroke,
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
  const [gameOverData, setGameOverData] = useState<GameOverPayload | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [strokes, setStrokes] = useState<Stroke[]>([]);

  useEffect(() => {
    function onRoundStart(data: RoundStartPayload) {
      setWordOptions(data.wordOptions ?? []);
      setRoundEndWord(null);
      setGameOverData(null);
      setRoom((prev) =>
        prev
          ? {
              ...prev,
              phase: GamePhase.WORD_SELECT,
              currentRound: data.round,
              currentDrawer: data.drawerId,
              endsAt: data.endsAt,
              word: null,
            }
          : prev
      );
    }

    function onWordChosen(data: WordChosenPayload) {
      setWordOptions([]);
      setRoom((prev) =>
        prev
          ? {
              ...prev,
              phase: GamePhase.DRAWING,
              wordLength: data.wordLength,
              endsAt: data.endsAt,
              word: data.word ?? prev.word,
            }
          : prev
      );
    }

    function onRoundEnd(data: RoundEndPayload) {
      setRoundEndWord(data.word);
      setRoundEndScores(data.scores);
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
      if (data.strokes) {
        setStrokes(data.strokes);
      }
    }

    socket.on(SocketEvent.RoundStart, onRoundStart);
    socket.on(SocketEvent.WordChosen, onWordChosen);
    socket.on(SocketEvent.RoundEnd, onRoundEnd);
    socket.on(SocketEvent.GameOver, onGameOver);
    socket.on(SocketEvent.GameState, onGameState);

    return () => {
      socket.off(SocketEvent.RoundStart, onRoundStart);
      socket.off(SocketEvent.WordChosen, onWordChosen);
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

  function renderWordPrompt() {
    if (room.phase === GamePhase.DRAWING) {
      if (isDrawer) {
        return (
          <div className="word-prompt drawer-word">
            <span>Word: <strong>{room.word}</strong></span>
            <button className="btn btn-sm btn-debug" onClick={endTurn} title="Debug button - will be removed in cleanup">
              [DEBUG] End turn
            </button>
          </div>
        );
      }
      const blanks = room.wordLength ? Array(room.wordLength).fill("_").join(" ") : "";
      return (
        <div className="word-prompt guesser-word">
          <span className="blanks">{blanks}</span>
          <span className="word-len">({room.wordLength} letters)</span>
        </div>
      );
    }

    if (room.phase === GamePhase.WORD_SELECT) {
      return (
        <div className="word-prompt">
          <span>{isDrawer ? "Choose a word" : `${drawer?.name ?? "Drawer"} is choosing a word`}</span>
        </div>
      );
    }

    if (room.phase === GamePhase.ROUND_END) {
      return <div className="word-prompt"><span>Round ended</span></div>;
    }

    return <div className="word-prompt"><span>Game over</span></div>;
  }

  return (
    <div className="game-screen">
      <header className="game-topbar">
        <div className="topbar-left">
          <span className="round-badge">Round {room.currentRound} of {room.totalRounds}</span>
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
          <h3>Players</h3>
          <ul className="sidebar-player-list">
            {room.players.map((p) => {
              const drawing = p.id === room.currentDrawer;
              return (
                <li key={p.id} className={`sidebar-player ${drawing ? "active-drawer" : ""}`}>
                  <div className="player-meta">
                    <span className="player-name">{p.name}</span>
                    <span className="player-score">{p.score} pts</span>
                  </div>
                  <div className="player-tags">
                    {drawing && <span className="tag-drawing">Drawing</span>}
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
                        <button key={w} className="btn btn-word" onClick={() => pickWord(w)}>
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
                  {room.players.map((p) => (
                    <div key={p.id} className="score-item">
                      <span>{p.name}</span>
                      <span>{roundEndScores[p.id] ?? p.score} pts</span>
                    </div>
                  ))}
                </div>
                <span className="subtext">Next turn starts soon</span>
              </div>
            </div>
          )}

          {room.phase === GamePhase.GAME_OVER && (
            <div className="game-overlay">
              <div className="overlay-card">
                <h2>Game Over</h2>
                {gameOverData?.winner && (
                  <div className="winner-box">
                    <span className="winner-label">Winner</span>
                    <span className="winner-name">{gameOverData.winner.name}</span>
                    <span className="winner-score">{gameOverData.winner.score} pts</span>
                  </div>
                )}
                <div className="leaderboard-table">
                  {(gameOverData?.leaderboard ?? room.players).map((p, idx) => (
                    <div key={p.id} className="leaderboard-item">
                      <span className="rank">#{idx + 1}</span>
                      <span className="name">{p.name}</span>
                      <span className="score">{p.score} pts</span>
                    </div>
                  ))}
                </div>
                {isHost ? (
                  <button className="btn btn-primary btn-play-again" onClick={playAgain}>
                    Play Again
                  </button>
                ) : (
                  <span className="subtext">Waiting for host to restart</span>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
