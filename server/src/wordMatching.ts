export function normalize(text: string): string {
  if (!text) return "";
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

export function isCorrectGuess(guess: string, word: string): boolean {
  return normalize(guess) === normalize(word);
}

export function isCloseGuess(guess: string, word: string): boolean {
  const normGuess = normalize(guess);
  const normWord = normalize(word);
  if (normGuess === normWord) return false;
  if (normWord.length <= 3) return false;
  return levenshteinDistance(normGuess, normWord) === 1;
}

export function containsSecretWord(text: string, word: string): boolean {
  const normText = normalize(text);
  const normWord = normalize(word);
  if (!normText || !normWord) return false;
  if (normText === normWord) return true;

  // Check if word appears as a standalone word or token
  const regex = new RegExp(`(^|\\b|\\s)${normWord.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}($|\\b|\\s)`, "i");
  return regex.test(normText);
}
