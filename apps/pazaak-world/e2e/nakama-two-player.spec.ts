import { test, expect, type Locator, type Page } from "@playwright/test";

const onboarding = JSON.stringify({
  completed: true,
  boardStyle: "classic",
  notificationChoice: "skip",
  completedAt: new Date().toISOString(),
});

const chitinProof = JSON.stringify({
  filename: "chitin.key",
  size: 1,
  uploadedAt: new Date().toISOString(),
});

function randomHex(len: number): string {
  let out = "";
  while (out.length < len) {
    out += Math.random().toString(16).slice(2);
  }
  return out.slice(0, len);
}

function randomGuestId(): string {
  return `guest-${randomHex(8)}-${randomHex(4)}-${randomHex(4)}-${randomHex(4)}-${randomHex(12)}`;
}

function seedStandaloneMatchHub(
  page: import("@playwright/test").Page,
  guestId: string,
): Promise<void> {
  return page.addInitScript(
    ([onb, chi, gid]: [string, string, string]) => {
      // Wipe stale sessions (e.g. nk1.* tokens) so we always exercise cold guest → Nakama device auth.
      try {
        localStorage.clear();
      } catch {
        /* ignore */
      }
      localStorage.setItem("pazaak-world-onboarding-v1", onb);
      localStorage.setItem("cardworld-chitin-proof-v1", chi);
      localStorage.setItem("pazaak-world-local-guest-id-v1", gid);
      localStorage.removeItem("pazaak-world-standalone-auth-token-v1");
    },
    [onboarding, chitinProof, guestId],
  );
}

async function safePageWait(page: Page, ms: number): Promise<void> {
  if (page.isClosed()) return;
  await page.waitForTimeout(ms).catch(() => undefined);
}

async function matchFinishedVisible(page: Page): Promise<boolean> {
  if (page.isClosed()) return false;
  return page.locator(".game-result").isVisible().catch(() => false);
}

/** Wait out short `busy` / in-flight UI windows so clicks are not no-ops. */
async function waitUntilClickable(page: Page, loc: Locator, maxMs: number): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (page.isClosed()) return false;
    if ((await loc.isVisible().catch(() => false)) && (await loc.isEnabled().catch(() => false))) return true;
    await safePageWait(page, 80);
  }
  return (await loc.isVisible().catch(() => false)) && (await loc.isEnabled().catch(() => false));
}

/** Returns true if an action was taken (draw, side card, end turn, or stand). */
async function tryTakeTurn(page: Page): Promise<boolean> {
  if (await matchFinishedVisible(page)) {
    return false;
  }

  const stand = page.locator('[data-testid="stand-btn"]').or(page.getByRole("button", { name: "Stand" })).first();
  if (await stand.isVisible().catch(() => false) && await waitUntilClickable(page, stand, 4_000)) {
    const raw = await page.locator('[data-testid="score-display"]').last().textContent().catch(() => null);
    const total = Number.parseInt(raw?.trim() ?? "0", 10);
    if (Number.isFinite(total) && total >= 19) {
      const clicked = await stand.click({ timeout: 1_000 }).then(() => true).catch(() => false);
      if (clicked) return true;
    }
  }

  // Side cards (after-draw / after-card): playing at least one option unblocks many stuck lines vs only End Turn.
  const firstSide = page.locator(".side-cards__grid button.btn--card").first();
  if (await firstSide.isVisible().catch(() => false) && await waitUntilClickable(page, firstSide, 4_000)) {
    const clicked = await firstSide.click({ timeout: 1_000 }).then(() => true).catch(() => false);
    if (clicked) {
      await safePageWait(page, 450);
      const endAfterSide = page.getByRole("button", { name: "End Turn" }).first();
      if (await endAfterSide.isVisible().catch(() => false) && await endAfterSide.isEnabled().catch(() => false)) {
        await endAfterSide.click({ timeout: 1_000 }).catch(() => undefined);
      }
      return true;
    }
  }

  const endTurnBtn = page.locator('[data-testid="end-turn-btn"]').or(page.getByRole("button", { name: "End Turn" })).first();
  if (await endTurnBtn.isVisible().catch(() => false) && await waitUntilClickable(page, endTurnBtn, 4_000)) {
    const clicked = await endTurnBtn.click({ timeout: 1_000 }).then(() => true).catch(() => false);
    if (clicked) return true;
  }

  const draw = page.locator('[data-testid="draw-btn"]').or(page.getByRole("button", { name: "Draw" })).first();
  if (await draw.isVisible().catch(() => false) && await draw.isEnabled().catch(() => false)) {
    const clicked = await draw.click({ timeout: 1_000 }).then(() => true).catch(() => false);
    if (!clicked) return false;
    await safePageWait(page, 450);
    if (await endTurnBtn.isVisible().catch(() => false) && await endTurnBtn.isEnabled().catch(() => false)) {
      await endTurnBtn.click({ timeout: 1_000 }).catch(() => undefined);
    }
    return true;
  }

  if (await stand.isVisible().catch(() => false) && await stand.isEnabled().catch(() => false)) {
    const clicked = await stand.click({ timeout: 1_000 }).then(() => true).catch(() => false);
    return clicked;
  }

  return false;
}

async function gotoMatchHubBoth(pageA: Page, pageB: Page): Promise<void> {
  // Fully serial: two simultaneous `authenticateDevice` calls against local Nakama often time out; finish guest A before loading B.
  const hubTimeout = 120_000;
  const gotoHub = async (page: Page): Promise<void> => {
    const deadline = Date.now() + hubTimeout;
    while (Date.now() < deadline) {
      await page.goto("/pazaakworld", { waitUntil: "load" });
      const findMatch = page.getByRole("button", { name: "Find Match" });
      if (await findMatch.isVisible().catch(() => false)) return;

      const authFailed = page.getByRole("heading", { name: "Authentication Failed" });
      if (await authFailed.isVisible().catch(() => false)) {
        const retry = page.getByRole("button", { name: "Try Again" });
        if (await retry.isVisible().catch(() => false)) {
          await retry.click();
          await safePageWait(page, 800);
          if (await findMatch.isVisible().catch(() => false)) return;
        }
      }
      await safePageWait(page, 400);
    }
    await expect(page.getByRole("button", { name: "Find Match" })).toBeVisible({ timeout: 1_000 });
  };

  await gotoHub(pageA);
  await gotoHub(pageB);
}

async function waitForLiveTable(page: Page, timeout = 90_000): Promise<void> {
  await expect(page.getByRole("button", { name: "Forfeit" })).toBeVisible({ timeout });
}

async function eitherPlayerCanAct(pageA: Page, pageB: Page): Promise<boolean> {
  for (const page of [pageA, pageB]) {
    const draw = page.locator('[data-testid="draw-btn"]').or(page.getByRole("button", { name: "Draw" })).first();
    if (await draw.isVisible().catch(() => false) && await draw.isEnabled().catch(() => false)) return true;

    const endTurn = page.getByRole("button", { name: "End Turn" });
    if (await endTurn.isVisible() && await endTurn.isEnabled()) return true;

    const stand = page.locator('[data-testid="stand-btn"]').or(page.getByRole("button", { name: "Stand" })).first();
    if (await stand.isVisible().catch(() => false) && await stand.isEnabled().catch(() => false)) return true;

    const side = page.locator(".side-cards__grid button.btn--card").first();
    if (await side.isVisible().catch(() => false) && await side.isEnabled().catch(() => false)) return true;
  }
  return false;
}

/** Drives both pages until `.game-result` is visible on each — no Forfeit shortcut; stalls throw. */
async function playUntilBothSeeResult(pageA: Page, pageB: Page, maxMs: number): Promise<void> {
  const deadline = Date.now() + maxMs;
  let stagnantCycles = 0;
  let forfeitUiStall = 0;
  while (Date.now() < deadline) {
    if (pageA.isClosed() || pageB.isClosed()) {
      throw new Error("Browser page closed during match play");
    }

    const errAEl = pageA.locator(".error-toast");
    if ((await errAEl.count()) > 0 && await errAEl.first().isVisible()) {
      const msg = (await errAEl.first().textContent())?.trim() ?? "unknown error";
      throw new Error(`Player A action error: ${msg}`);
    }
    const errBEl = pageB.locator(".error-toast");
    if ((await errBEl.count()) > 0 && await errBEl.first().isVisible()) {
      const msg = (await errBEl.first().textContent())?.trim() ?? "unknown error";
      throw new Error(`Player B action error: ${msg}`);
    }

    const doneA = await matchFinishedVisible(pageA);
    const doneB = await matchFinishedVisible(pageB);
    if (doneA && doneB) {
      return;
    }

    const barA = await pageA.locator(".status-bar").textContent().catch(() => "");
    const barB = await pageB.locator(".status-bar").textContent().catch(() => "");
    const forfeitsInLiveStatus = /\bforfeits\b/i.test(barA) || /\bforfeits\b/i.test(barB);
    if (forfeitsInLiveStatus && !(doneA && doneB)) {
      forfeitUiStall += 1;
      if (forfeitUiStall >= 80) {
        throw new Error(
          "Live status shows a forfeit (`… forfeits … takes the table.`) but both `.game-result` panels never appeared — " +
            `likely disconnect-forfeit or client desync (not play-through). A=${JSON.stringify(barA)} B=${JSON.stringify(barB)}`,
        );
      }
    } else {
      forfeitUiStall = 0;
    }

    let acted = false;
    // Alternate who we try first so one tab does not starve when both briefly show stale UI.
    const primaryFirst = Math.floor(Date.now() / 2_000) % 2 === 0;
    const order = primaryFirst ? [pageA, pageB] : [pageB, pageA];
    for (const p of order) {
      if (await tryTakeTurn(p)) {
        acted = true;
        break;
      }
    }

    if (!acted) {
      stagnantCycles += 1;
      if (stagnantCycles >= 120) {
        const [statusA, statusB, drawA, drawB, endA, endB, standA, standB, sideA, sideB] = await Promise.all([
          pageA.locator(".status-bar").textContent().catch(() => null),
          pageB.locator(".status-bar").textContent().catch(() => null),
          pageA.locator('[data-testid="draw-btn"]').isVisible().catch(() => false),
          pageB.locator('[data-testid="draw-btn"]').isVisible().catch(() => false),
          pageA.getByRole("button", { name: "End Turn" }).isVisible().catch(() => false),
          pageB.getByRole("button", { name: "End Turn" }).isVisible().catch(() => false),
          pageA.locator('[data-testid="stand-btn"]').isVisible().catch(() => false),
          pageB.locator('[data-testid="stand-btn"]').isVisible().catch(() => false),
          pageA.locator(".side-cards__grid button.btn--card").first().isVisible().catch(() => false),
          pageB.locator(".side-cards__grid button.btn--card").first().isVisible().catch(() => false),
        ]);
        throw new Error(
          `Match stalled: ` +
          `A(status=${JSON.stringify(statusA)},draw=${drawA},end=${endA},stand=${standA},side=${sideA}) ` +
          `B(status=${JSON.stringify(statusB)},draw=${drawB},end=${endB},stand=${standB},side=${sideB})`,
        );
      }
      await safePageWait(pageA, 150);
      await safePageWait(pageB, 150);
    } else {
      stagnantCycles = 0;
      await safePageWait(pageA, 350);
      await safePageWait(pageB, 350);
    }
  }

  throw new Error(`Match did not complete naturally within ${maxMs}ms (no forfeit shortcut)`);
}

/**
 * Both clients should show the same engine `statusLine` on the completed snapshot.
 * Reject explicit forfeit / disconnect forfeit (`forfeits`) and turn-timer coercion (`timed out`).
 * Require normal match completion copy from the coordinator (`wins the match` / `takes the match`).
 */
function assertMatchEndedByPlaythrough(statusA: string, statusB: string): void {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const a = norm(statusA);
  const b = norm(statusB);
  expect(a.length).toBeGreaterThan(0);
  expect(b.length).toBeGreaterThan(0);
  expect(b).toBe(a);
  const lower = a.toLowerCase();
  expect(lower).not.toMatch(/\bforfeits\b/);
  expect(lower).not.toMatch(/\btimed out\b/);
  expect(lower).toMatch(/wins the match|takes the match/);
}

test.describe("Nakama quick match (two browsers)", () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeAll(async ({ request }) => {
    const port = process.env.VITE_NAKAMA_PORT ?? "7350";
    const host = process.env.VITE_NAKAMA_HOST ?? "127.0.0.1";
    const res = await request.get(`http://${host}:${port}/healthcheck`).catch(() => null);
    if (!res?.ok()) {
      test.skip(true, `Nakama not reachable at http://${host}:${port}/healthcheck — run pnpm dev:pazaak-nakama (or docker compose) and rebuild the runtime (pnpm build:pazaak-nakama).`);
    }
  });

  test("two guests queue and both reach the live table", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    pageA.on("console", (msg) => {
      if (msg.type() === "debug" || msg.type() === "error") console.log(`[pageA:${msg.type()}] ${msg.text()}`);
    });
    pageB.on("console", (msg) => {
      if (msg.type() === "debug" || msg.type() === "error") console.log(`[pageB:${msg.type()}] ${msg.text()}`);
    });
    await seedStandaloneMatchHub(pageA, randomGuestId());
    await seedStandaloneMatchHub(pageB, randomGuestId());

    await gotoMatchHubBoth(pageA, pageB);

    await pageA.getByRole("button", { name: "Find Match" }).click();
    await pageB.getByRole("button", { name: "Find Match" }).click();

    await Promise.all([
      waitForLiveTable(pageA),
      waitForLiveTable(pageB),
    ]);

    await expect.poll(() => eitherPlayerCanAct(pageA, pageB), { timeout: 90_000 }).toBe(true);

    await contextA.close();
    await contextB.close();
  });

  test("two guests play a full match to completion — natural end only, two isolated contexts", async ({ browser }) => {
    test.setTimeout(900_000);

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await seedStandaloneMatchHub(pageA, randomGuestId());
    await seedStandaloneMatchHub(pageB, randomGuestId());

    await gotoMatchHubBoth(pageA, pageB);

    await pageA.getByRole("button", { name: "Find Match" }).click();
    await pageB.getByRole("button", { name: "Find Match" }).click();

    await Promise.all([
      waitForLiveTable(pageA),
      waitForLiveTable(pageB),
    ]);
    await expect.poll(() => eitherPlayerCanAct(pageA, pageB), { timeout: 90_000 }).toBe(true);

    await playUntilBothSeeResult(pageA, pageB, 840_000);

    await expect(pageA.locator(".game-result")).toBeVisible();
    await expect(pageB.locator(".game-result")).toBeVisible();

    const textA = (await pageA.locator(".game-result").innerText()).toLowerCase();
    const textB = (await pageB.locator(".game-result").innerText()).toLowerCase();
    const aOutcome = textA.includes("you won") || textA.includes("you lost") || textA.includes("draw");
    const bOutcome = textB.includes("you won") || textB.includes("you lost") || textB.includes("draw");
    expect(aOutcome && bOutcome).toBe(true);

    const aWon = textA.includes("you won");
    const bWon = textB.includes("you won");
    const aLost = textA.includes("you lost");
    const bLost = textB.includes("you lost");
    expect(aWon !== bWon || (textA.includes("draw") && textB.includes("draw"))).toBe(true);
    if (aWon) {
      expect(bLost).toBe(true);
    }
    if (bWon) {
      expect(aLost).toBe(true);
    }

    const statusA = await pageA.getByTestId("game-result-status").innerText();
    const statusB = await pageB.getByTestId("game-result-status").innerText();
    assertMatchEndedByPlaythrough(statusA, statusB);

    await contextA.close();
    await contextB.close();
  });
});
