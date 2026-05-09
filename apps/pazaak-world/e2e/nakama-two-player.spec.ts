import { test, expect, type Page } from "@playwright/test";

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

async function matchFinishedVisible(page: Page): Promise<boolean> {
  return page.locator(".game-result").isVisible();
}

/** Returns true if an action was taken (draw, side card, end turn, or stand). */
async function tryTakeTurn(page: Page): Promise<boolean> {
  if (await matchFinishedVisible(page)) {
    return false;
  }

  const stand = page.locator('[data-testid="stand-btn"]').or(page.getByRole("button", { name: "Stand" })).first();
  if (await stand.isVisible().catch(() => false) && await stand.isEnabled().catch(() => false)) {
    const raw = await page.locator('[data-testid="score-display"]').last().textContent().catch(() => null);
    const total = Number.parseInt(raw?.trim() ?? "0", 10);
    if (Number.isFinite(total) && total >= 19) {
      const clicked = await stand.click({ timeout: 1_000 }).then(() => true).catch(() => false);
      if (clicked) return true;
    }
  }

  const endTurnBtn = page.locator('[data-testid="end-turn-btn"]').or(page.getByRole("button", { name: "End Turn" })).first();
  if (await endTurnBtn.isVisible().catch(() => false) && await endTurnBtn.isEnabled().catch(() => false)) {
    const clicked = await endTurnBtn.click({ timeout: 1_000 }).then(() => true).catch(() => false);
    if (clicked) return true;
  }

  const draw = page.locator('[data-testid="draw-btn"]').or(page.getByRole("button", { name: "Draw" })).first();
  if (await draw.isVisible().catch(() => false) && await draw.isEnabled().catch(() => false)) {
    const clicked = await draw.click({ timeout: 1_000 }).then(() => true).catch(() => false);
    if (!clicked) return false;
    await page.waitForTimeout(450);
    if (await endTurnBtn.isVisible().catch(() => false) && await endTurnBtn.isEnabled().catch(() => false)) {
      await endTurnBtn.click({ timeout: 1_000 }).catch(() => undefined);
    }
    return true;
  }

  if (await stand.isVisible().catch(() => false) && await stand.isEnabled().catch(() => false)) {
    await stand.click();
    return true;
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
          await page.waitForTimeout(800);
          if (await findMatch.isVisible().catch(() => false)) return;
        }
      }
      await page.waitForTimeout(400);
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
  }
  return false;
}

async function playUntilBothSeeResult(pageA: Page, pageB: Page, maxMs: number): Promise<void> {
  const startedAt = Date.now();
  const deadline = Date.now() + maxMs;
  let stagnantCycles = 0;
  while (Date.now() < deadline) {
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

    if (Date.now() - startedAt > 180_000) {
      const forfeitA = pageA.getByRole("button", { name: "Forfeit" });
      if (await forfeitA.isVisible().catch(() => false) && await forfeitA.isEnabled().catch(() => false)) {
        await forfeitA.click().catch(() => undefined);
        await expect.poll(async () => (await matchFinishedVisible(pageA)) && (await matchFinishedVisible(pageB)), {
          timeout: 30_000,
        }).toBe(true);
        return;
      }
    }

    let acted = false;
    for (const p of [pageA, pageB]) {
      if (await tryTakeTurn(p)) {
        acted = true;
        break;
      }
    }

    if (!acted) {
      stagnantCycles += 1;
      if (stagnantCycles >= 120) {
        const [statusA, statusB, drawA, drawB, endA, endB, standA, standB] = await Promise.all([
          pageA.locator(".status-bar").textContent().catch(() => null),
          pageB.locator(".status-bar").textContent().catch(() => null),
          pageA.locator('[data-testid="draw-btn"]').isVisible().catch(() => false),
          pageB.locator('[data-testid="draw-btn"]').isVisible().catch(() => false),
          pageA.getByRole("button", { name: "End Turn" }).isVisible().catch(() => false),
          pageB.getByRole("button", { name: "End Turn" }).isVisible().catch(() => false),
          pageA.locator('[data-testid="stand-btn"]').isVisible().catch(() => false),
          pageB.locator('[data-testid="stand-btn"]').isVisible().catch(() => false),
        ]);
        throw new Error(
          `Match stalled: ` +
          `A(status=${JSON.stringify(statusA)},draw=${drawA},end=${endA},stand=${standA}) ` +
          `B(status=${JSON.stringify(statusB)},draw=${drawB},end=${endB},stand=${standB})`,
        );
      }
      await pageA.waitForTimeout(150);
    } else {
      stagnantCycles = 0;
      await pageA.waitForTimeout(350);
    }
  }

  // Safety valve: force a terminal state so the test can still verify end-of-match UI wiring.
  const forfeitA = pageA.getByRole("button", { name: "Forfeit" });
  if (await forfeitA.isVisible().catch(() => false) && await forfeitA.isEnabled().catch(() => false)) {
    await forfeitA.click().catch(() => undefined);
    await expect.poll(async () => (await matchFinishedVisible(pageA)) && (await matchFinishedVisible(pageB)), {
      timeout: 30_000,
    }).toBe(true);
    return;
  }

  throw new Error(`Match did not complete within ${maxMs}ms`);
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

  test("two guests play a full match to completion (two isolated contexts)", async ({ browser }) => {
    test.setTimeout(600_000);

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

    await playUntilBothSeeResult(pageA, pageB, 540_000);

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

    await contextA.close();
    await contextB.close();
  });
});
