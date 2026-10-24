import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { WordMode } from "@skribbl/shared";
import {
  normalize,
  isCorrectGuess,
  isCloseGuess,
  containsSecretWord,
} from "../src/wordMatching.js";
import {
  calculateGuesserPoints,
  calculateDrawerPoints,
  determineWinners,
} from "../src/scoring.js";
import { HintManager } from "../src/hints.js";

describe("Word Matching", () => {
  test("normalize trims, lowercases, and collapses spaces", () => {
    assert.equal(normalize("   CaT   "), "cat");
    assert.equal(normalize("  cAt   PiZZa   "), "cat pizza");
  });

  test("isCorrectGuess matches case and spacing insensitively", () => {
    assert.equal(isCorrectGuess("  cAt  ", "cat"), true);
    assert.equal(isCorrectGuess("CAT PIZZA", "cat pizza"), true);
    assert.equal(isCorrectGuess("dog", "cat"), false);
  });

  test("isCloseGuess identifies edit distance of 1 for words > 3 letters", () => {
    assert.equal(isCloseGuess("aple", "apple"), true);
    assert.equal(isCloseGuess("applee", "apple"), true);
    assert.equal(isCloseGuess("appla", "apple"), true);
    // Not close if distance > 1
    assert.equal(isCloseGuess("ape", "apple"), false);
    // Not close if exact match
    assert.equal(isCloseGuess("apple", "apple"), false);
    // Length <= 3 cannot trigger close
    assert.equal(isCloseGuess("ca", "cat"), false);
    assert.equal(isCloseGuess("bat", "cat"), false);
  });

  test("containsSecretWord detects leaks without false positives", () => {
    assert.equal(containsSecretWord("i think it is apple", "apple"), true);
    assert.equal(containsSecretWord("apple!", "apple"), true);
    assert.equal(containsSecretWord("pineapple", "apple"), false);
  });
});

describe("Scoring", () => {
  test("calculateGuesserPoints scales with time and first guesser bonus", () => {
    const fullTimeFirst = calculateGuesserPoints(60000, 60000, true);
    assert.equal(fullTimeFirst, 100 + 400 + 50); // 550

    const fullTimeSecond = calculateGuesserPoints(60000, 60000, false);
    assert.equal(fullTimeSecond, 100 + 400); // 500

    const halfTimeSecond = calculateGuesserPoints(30000, 60000, false);
    assert.equal(halfTimeSecond, 100 + 200); // 300

    const zeroTime = calculateGuesserPoints(0, 60000, false);
    assert.equal(zeroTime, 100);
  });

  test("calculateDrawerPoints scales per correct guesser", () => {
    assert.equal(calculateDrawerPoints(0), 0);
    assert.equal(calculateDrawerPoints(3), 225);
  });

  test("determineWinners correctly handles single winner and ties", () => {
    const p1 = { id: "1", name: "Alice", score: 500, isHost: true, isDrawing: false, hasGuessed: false, isConnected: true };
    const p2 = { id: "2", name: "Bob", score: 500, isHost: false, isDrawing: false, hasGuessed: false, isConnected: true };
    const p3 = { id: "3", name: "Charlie", score: 300, isHost: false, isDrawing: false, hasGuessed: false, isConnected: true };

    const result = determineWinners([p1, p2, p3]);
    assert.equal(result.leaderboard.length, 3);
    assert.equal(result.winners.length, 2);
    assert.deepEqual(result.winners.map(w => w.name), ["Alice", "Bob"]);
  });
});

describe("Hints and Word Modes", () => {
  test("Normal mode reveals up to 50% max letters with spaces preserved", () => {
    const hm = new HintManager("banana", 5, WordMode.Normal);
    // "banana" has 6 letters -> max hints is floor(6/2) = 3
    assert.equal(hm.totalHints, 3);
    assert.equal(hm.getMaskedHint(), "_ _ _ _ _ _");
    assert.equal(hm.getWordLengthForDisplay(), 6);

    assert.equal(hm.revealNext(), true);
    assert.equal(hm.revealNext(), true);
    assert.equal(hm.revealNext(), true);
    // Cannot reveal more than 3
    assert.equal(hm.revealNext(), false);
    assert.equal(hm.totalHints, 3);
  });

  test("Combination mode preserves phrase spacing", () => {
    const hm = new HintManager("cat dog", 2, WordMode.Combination);
    assert.equal(hm.getMaskedHint(), "_ _ _   _ _ _");
    assert.equal(hm.getWordLengthForDisplay(), 6);
  });

  test("Hidden mode returns '?' and disables hints/length", () => {
    const hm = new HintManager("elephant", 3, WordMode.Hidden);
    assert.equal(hm.totalHints, 0);
    assert.equal(hm.getMaskedHint(), "?");
    assert.equal(hm.getWordLengthForDisplay(), null);
    assert.equal(hm.revealNext(), false);
  });
});
