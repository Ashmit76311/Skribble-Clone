import { useRef, useEffect, useState } from "react";
import { socket } from "../socket";
import { GamePhase, SocketEvent } from "@skribbl/shared";
import type {
  Stroke,
  DrawDataPayload,
  DrawUndoPayload,
  GameStatePayload,
} from "@skribbl/shared";

interface CanvasProps {
  isDrawer: boolean;
  phase: GamePhase;
  initialStrokes?: Stroke[];
}

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

const COLORS = [
  "#000000",
  "#ffffff",
  "#737373",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#78350f",
];

const SIZES = [
  { label: "S", size: 4, dot: 6 },
  { label: "M", size: 8, dot: 10 },
  { label: "L", size: 16, dot: 16 },
  { label: "XL", size: 28, dot: 22 },
];

function drawAllStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  w: number,
  h: number
) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  for (const stroke of strokes) {
    drawSingleStroke(ctx, stroke, w, h);
  }
}

function drawSingleStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  w: number,
  h: number
) {
  const pts = stroke.points;
  if (!pts || pts.length === 0) return;

  ctx.save();
  const color = stroke.tool === "eraser" ? "#ffffff" : stroke.color;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = stroke.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x * w, pts[0].y * h, stroke.size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (pts.length === 2) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x * w, pts[0].y * h);
    ctx.lineTo(pts[1].x * w, pts[1].y * h);
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(pts[0].x * w, pts[0].y * h);

  for (let i = 1; i < pts.length - 1; i++) {
    const xc = ((pts[i].x + pts[i + 1].x) / 2) * w;
    const yc = ((pts[i].y + pts[i + 1].y) / 2) * h;
    ctx.quadraticCurveTo(pts[i].x * w, pts[i].y * h, xc, yc);
  }

  const last = pts[pts.length - 1];
  ctx.lineTo(last.x * w, last.y * h);
  ctx.stroke();
  ctx.restore();
}

export default function Canvas({ isDrawer, phase, initialStrokes = [] }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const strokesRef = useRef<Stroke[]>([...initialStrokes]);
  const currentStrokeRef = useRef<Stroke | null>(null);

  const [color, setColor] = useState("#000000");
  const [size, setSize] = useState(8);
  const [tool, setTool] = useState<"brush" | "eraser">("brush");

  // Keep strokes synced with initialStrokes
  useEffect(() => {
    if (initialStrokes && initialStrokes.length > 0) {
      strokesRef.current = [...initialStrokes];
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) drawAllStrokes(ctx, strokesRef.current, CANVAS_WIDTH, CANVAS_HEIGHT);
      }
    }
  }, [initialStrokes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    drawAllStrokes(ctx, strokesRef.current, CANVAS_WIDTH, CANVAS_HEIGHT);

    function onDrawData(data: DrawDataPayload) {
      if (!ctx) return;

      if (data.type === "start") {
        currentStrokeRef.current = {
          points: [{ x: data.x!, y: data.y! }],
          color: data.color ?? "#000000",
          size: data.size ?? 8,
          tool: data.tool ?? "brush",
        };

        const drawColor = data.tool === "eraser" ? "#ffffff" : data.color ?? "#000000";
        ctx.save();
        ctx.fillStyle = drawColor;
        ctx.beginPath();
        ctx.arc(
          data.x! * CANVAS_WIDTH,
          data.y! * CANVAS_HEIGHT,
          (data.size ?? 8) / 2,
          0,
          Math.PI * 2
        );
        ctx.fill();
        ctx.restore();
      } else if (data.type === "move") {
        const current = currentStrokeRef.current;
        if (!current) return;

        current.points.push({ x: data.x!, y: data.y! });
        const pts = current.points;
        const len = pts.length;

        ctx.save();
        const drawColor = current.tool === "eraser" ? "#ffffff" : current.color;
        ctx.strokeStyle = drawColor;
        ctx.lineWidth = current.size;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();

        if (len === 2) {
          ctx.moveTo(pts[0].x * CANVAS_WIDTH, pts[0].y * CANVAS_HEIGHT);
          ctx.lineTo(pts[1].x * CANVAS_WIDTH, pts[1].y * CANVAS_HEIGHT);
        } else {
          const p0 = pts[len - 3];
          const p1 = pts[len - 2];
          const p2 = pts[len - 1];
          const m0x = ((p0.x + p1.x) / 2) * CANVAS_WIDTH;
          const m0y = ((p0.y + p1.y) / 2) * CANVAS_HEIGHT;
          const m1x = ((p1.x + p2.x) / 2) * CANVAS_WIDTH;
          const m1y = ((p1.y + p2.y) / 2) * CANVAS_HEIGHT;
          ctx.moveTo(m0x, m0y);
          ctx.quadraticCurveTo(p1.x * CANVAS_WIDTH, p1.y * CANVAS_HEIGHT, m1x, m1y);
        }
        ctx.stroke();
        ctx.restore();
      } else if (data.type === "end") {
        const current = currentStrokeRef.current;
        if (current) {
          const pts = current.points;
          if (pts.length > 2) {
            const p1 = pts[pts.length - 2];
            const p2 = pts[pts.length - 1];
            const mx = ((p1.x + p2.x) / 2) * CANVAS_WIDTH;
            const my = ((p1.y + p2.y) / 2) * CANVAS_HEIGHT;
            ctx.save();
            const drawColor = current.tool === "eraser" ? "#ffffff" : current.color;
            ctx.strokeStyle = drawColor;
            ctx.lineWidth = current.size;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            ctx.moveTo(mx, my);
            ctx.lineTo(p2.x * CANVAS_WIDTH, p2.y * CANVAS_HEIGHT);
            ctx.stroke();
            ctx.restore();
          }
          strokesRef.current.push(current);
          currentStrokeRef.current = null;
        }
      }
    }

    function onCanvasClear() {
      if (!ctx) return;
      strokesRef.current = [];
      currentStrokeRef.current = null;
      drawAllStrokes(ctx, [], CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    function onDrawUndo(data: DrawUndoPayload) {
      if (!ctx) return;
      strokesRef.current = data.strokes ?? [];
      currentStrokeRef.current = null;
      drawAllStrokes(ctx, strokesRef.current, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    function onGameState(data: GameStatePayload) {
      if (!ctx) return;
      if (data.strokes) {
        strokesRef.current = data.strokes;
        currentStrokeRef.current = null;
        drawAllStrokes(ctx, strokesRef.current, CANVAS_WIDTH, CANVAS_HEIGHT);
      }
    }

    function onRoundStart() {
      if (!ctx) return;
      strokesRef.current = [];
      currentStrokeRef.current = null;
      drawAllStrokes(ctx, [], CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    socket.on(SocketEvent.DrawData, onDrawData);
    socket.on(SocketEvent.CanvasClear, onCanvasClear);
    socket.on(SocketEvent.DrawUndo, onDrawUndo);
    socket.on(SocketEvent.GameState, onGameState);
    socket.on(SocketEvent.RoundStart, onRoundStart);

    return () => {
      socket.off(SocketEvent.DrawData, onDrawData);
      socket.off(SocketEvent.CanvasClear, onCanvasClear);
      socket.off(SocketEvent.DrawUndo, onDrawUndo);
      socket.off(SocketEvent.GameState, onGameState);
      socket.off(SocketEvent.RoundStart, onRoundStart);
    };
  }, []);

  function getNormalizedCoords(
    e: MouseEvent | TouchEvent,
    canvas: HTMLCanvasElement
  ): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    let clientX = 0;
    let clientY = 0;

    if ("touches" in e) {
      if (e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if (e.changedTouches.length > 0) {
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
      }
    } else {
      clientX = (e as MouseEvent).clientX;
      clientY = (e as MouseEvent).clientY;
    }

    const rawX = (clientX - rect.left) / rect.width;
    const rawY = (clientY - rect.top) / rect.height;

    const x = Math.max(0, Math.min(1, rawX));
    const y = Math.max(0, Math.min(1, rawY));

    return { x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) };
  }

  function handleStart(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    if (!isDrawer || phase !== GamePhase.DRAWING) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    isDrawingRef.current = true;
    const coords = getNormalizedCoords(e.nativeEvent, canvas);
    socket.emit(SocketEvent.DrawStart, {
      x: coords.x,
      y: coords.y,
      color,
      size,
      tool,
    });
  }

  function handleMove(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current || !isDrawer || phase !== GamePhase.DRAWING) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const coords = getNormalizedCoords(e.nativeEvent, canvas);
    socket.emit(SocketEvent.DrawMove, {
      x: coords.x,
      y: coords.y,
    });
  }

  function handleEnd() {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    socket.emit(SocketEvent.DrawEnd);
  }

  function handleUndo() {
    if (!isDrawer || phase !== GamePhase.DRAWING) return;
    socket.emit(SocketEvent.DrawUndo);
  }

  function handleClear() {
    if (!isDrawer || phase !== GamePhase.DRAWING) return;
    socket.emit(SocketEvent.CanvasClear);
  }

  const canDraw = isDrawer && phase === GamePhase.DRAWING;

  return (
    <div className="canvas-wrapper">
      <div className={`canvas-container ${!canDraw ? "canvas-disabled" : ""}`}>
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="drawing-canvas"
          onMouseDown={handleStart}
          onMouseMove={handleMove}
          onMouseUp={handleEnd}
          onMouseLeave={handleEnd}
          onTouchStart={handleStart}
          onTouchMove={handleMove}
          onTouchEnd={handleEnd}
        />
      </div>

      {isDrawer && (
        <div className="drawing-toolbar">
          <div className="toolbar-section tools-section">
            <button
              type="button"
              className={`tool-btn ${tool === "brush" ? "active" : ""}`}
              onClick={() => setTool("brush")}
              title="Brush tool"
            >
              Brush
            </button>
            <button
              type="button"
              className={`tool-btn ${tool === "eraser" ? "active" : ""}`}
              onClick={() => setTool("eraser")}
              title="Eraser tool"
            >
              Eraser
            </button>
          </div>

          <div className="toolbar-section sizes-section">
            {SIZES.map((s) => (
              <button
                key={s.size}
                type="button"
                className={`size-btn ${size === s.size ? "active" : ""}`}
                onClick={() => setSize(s.size)}
                title={`Size ${s.label}`}
              >
                <span
                  className="size-dot"
                  style={{
                    width: s.dot,
                    height: s.dot,
                    backgroundColor: tool === "eraser" ? "#a3a3a3" : color,
                  }}
                />
              </button>
            ))}
          </div>

          <div className="toolbar-section colors-section">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`color-btn ${color === c && tool === "brush" ? "active" : ""}`}
                style={{ backgroundColor: c }}
                onClick={() => {
                  setColor(c);
                  setTool("brush");
                }}
                title={c}
              />
            ))}
          </div>

          <div className="toolbar-section actions-section">
            <button
              type="button"
              className="btn btn-sm btn-toolbar"
              onClick={handleUndo}
              title="Undo last stroke"
            >
              Undo
            </button>
            <button
              type="button"
              className="btn btn-sm btn-toolbar btn-clear"
              onClick={handleClear}
              title="Clear entire canvas"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
