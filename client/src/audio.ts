let audioCtx: AudioContext | null = null;

const MUTE_STORAGE_KEY = "skribbl_muted";

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_STORAGE_KEY, muted ? "true" : "false");
  } catch {}
}

export function toggleMuted(): boolean {
  const next = !isMuted();
  setMuted(next);
  return next;
}

let lastPlayTime = 0;

export function playCorrectSound(): void {
  if (isMuted()) return;
  const nowMs = Date.now();
  if (nowMs - lastPlayTime < 150) return;
  lastPlayTime = nowMs;

  try {
    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    if (!audioCtx) {
      audioCtx = new AudioContextClass();
    }

    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }

    const now = audioCtx.currentTime;

    // Pleasant two-note chime (E5 -> A5)
    const notes = [
      { freq: 659.25, start: 0, duration: 0.12 },
      { freq: 880.0, start: 0.08, duration: 0.22 },
    ];

    notes.forEach(({ freq, start, duration }) => {
      if (!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + start);

      gain.gain.setValueAtTime(0.001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.18, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start(now + start);
      osc.stop(now + start + duration);
    });
  } catch {
    // Graceful fallback if Web Audio is unsupported or restricted
  }
}
