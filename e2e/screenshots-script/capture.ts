import { chromium, type Page, type BrowserContext, devices } from "playwright";
import fs from "fs";
import path from "path";

import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.BASE_URL || "https://skribble-clone-d061.onrender.com";
const OUT_DIR = path.resolve(__dirname, "../ui-shots");

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutSeconds = 60) {
  const start = Date.now();
  while (Date.now() - start < timeoutSeconds * 1000) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return true;
    } catch {}
    await sleep(2000);
  }
  return false;
}

async function drawStrokes(page: Page) {
  const canvas = page.locator(".canvas-container canvas");
  await canvas.waitFor({ state: "visible", timeout: 10000 });
  const box = await canvas.boundingBox();
  if (!box) return;

  // Stroke 1: Black horizontal wave
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.35, { steps: 8 });
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.45, { steps: 8 });
  await page.mouse.up();
  await sleep(200);

  // Pick red color if available
  const redBtn = page.locator('button.color-btn[style*="rgb(239, 68, 68)"], button.color-btn[style*="#ef4444"], button.color-btn:nth-child(2)');
  if (await redBtn.isVisible().catch(() => false)) {
    await redBtn.click().catch(() => {});
    await sleep(150);
  }

  // Stroke 2: Red curve
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.7, { steps: 8 });
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.6, { steps: 8 });
  await page.mouse.up();
  await sleep(200);

  // Pick blue color if available
  const blueBtn = page.locator('button.color-btn[style*="rgb(59, 130, 246)"], button.color-btn[style*="#3b82f6"], button.color-btn:nth-child(3)');
  if (await blueBtn.isVisible().catch(() => false)) {
    await blueBtn.click().catch(() => {});
    await sleep(150);
  }

  // Stroke 3: Blue loop
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.3, { steps: 6 });
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.35, { steps: 6 });
  await page.mouse.up();
  await sleep(300);
}

async function runSession(
  browser: any,
  vpKey: "desktop" | "phone",
  contextOptions: any
) {
  console.log(`\n========================================`);
  console.log(`Starting capture session: ${vpKey.toUpperCase()}`);
  console.log(`========================================`);

  // Helper to create page with context options
  const createContext = async () => browser.newContext(contextOptions);

  // 1. HOME SCREEN (empty)
  const homeCtx = await createContext();
  const homePage: Page = await homeCtx.newPage();
  await homePage.goto(BASE_URL);
  await homePage.evaluate(() => localStorage.clear());
  await homePage.reload();
  await homePage.waitForSelector(".title");
  await sleep(600);

  const shotHomeEmpty = path.join(OUT_DIR, `1-home-empty-${vpKey}.png`);
  await homePage.screenshot({ path: shotHomeEmpty, fullPage: false });
  console.log(`Captured: 1-home-empty-${vpKey}.png`);

  // 1b. HOME SCREEN (typed name & public room listed)
  // Let's create an auxiliary room first so a public room exists in the list!
  const auxCtx = await createContext();
  const auxPage: Page = await auxCtx.newPage();
  await auxPage.goto(BASE_URL);
  await auxPage.waitForSelector(".name-section input");
  await auxPage.fill(".name-section input", "RoomHost");
  await auxPage.click('.create-form button[type="submit"]');
  await auxPage.waitForSelector(".lobby", { timeout: 15000 });

  // Now reload homePage and type name
  await homePage.reload();
  await homePage.waitForSelector(".name-section input");
  await homePage.fill(".name-section input", "LunaArtist");
  // Wait up to 5s for public rooms fetch
  await sleep(4500);

  const shotHomeTyped = path.join(OUT_DIR, `1-home-typed-public-${vpKey}.png`);
  await homePage.screenshot({ path: shotHomeTyped, fullPage: false });
  console.log(`Captured: 1-home-typed-public-${vpKey}.png`);

  // Close aux room
  await auxPage.click('button:has-text("Leave")').catch(() => {});
  await auxCtx.close();
  await homeCtx.close();

  // 2. SETUP 3 PLAYERS IN A FRESH ROOM
  const hostCtx = await createContext();
  const p2Ctx = await createContext();
  const p3Ctx = await createContext();

  const hostPage: Page = await hostCtx.newPage();
  const p2Page: Page = await p2Ctx.newPage();
  const p3Page: Page = await p3Ctx.newPage();

  // Host creates room
  await hostPage.goto(BASE_URL);
  await hostPage.waitForSelector(".name-section input");
  await hostPage.fill(".name-section input", "HostZara");
  // Set draw time to 45s and rounds to 2
  await hostPage.fill('label:has-text("Rounds") input', "2");
  await hostPage.fill('label:has-text("Draw Time") input', "45");
  await hostPage.click('.create-form button[type="submit"]');
  await hostPage.waitForSelector(".lobby", { timeout: 15000 });

  const roomUrl = hostPage.url();
  const roomCode = roomUrl.split("/room/")[1].toUpperCase();
  console.log(`Room created: ${roomCode}`);

  // Player 2 joins via code
  await p2Page.goto(BASE_URL);
  await p2Page.waitForSelector(".name-section input");
  await p2Page.fill(".name-section input", "LeoSketch");
  await p2Page.fill('input[placeholder="Room code"]', roomCode);
  await p2Page.click('.join-form button[type="submit"]');
  await p2Page.waitForSelector(".lobby", { timeout: 15000 });

  // Player 3 joins via direct invite link
  await p3Page.goto(`${BASE_URL}/room/${roomCode}`);
  const p3NameInput = p3Page.locator('.join-form input[type="text"]');
  if (await p3NameInput.isVisible({ timeout: 4000 }).catch(() => false)) {
    await p3NameInput.fill("MayaGuesser");
    await p3Page.click('.join-form button[type="submit"]');
  }
  await p3Page.waitForSelector(".lobby", { timeout: 15000 });

  // Wait for all 3 players in lobby
  await hostPage.waitForFunction(() => document.querySelectorAll(".player-item").length === 3);
  await p2Page.waitForFunction(() => document.querySelectorAll(".player-item").length === 3);
  await p3Page.waitForFunction(() => document.querySelectorAll(".player-item").length === 3);

  // Player 2 clicks Ready, Player 3 stays Not Ready
  await p2Page.click("button.btn-ready");
  await hostPage.waitForSelector(".player-item:has-text('LeoSketch') .ready-badge");
  await sleep(500);

  // 2. LOBBY AS HOST (3 players, one ready, one not ready, kick buttons visible)
  const shotLobbyHost = path.join(OUT_DIR, `2-lobby-host-${vpKey}.png`);
  await hostPage.screenshot({ path: shotLobbyHost, fullPage: false });
  console.log(`Captured: 2-lobby-host-${vpKey}.png`);

  // 3. LOBBY AS NON-HOST (Player 3 who is not ready, or Player 2 who is ready)
  const shotLobbyPlayer = path.join(OUT_DIR, `3-lobby-player-${vpKey}.png`);
  await p3Page.screenshot({ path: shotLobbyPlayer, fullPage: false });
  console.log(`Captured: 3-lobby-player-${vpKey}.png`);

  // Player 3 clicks Ready so host can start
  await p3Page.click("button.btn-ready");
  await hostPage.waitForSelector('button.btn-start:not([disabled])', { timeout: 10000 });
  await sleep(300);

  // Host starts game
  await hostPage.click("button.btn-start");

  // Wait for GameScreen on all pages
  const allPages = [hostPage, p2Page, p3Page];
  await Promise.all(allPages.map((p) => p.waitForSelector(".game-screen", { timeout: 15000 })));

  // Identify the drawer
  await Promise.race(allPages.map((p) => p.waitForSelector(".word-buttons button.btn-word", { timeout: 15000 })));

  let drawerPage = hostPage;
  let guesser1Page = p2Page;
  let guesser2Page = p3Page;

  for (const p of allPages) {
    if ((await p.locator(".word-buttons button.btn-word").count()) > 0) {
      drawerPage = p;
      break;
    }
  }
  const guessers = allPages.filter((p) => p !== drawerPage);
  guesser1Page = guessers[0];
  guesser2Page = guessers[1];

  // 4. WORD SELECT AS DRAWER
  await sleep(400);
  const shotWordSelect = path.join(OUT_DIR, `4-word-select-drawer-${vpKey}.png`);
  await drawerPage.screenshot({ path: shotWordSelect, fullPage: false });
  console.log(`Captured: 4-word-select-drawer-${vpKey}.png`);

  // Drawer chooses a word
  const wordBtn = drawerPage.locator(".word-buttons button.btn-word").first();
  await wordBtn.click();

  // Wait for drawing phase
  await drawerPage.waitForSelector(".drawer-word", { timeout: 10000 });
  const secretWord = (await drawerPage.locator(".drawer-word strong").textContent())?.trim() || "";
  console.log(`Word chosen: "${secretWord}"`);

  // 5. DRAWING AS DRAWER (draw strokes)
  await drawStrokes(drawerPage);
  await sleep(500);

  const shotDrawingDrawer = path.join(OUT_DIR, `5-drawing-drawer-${vpKey}.png`);
  await drawerPage.screenshot({ path: shotDrawingDrawer, fullPage: false });
  console.log(`Captured: 5-drawing-drawer-${vpKey}.png`);

  // 6. DRAWING AS GUESSER (send wrong guesses)
  const g1Input = guesser1Page.locator("input.chat-input");
  await g1Input.fill("sunflower");
  await g1Input.press("Enter");
  await sleep(400);

  const g2Input = guesser2Page.locator("input.chat-input");
  await g2Input.fill("mountain");
  await g2Input.press("Enter");
  await sleep(400);

  await guesser1Page.waitForSelector('.chat-msg:has-text("sunflower")');
  await sleep(500);

  const shotDrawingGuesser = path.join(OUT_DIR, `6-drawing-guesser-${vpKey}.png`);
  await guesser1Page.screenshot({ path: shotDrawingGuesser, fullPage: false });
  console.log(`Captured: 6-drawing-guesser-${vpKey}.png`);

  // 7. IMMEDIATELY AFTER A CORRECT GUESS
  // Guesser 1 enters secret word
  await g1Input.fill(secretWord);
  await g1Input.press("Enter");

  // Wait for correct feedback and take shot immediately during flash
  await guesser1Page.waitForSelector(".chat-msg-correct", { timeout: 5000 });
  await sleep(150); // within the 800ms flash duration

  const shotCorrectGuess = path.join(OUT_DIR, `7-correct-guess-${vpKey}.png`);
  await guesser1Page.screenshot({ path: shotCorrectGuess, fullPage: false });
  console.log(`Captured: 7-correct-guess-${vpKey}.png`);

  // 8. ROUND END OVERLAY
  // Guesser 2 also guesses or we wait for turn to end
  await g2Input.fill(secretWord);
  await g2Input.press("Enter");

  // Wait for Round End overlay
  await Promise.race(allPages.map((p) => p.waitForSelector(".overlay-card:has-text('Round finished')", { timeout: 15000 })));
  await sleep(800); // let count-up and layout settle

  const shotRoundEnd = path.join(OUT_DIR, `8-round-end-${vpKey}.png`);
  await drawerPage.screenshot({ path: shotRoundEnd, fullPage: false });
  console.log(`Captured: 8-round-end-${vpKey}.png`);

  // 9. GAME OVER OVERLAY WITH PODIUM
  console.log("Advancing to Game Over...");
  const gameOverStart = Date.now();
  let gameOver = false;

  while (Date.now() - gameOverStart < 180000) {
    for (const p of allPages) {
      if ((await p.locator(".game-overlay:has-text('Game Over')").count()) > 0) {
        gameOver = true;
        break;
      }
    }
    if (gameOver) break;

    // Pick word if any drawer has options
    for (const p of allPages) {
      const btn = p.locator(".word-buttons button.btn-word").first();
      if ((await btn.count()) > 0) {
        await btn.click().catch(() => {});
        await sleep(200);
        break;
      }
    }

    // Guess if active drawer word exists
    let currWord = "";
    for (const p of allPages) {
      const wEl = p.locator(".drawer-word strong");
      if ((await wEl.count()) > 0) {
        currWord = (await wEl.textContent())?.trim() || "";
        if (currWord) break;
      }
    }

    if (currWord) {
      for (const p of allPages) {
        const isD = (await p.locator(".drawer-word").count()) > 0;
        const hasG = (await p.locator(".guessed-notice").count()) > 0;
        const inp = p.locator("input.chat-input");
        if (!isD && !hasG && ((await inp.count()) > 0)) {
          await inp.fill(currWord);
          await inp.press("Enter");
          await sleep(250);
        }
      }
    }

    await sleep(400);
  }

  await hostPage.waitForSelector(".game-overlay:has-text('Game Over')", { timeout: 15000 });
  await sleep(1000); // wait for confetti and podium animation to settle

  const shotGameOver = path.join(OUT_DIR, `9-game-over-${vpKey}.png`);
  await hostPage.screenshot({ path: shotGameOver, fullPage: false });
  console.log(`Captured: 9-game-over-${vpKey}.png`);

  // Cleanup contexts
  await hostCtx.close();
  await p2Ctx.close();
  await p3Ctx.close();
}

async function main() {
  console.log(`Checking deployment health at ${BASE_URL}...`);
  const healthy = await waitForHealth();
  if (!healthy) {
    console.error("Target URL not healthy:", BASE_URL);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });

  try {
    // 1. Desktop 1280x800
    await runSession(browser, "desktop", {
      viewport: { width: 1280, height: 800 },
    });

    // 2. Phone portrait 390x844 with touch
    await runSession(browser, "phone", {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });

    console.log("\n========================================");
    console.log("ALL SCREENSHOTS CAPTURED SUCCESSFULLY!");
    console.log(`Directory: ${OUT_DIR}`);
    console.log("========================================");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});
