import type { PlayerData } from "@skribbl/shared";

export const BASE_GUESS_POINTS = 100;
export const MAX_TIME_BONUS = 400;
export const FIRST_GUESSER_BONUS = 50;
export const DRAWER_POINTS_PER_GUESS = 75;

export function calculateGuesserPoints(
  remainingMs: number,
  totalMs: number,
  isFirstGuesser: boolean
): number {
  if (totalMs <= 0) return BASE_GUESS_POINTS;
  const ratio = Math.max(0, Math.min(1, remainingMs / totalMs));
  const timeBonus = Math.round(MAX_TIME_BONUS * ratio);
  const firstBonus = isFirstGuesser ? FIRST_GUESSER_BONUS : 0;
  return BASE_GUESS_POINTS + timeBonus + firstBonus;
}

export function calculateDrawerPoints(correctGuesserCount: number): number {
  return correctGuesserCount * DRAWER_POINTS_PER_GUESS;
}

export function determineWinners(players: PlayerData[]): {
  leaderboard: PlayerData[];
  winner: PlayerData;
  winners: PlayerData[];
} {
  const leaderboard = [...players].sort((a, b) => b.score - a.score);
  const topScore = leaderboard[0]?.score ?? 0;
  const winners = leaderboard.filter((p) => p.score === topScore);
  return {
    leaderboard,
    winner: leaderboard[0],
    winners,
  };
}
