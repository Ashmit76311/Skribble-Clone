import { useState, useRef, useCallback } from "react";

export interface Toast {
  id: number;
  message: string;
}

let nextToastId = 1;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, { id: number; timer: ReturnType<typeof setTimeout> }>>(new Map());

  const addToast = useCallback((message: string) => {
    const text = message?.trim();
    if (!text) return;

    // Don't show the same message twice within 4 seconds (replace and restart the timer)
    const existing = timersRef.current.get(text);
    if (existing) {
      clearTimeout(existing.timer);
      const timer = setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== existing.id));
        timersRef.current.delete(text);
      }, 4000);
      timersRef.current.set(text, { id: existing.id, timer });
      return;
    }

    const id = nextToastId++;
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timersRef.current.delete(text);
    }, 4000);

    timersRef.current.set(text, { id, timer });

    setToasts((prev) => {
      // Show at most 3 at once
      const trimmedList = prev.length >= 3 ? prev.slice(prev.length - 2) : prev;
      return [...trimmedList, { id, message: text }];
    });
  }, []);

  return { toasts, addToast };
}

export function ToastContainer({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container" aria-live="polite" aria-atomic="true">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.message}
        </div>
      ))}
    </div>
  );
}
