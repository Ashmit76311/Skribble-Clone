import { WordMode } from "@skribbl/shared";

export class HintManager {
  private word: string;
  private mode: WordMode;
  private maxHints: number;
  private revealedIndices = new Set<number>();
  private unrevealedIndices: number[] = [];

  constructor(word: string, hintCount: number, mode: WordMode) {
    this.word = word;
    this.mode = mode;

    if (this.mode === WordMode.Hidden) {
      this.maxHints = 0;
      return;
    }

    const letterIndices: number[] = [];
    for (let i = 0; i < word.length; i++) {
      if (word[i] !== " " && word[i] !== "-") letterIndices.push(i);
    }

    // Never reveal more than half of the letters
    const cap = Math.floor(letterIndices.length / 2);
    this.maxHints = Math.min(Math.max(0, hintCount), cap);
    this.unrevealedIndices = [...letterIndices];
  }

  get totalHints() {
    return this.maxHints;
  }

  revealNext(): boolean {
    if (this.mode === WordMode.Hidden) return false;
    if (this.revealedIndices.size >= this.maxHints) return false;
    if (this.unrevealedIndices.length === 0) return false;

    const randIdx = Math.floor(Math.random() * this.unrevealedIndices.length);
    const charIndex = this.unrevealedIndices.splice(randIdx, 1)[0];
    this.revealedIndices.add(charIndex);
    return true;
  }

  getMaskedHint(): string {
    if (this.mode === WordMode.Hidden) {
      return "?";
    }

    const parts: string[] = [];
    for (let i = 0; i < this.word.length; i++) {
      const char = this.word[i];
      if (char === " ") {
        parts.push(" ");
      } else if (char === "-") {
        parts.push("-");
      } else if (this.revealedIndices.has(i)) {
        parts.push(char);
      } else {
        parts.push("_");
      }
    }

    return parts.join(" ");
  }

  getWordLengthForDisplay(): number | null {
    if (this.mode === WordMode.Hidden) {
      return null;
    }
    // Number of letters excluding spaces and hyphens
    return this.word.replace(/[\s-]+/g, "").length;
  }
}
