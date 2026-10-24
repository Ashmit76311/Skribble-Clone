import { chromium, type Page } from "playwright";
import fs from "fs";
import path from "path";

const BASE_URL = "https://skribble-clone-d061.onrender.com";
const SCREENSHOT_DIR = path.resolve("screenshots");

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutSeconds = 90) {
  const start = Date.now();
  while (Date.now() - start < timeoutSeconds * 1000) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) {
        return true;
      }
    } catch {}
    await sleep(2000);
  }
  return false;
}

async function getDrawnPixelCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return 0;
    const ctx = canvas.getContext("2d");
    if (!ctx) return 0;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonWhitePixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a > 0 && (r < 250 || g < 250 || b < 250)) {
        nonWhitePixels++;
      }
    }
    return nonWhitePixels;
  });
}

async function getStoredToken(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith("session_")) {
        try {
          const parsed = JSON.parse(sessionStorage.getItem(key) || "{}");
          if (parsed.token) return parsed.token;
        } catch {}
      }
    }
    return null;
  });
}

async function run() {
  console.log("Checking deployment health at " + BASE_URL + "/health ...");
  const isHealthy = await waitForHealth(90);
  if (!isHealthy) {
    console.error("FAIL: Service did not respond with 200 within 90 seconds");
    process.exit(1);
  }
  console.log("PASS: Health check responded 200");

  const browser = await chromium.launch({ headless: true });

  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p2Context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p3Context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  const hostPage = await hostContext.newPage();
  const p2Page = await p2Context.newPage();
  const p3Page = await p3Context.newPage();

  const hostWsFrames: string[] = [];
  const p2WsFrames: string[] = [];
  const p3WsFrames: string[] = [];

  hostPage.on("websocket", (ws) => {
    ws.on("framereceived", (f) => {
      if (typeof f.payload === "string") hostWsFrames.push(f.payload);
    });
  });

  p2Page.on("websocket", (ws) => {
    ws.on("framereceived", (f) => {
      if (typeof f.payload === "string") p2WsFrames.push(f.payload);
    });
  });

  p3Page.on("websocket", (ws) => {
    ws.on("framereceived", (f) => {
      if (typeof f.payload === "string") p3WsFrames.push(f.payload);
    });
  });

  try {
    // 1. Home page loads and invalid room shows error
    await hostPage.goto(`${BASE_URL}/room/ZZZZZ`);
    const namePrompt = hostPage.locator('.join-form input[type="text"]');
    if (await namePrompt.isVisible({ timeout: 5000 }).catch(() => false)) {
      await namePrompt.fill("TestUser");
      await hostPage.click('.join-form button:has-text("Join")');
    }
    await hostPage.waitForSelector(".toast", { timeout: 10000 });
    const toastText = await hostPage.textContent(".toast");
    if (toastText && toastText.includes("Room not found")) {
      console.log("PASS: Direct navigation to /room/ZZZZZ shows 'Room not found'");
    } else {
      console.error(`FAIL: Expected 'Room not found' toast, got '${toastText}'`);
      process.exit(1);
    }
    await hostPage.screenshot({ path: path.join(SCREENSHOT_DIR, "01_room_not_found.png") });

    // 2. Host creates room
    await hostPage.goto(BASE_URL);
    await hostPage.waitForSelector('.name-section input');
    await hostPage.fill('.name-section input', "LiveHost");
    await hostPage.fill('label:has-text("Rounds") input', "2");
    await hostPage.fill('label:has-text("Draw Time") input', "30");
    await hostPage.click('.create-form button[type="submit"]');

    await hostPage.waitForURL(/\/room\/[A-Z0-9]+/);
    const roomUrl = hostPage.url();
    const roomCode = roomUrl.split("/room/")[1].toUpperCase();

    // Player 2 joins by code
    await p2Page.goto(BASE_URL);
    await p2Page.waitForSelector('.name-section input');
    await p2Page.fill('.name-section input', "LiveGuesser1");
    await p2Page.fill('input[placeholder="Room code"]', roomCode);
    await p2Page.click('.join-form button[type="submit"]');
    await p2Page.waitForURL(new RegExp(`/room/${roomCode}`));

    // Player 3 joins by direct invite link
    await p3Page.goto(`${BASE_URL}/room/${roomCode}`);
    await p3Page.waitForSelector('.join-form input');
    await p3Page.fill('.join-form input', "LiveGuesser2");
    await p3Page.click('.join-form button[type="submit"]');
    await p3Page.waitForSelector(".lobby");

    // Wait until all 3 players appear in lobby
    await hostPage.waitForFunction(() => document.querySelectorAll(".player-item").length === 3);
    await p2Page.waitForFunction(() => document.querySelectorAll(".player-item").length === 3);
    await p3Page.waitForFunction(() => document.querySelectorAll(".player-item").length === 3);

    console.log(`PASS: Room ${roomCode} created and 3 players joined via code and invite link`);
    await hostPage.screenshot({ path: path.join(SCREENSHOT_DIR, "02_lobby_three_players.png") });

    // Collect secret tokens
    const hostToken = await getStoredToken(hostPage);
    const p2Token = await getStoredToken(p2Page);
    const p3Token = await getStoredToken(p3Page);

    // 3. Host starts game
    await hostPage.waitForSelector('button.btn-start:not([disabled])');
    await hostPage.click('button.btn-start');

    await Promise.all([
      hostPage.waitForSelector(".game-screen", { timeout: 15000 }),
      p2Page.waitForSelector(".game-screen", { timeout: 15000 }),
      p3Page.waitForSelector(".game-screen", { timeout: 15000 }),
    ]);

    // Guard: at start of first turn, drawer's page must show >= 1 word button, guessers show none
    await Promise.race([
      hostPage.waitForSelector(".word-buttons button.btn-word", { timeout: 10000 }),
      p2Page.waitForSelector(".word-buttons button.btn-word", { timeout: 10000 }),
      p3Page.waitForSelector(".word-buttons button.btn-word", { timeout: 10000 }),
    ]);

    const hostWordBtns = await hostPage.locator(".word-buttons button.btn-word").count();
    const p2WordBtns = await p2Page.locator(".word-buttons button.btn-word").count();
    const p3WordBtns = await p3Page.locator(".word-buttons button.btn-word").count();

    const drawerWordBtns = Math.max(hostWordBtns, p2WordBtns, p3WordBtns);
    const guesserWordBtns = [hostWordBtns, p2WordBtns, p3WordBtns].filter((c) => c !== drawerWordBtns);

    if (drawerWordBtns >= 1 && guesserWordBtns.every((c) => c === 0)) {
      console.log(`PASS: Drawer shows ${drawerWordBtns} word buttons at start of first turn, guessers show none`);
    } else {
      console.error(`FAIL: Word buttons guard failed: host=${hostWordBtns}, p2=${p2WordBtns}, p3=${p3WordBtns}`);
      process.exit(1);
    }

    const pages = [hostPage, p2Page, p3Page];

    async function selectWordIfDrawer() {
      for (const p of pages) {
        const btn = p.locator(".word-buttons button.btn-word").first();
        if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
          await btn.click();
          return true;
        }
      }
      return false;
    }

    // Pick word for first turn
    const pickStart = Date.now();
    while (Date.now() - pickStart < 15000) {
      const picked = await selectWordIfDrawer();
      if (picked) break;
      await sleep(300);
    }

    // Wait until drawing phase begins and drawer word appears
    await Promise.race([
      hostPage.waitForSelector(".drawer-word", { timeout: 15000 }),
      p2Page.waitForSelector(".drawer-word", { timeout: 15000 }),
      p3Page.waitForSelector(".drawer-word", { timeout: 15000 }),
    ]);

    // Identify drawer and guesser pages
    let drawerPage = hostPage;
    let guesser1Page = p2Page;
    let guesser2Page = p3Page;

    if (await hostPage.locator(".drawer-word").isVisible().catch(() => false)) {
      drawerPage = hostPage;
      guesser1Page = p2Page;
      guesser2Page = p3Page;
    } else if (await p2Page.locator(".drawer-word").isVisible().catch(() => false)) {
      drawerPage = p2Page;
      guesser1Page = hostPage;
      guesser2Page = p3Page;
    } else {
      drawerPage = p3Page;
      guesser1Page = hostPage;
      guesser2Page = p2Page;
    }

    const secretWord = (await drawerPage.locator(".drawer-word strong").textContent())?.trim() || "";
    if (!secretWord) {
      console.error("FAIL: Could not read secret word from drawer");
      process.exit(1);
    }

    // 4. Drawer draws strokes on canvas
    const canvas = drawerPage.locator(".canvas-container canvas");
    await canvas.waitFor({ state: "visible" });
    const box = await canvas.boundingBox();
    if (!box) {
      console.error("FAIL: Canvas bounding box not found");
      process.exit(1);
    }

    const initialPixelsGuesser = await getDrawnPixelCount(guesser1Page);

    await drawerPage.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
    await drawerPage.mouse.down();
    await drawerPage.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5, { steps: 15 });
    await drawerPage.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.8, { steps: 15 });
    await drawerPage.mouse.up();
    await sleep(600);

    const updatedPixelsGuesser = await getDrawnPixelCount(guesser1Page);
    if (updatedPixelsGuesser > initialPixelsGuesser) {
      console.log(`PASS: Real-time drawing rendered on guesser canvas (${updatedPixelsGuesser} drawn pixels)`);
    } else {
      console.error(`FAIL: Canvas pixels did not update on guesser (before: ${initialPixelsGuesser}, after: ${updatedPixelsGuesser})`);
      process.exit(1);
    }

    await drawerPage.screenshot({ path: path.join(SCREENSHOT_DIR, "03_drawer_drawing.png") });
    await guesser1Page.screenshot({ path: path.join(SCREENSHOT_DIR, "04_guesser_canvas_synced.png") });

    // 5. Wrong guess followed by correct guess
    // Check that guesser1 frames received so far DO NOT contain secretWord
    const guesser1Frames = guesser1Page === p2Page ? p2WsFrames : guesser1Page === p3Page ? p3WsFrames : hostWsFrames;
    const leakedBeforeGuess = guesser1Frames.some((f) => {
      return f.includes(`"${secretWord}"`) || (secretWord.length > 3 && f.toLowerCase().includes(secretWord.toLowerCase()));
    });

    if (leakedBeforeGuess) {
      console.error("FAIL: Secret word was present in WebSocket frame before guess!");
      process.exit(1);
    } else {
      console.log("PASS: Secret word was NOT leaked in any WebSocket frame to guesser before guessing");
    }

    // Send wrong guess
    const chatInput = guesser1Page.locator("input.chat-input");
    await chatInput.fill("wrongguess123");
    await chatInput.press("Enter");
    await guesser1Page.waitForSelector('.chat-msg:has-text("wrongguess123")');
    console.log("PASS: Wrong guess appeared in chat");

    // Send correct guess
    await chatInput.fill(secretWord);
    await chatInput.press("Enter");
    await guesser1Page.waitForSelector('.chat-msg-correct:has-text("guessed the word")');
    await guesser1Page.waitForSelector(".tag-guessed");

    const guesser1ScoreText = await guesser1Page.locator(".sidebar-player:has(.you-badge) .player-score").textContent();
    const scoreVal = parseInt(guesser1ScoreText?.replace(/\D/g, "") || "0", 10);
    if (scoreVal > 0) {
      console.log(`PASS: Guesser score updated correctly (${scoreVal} pts) and 'guessed the word' is shown`);
    } else {
      console.error(`FAIL: Guesser score did not update, text: ${guesser1ScoreText}`);
      process.exit(1);
    }
    await guesser1Page.screenshot({ path: path.join(SCREENSHOT_DIR, "05_guesser_correct_score.png") });

    // 6. Refresh guesser mid-turn
    await guesser1Page.reload();
    await guesser1Page.waitForSelector(".game-screen", { timeout: 15000 });
    const reconnectedScoreText = await guesser1Page.locator(".sidebar-player:has(.you-badge) .player-score").textContent();
    const reconnectedScore = parseInt(reconnectedScoreText?.replace(/\D/g, "") || "0", 10);
    const reconnectedPixels = await getDrawnPixelCount(guesser1Page);

    if (reconnectedScore === scoreVal && reconnectedPixels > 0) {
      console.log("PASS: Guesser mid-turn refresh restored score, canvas, and game screen with no error");
    } else {
      console.error(`FAIL: Refreshed guesser state mismatch: score=${reconnectedScore} (expected ${scoreVal}), pixels=${reconnectedPixels}`);
      process.exit(1);
    }
    await guesser1Page.screenshot({ path: path.join(SCREENSHOT_DIR, "06_guesser_refreshed.png") });

    // Guesser 2 guesses to finish turn quickly
    const g2Input = guesser2Page.locator("input.chat-input");
    if ((await g2Input.count()) > 0) {
      await g2Input.fill(secretWord);
      await g2Input.press("Enter");
      await sleep(500);
    }

    // 7. Progress remaining turns to GAME_OVER
    console.log("Advancing remaining turns until GAME_OVER...");
    const gameStartWait = Date.now();
    let gameOverReached = false;

    while (Date.now() - gameStartWait < 240_000) {
      // Check if game over reached on any page
      for (const p of pages) {
        if ((await p.locator(".game-overlay:has-text('Game Over')").count()) > 0) {
          gameOverReached = true;
          break;
        }
      }
      if (gameOverReached) break;

      // Select word if any drawer has options
      for (const p of pages) {
        const btn = p.locator(".word-buttons button.btn-word").first();
        if ((await btn.count()) > 0) {
          await btn.click().catch(() => {});
          await sleep(200);
          break;
        }
      }

      // Find current drawer word if in drawing phase
      let activeWord = "";
      for (const d of pages) {
        const wordEl = d.locator(".drawer-word strong");
        if ((await wordEl.count()) > 0) {
          activeWord = (await wordEl.textContent())?.trim() || "";
          if (activeWord) break;
        }
      }

      // If active word is present, guessers submit guess
      if (activeWord) {
        for (const p of pages) {
          const isDrawer = (await p.locator(".drawer-word").count()) > 0;
          const hasGuessed = (await p.locator(".guessed-notice").count()) > 0;
          const chatInput = p.locator("input.chat-input");

          if (!isDrawer && !hasGuessed && ((await chatInput.count()) > 0)) {
            await chatInput.fill(activeWord);
            await chatInput.press("Enter");
            await sleep(300);
          }
        }
      }

      await sleep(500);
    }

    await hostPage.waitForSelector(".game-overlay:has-text('Game Over')", { timeout: 30000 });
    const winnerName = await hostPage.locator(".winner-name").textContent();
    const leaderboardItems = await hostPage.locator(".leaderboard-item").count();

    if (winnerName && leaderboardItems >= 2) {
      console.log(`PASS: Game over screen displayed with winner (${winnerName.trim()}) and leaderboard (${leaderboardItems} players)`);
    } else {
      console.error("FAIL: Game over screen missing winner or leaderboard");
      process.exit(1);
    }
    await hostPage.screenshot({ path: path.join(SCREENSHOT_DIR, "07_game_over_leaderboard.png") });

    // 8. Check [DEBUG] text is not anywhere in the DOM
    for (const p of pages) {
      const debugCount = await p.locator('text="[DEBUG]"').count();
      if (debugCount > 0) {
        console.error("FAIL: '[DEBUG]' text found in production DOM!");
        process.exit(1);
      }
    }
    console.log("PASS: '[DEBUG]' text does not appear anywhere in production DOM");

    // 8. Check secret tokens never leaked to other players
    if (!hostToken || !p2Token || !p3Token) {
      console.error(`FAIL: Could not retrieve tokens from sessionStorage (host: ${!!hostToken}, p2: ${!!p2Token}, p3: ${!!p3Token})`);
      process.exit(1);
    }

    const p2Leaked = p2WsFrames.some((f) => f.includes(hostToken) || f.includes(p3Token));
    const p3Leaked = p3WsFrames.some((f) => f.includes(hostToken) || f.includes(p2Token));
    const hostLeaked = hostWsFrames.some((f) => f.includes(p2Token) || f.includes(p3Token));

    if (p2Leaked || p3Leaked || hostLeaked) {
      console.error("FAIL: Secret tokens were leaked in WebSocket frames received by other players!");
      process.exit(1);
    } else {
      console.log("PASS: Secret tokens never appeared in frames received by other players");
    }

    console.log("\nALL LIVE E2E CHECKS PASSED SUCCESSFULLY!");
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("Live test failed with error:", err);
  process.exit(1);
});
