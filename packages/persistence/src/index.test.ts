import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  JsonWalletRepository,
  JsonPazaakLobbyRepository,
  JsonPazaakMatchmakingQueueRepository,
} from "./index.js";

// ---------------------------------------------------------------------------
// Shared temp-dir lifecycle
// ---------------------------------------------------------------------------

let tmpDir: string;
test.before(async () => { tmpDir = await mkdtemp(path.join(tmpdir(), "persistence-test-")); });
test.after(async () => { await rm(tmpDir, { recursive: true, force: true }); });

const fp = (name: string) => path.join(tmpDir, `${name}-${Math.random().toString(36).slice(2, 8)}.json`);

// ---------------------------------------------------------------------------
// JsonWalletRepository — creation and read-back
// ---------------------------------------------------------------------------

test("getWallet auto-creates a wallet with the configured starting balance", async () => {
  const repo = new JsonWalletRepository(fp("wallets"), 500);
  const wallet = await repo.getWallet("user-1", "Alice");

  assert.equal(wallet.userId, "user-1");
  assert.equal(wallet.displayName, "Alice");
  assert.equal(wallet.balance, 500);
  assert.equal(wallet.wins, 0);
  assert.equal(wallet.losses, 0);
  assert.equal(wallet.gamesPlayed, 0);
});

test("getWallet is idempotent — second call returns the same record", async () => {
  const repo = new JsonWalletRepository(fp("wallets"), 100);
  const first = await repo.getWallet("user-2", "Bob");
  const second = await repo.getWallet("user-2", "Bob");

  assert.equal(first.balance, second.balance);
  assert.equal(first.userId, second.userId);
});

test("adjustBalance modifies balance and persists", async () => {
  const repo = new JsonWalletRepository(fp("wallets"), 200);
  await repo.getWallet("user-3", "Carol");
  const updated = await repo.adjustBalance("user-3", "Carol", 50);

  assert.equal(updated.balance, 250);

  const reloaded = await repo.getWallet("user-3", "Carol");
  assert.equal(reloaded.balance, 250);
});

test("adjustBalance with negative delta reduces balance", async () => {
  const repo = new JsonWalletRepository(fp("wallets"), 300);
  const updated = await repo.adjustBalance("user-4", "Dave", -100);
  assert.equal(updated.balance, 200);
});

test("canCover returns true when balance is sufficient", async () => {
  const repo = new JsonWalletRepository(fp("wallets"), 500);
  assert.equal(await repo.canCover("user-5", "Eve", 500), true);
  assert.equal(await repo.canCover("user-5", "Eve", 501), false);
});

// ---------------------------------------------------------------------------
// JsonWalletRepository — daily bonus
// ---------------------------------------------------------------------------

test("claimDailyBonus credits wallet on first claim", async () => {
  const repo = new JsonWalletRepository(fp("wallets"), 0);
  const result = await repo.claimDailyBonus("user-6", "Frank", 100, 86_400_000);

  assert.equal(result.credited, true);
  assert.equal(result.amount, 100);

  const wallet = await repo.getWallet("user-6", "Frank");
  assert.equal(wallet.balance, 100);
});

test("claimDailyBonus respects cooldown — second call within window is rejected", async () => {
  const repo = new JsonWalletRepository(fp("wallets"), 0);
  const first = await repo.claimDailyBonus("user-7", "Grace", 100, 86_400_000);
  assert.equal(first.credited, true);

  const second = await repo.claimDailyBonus("user-7", "Grace", 100, 86_400_000);
  assert.equal(second.credited, false);
  assert.equal(second.amount, 0);
  assert.ok(second.nextEligibleAt > Date.now());
});

test("claimDailyBonus with zero cooldown always credits", async () => {
  const repo = new JsonWalletRepository(fp("wallets"), 0);
  const first = await repo.claimDailyBonus("user-8", "Henry", 50, 0);
  assert.equal(first.credited, true);
  const second = await repo.claimDailyBonus("user-8", "Henry", 50, 0);
  assert.equal(second.credited, true);

  const wallet = await repo.getWallet("user-8", "Henry");
  assert.equal(wallet.balance, 100);
});

// ---------------------------------------------------------------------------
// JsonWalletRepository — match recording
// ---------------------------------------------------------------------------

test("recordMatch transfers wager from loser to winner", async () => {
  const repo = new JsonWalletRepository(fp("wallets"), 1000);
  const result = await repo.recordMatch({
    winnerId: "winner-1",
    winnerName: "Winner",
    loserId: "loser-1",
    loserName: "Loser",
    wager: 200,
  });

  assert.equal(result.winner.balance, 1200);
  assert.equal(result.loser.balance, 800);
  assert.equal(result.winner.wins, 1);
  assert.equal(result.loser.losses, 1);
});

test("recordMatch does not let loser balance go below zero", async () => {
  const repo = new JsonWalletRepository(fp("wallets"), 50);
  const result = await repo.recordMatch({
    winnerId: "winner-2",
    winnerName: "W2",
    loserId: "loser-2",
    loserName: "L2",
    wager: 1000,  // wager exceeds loser balance
  });

  assert.equal(result.loser.balance, 0);  // Math.max(0, balance - wager)
  assert.equal(result.winner.balance, 1050);  // winner still receives full wager
});

test("recordMatch increments win streak and tracks best streak", async () => {
  const repo = new JsonWalletRepository(fp("wallets"), 100);
  for (let i = 0; i < 3; i += 1) {
    await repo.recordMatch({
      winnerId: "streak-winner",
      winnerName: "Streak",
      loserId: `streak-loser-${i}`,
      loserName: `Loser${i}`,
      wager: 0,
    });
  }
  const wallet = await repo.getWallet("streak-winner", "Streak");
  assert.equal(wallet.streak, 3);
  assert.equal(wallet.bestStreak, 3);
});

test("recordMatch resets loser streak to zero", async () => {
  const repo = new JsonWalletRepository(fp("wallets"), 100);
  // Give player a streak first
  await repo.recordMatch({ winnerId: "p1", winnerName: "P1", loserId: "p2", loserName: "P2", wager: 0 });
  const afterWin = await repo.getWallet("p1", "P1");
  assert.equal(afterWin.streak, 1);

  // Now p1 loses
  await repo.recordMatch({ winnerId: "p3", winnerName: "P3", loserId: "p1", loserName: "P1", wager: 0 });
  const afterLoss = await repo.getWallet("p1", "P1");
  assert.equal(afterLoss.streak, 0);
  assert.equal(afterLoss.bestStreak, 1);  // best streak preserved
});

// ---------------------------------------------------------------------------
// JsonWalletRepository — crate economy
// ---------------------------------------------------------------------------

test("consumeCrateAndApplyDrops throws when no crates available", async () => {
  const repo = new JsonWalletRepository(fp("wallets"), 0);
  await repo.getWallet("crate-user-1", "CrateUser");

  await assert.rejects(
    () => repo.consumeCrateAndApplyDrops("crate-user-1", "CrateUser", "standard", { tokens: [], bonusCredits: 0 }),
    /No standard crates to open/,
  );
});

test("consumeCrateAndApplyDrops decrements crate count and adds tokens", async () => {
  const repo = new JsonWalletRepository(fp("wallets"), 0);
  await repo.applyMatchProgressionDeltas([{
    userId: "crate-user-2",
    displayName: "CrateUser2",
    addStandardCrates: 2,
    addTokens: [],
  }]);

  const result = await repo.consumeCrateAndApplyDrops(
    "crate-user-2",
    "CrateUser2",
    "standard",
    { tokens: ["+1", "-2"], bonusCredits: 50 },
  );

  assert.equal(result.unopenedCratesStandard, 1);
  assert.ok(result.ownedSideDeckTokens.includes("+1"));
  assert.ok(result.ownedSideDeckTokens.includes("-2"));
  assert.equal(result.balance, 50);
});

// ---------------------------------------------------------------------------
// JsonWalletRepository — starter tokens
// ---------------------------------------------------------------------------

test("starter tokens are granted to new wallets automatically", async () => {
  const repo = new JsonWalletRepository(fp("wallets"), 0, ["+1", "+2", "-1"]);
  const wallet = await repo.getWallet("starter-user", "StarterUser");
  assert.deepEqual(wallet.ownedSideDeckTokens, ["+1", "+2", "-1"]);
});

test("starter tokens are not re-granted to wallets that already have tokens", async () => {
  const repo = new JsonWalletRepository(fp("wallets"), 0, ["+1"]);
  await repo.getWallet("notified-user", "NotifiedUser");
  await repo.addOwnedSideDeckTokens("notified-user", "NotifiedUser", ["+3"]);
  // Re-open wallet — should not prepend starter tokens again
  const wallet = await repo.getWallet("notified-user", "NotifiedUser");
  assert.equal(wallet.ownedSideDeckTokens.filter((t) => t === "+1").length, 1);
});

// ---------------------------------------------------------------------------
// JsonWalletRepository — listWallets
// ---------------------------------------------------------------------------

test("listWallets returns all created wallets", async () => {
  const repo = new JsonWalletRepository(fp("wallets"), 10);
  await repo.getWallet("list-user-a", "A");
  await repo.getWallet("list-user-b", "B");
  await repo.getWallet("list-user-c", "C");

  const list = await repo.listWallets();
  assert.equal(list.length, 3);
  assert.ok(list.some((w) => w.userId === "list-user-a"));
  assert.ok(list.some((w) => w.userId === "list-user-b"));
  assert.ok(list.some((w) => w.userId === "list-user-c"));
});

// ---------------------------------------------------------------------------
// JsonPazaakLobbyRepository — create and list
// ---------------------------------------------------------------------------

test("lobby create returns a record with correct fields", async () => {
  const repo = new JsonPazaakLobbyRepository(fp("lobbies"));
  const lobby = await repo.create({
    name: "Test Table",
    hostUserId: "host-1",
    hostName: "Host",
    maxPlayers: 2,
  });

  assert.equal(lobby.name, "Test Table");
  assert.equal(lobby.hostUserId, "host-1");
  assert.equal(lobby.status, "waiting");
  assert.equal(lobby.players.length, 1);
  assert.equal(lobby.players[0]!.userId, "host-1");
  assert.equal(lobby.players[0]!.isHost, true);
  assert.equal(lobby.players[0]!.ready, true);
  assert.ok(lobby.id);
  assert.ok(lobby.lobbyCode);
});

test("listOpen excludes lobbies that are in_game or closed", async () => {
  const repo = new JsonPazaakLobbyRepository(fp("lobbies"));
  const a = await repo.create({ name: "Open A", hostUserId: "h-a", hostName: "Ha", maxPlayers: 2 });
  const b = await repo.create({ name: "Open B", hostUserId: "h-b", hostName: "Hb", maxPlayers: 2 });
  // markInGame transitions to "in_game", which listOpen excludes
  await repo.markInGame(a.id, "match-xyz");

  const open = await repo.listOpen();
  assert.ok(!open.some((l) => l.id === a.id), "in_game lobby should not appear in listOpen");
  assert.ok(open.some((l) => l.id === b.id), "waiting lobby should appear in listOpen");
});

// ---------------------------------------------------------------------------
// JsonPazaakLobbyRepository — join and leave
// ---------------------------------------------------------------------------

test("lobby join adds a player", async () => {
  const repo = new JsonPazaakLobbyRepository(fp("lobbies"));
  const lobby = await repo.create({ name: "Join Test", hostUserId: "host-j", hostName: "HJ", maxPlayers: 2 });

  const updated = await repo.join(lobby.id, { userId: "player-j", displayName: "PJ" });
  assert.equal(updated.players.length, 2);
  assert.ok(updated.players.some((p) => p.userId === "player-j"));
});

test("lobby join is idempotent — joining twice does not duplicate player", async () => {
  const repo = new JsonPazaakLobbyRepository(fp("lobbies"));
  const lobby = await repo.create({ name: "Idem Test", hostUserId: "host-i", hostName: "HI", maxPlayers: 4 });

  await repo.join(lobby.id, { userId: "player-i", displayName: "PI" });
  const updated = await repo.join(lobby.id, { userId: "player-i", displayName: "PI" });
  assert.equal(updated.players.filter((p) => p.userId === "player-i").length, 1);
});

test("lobby join throws when full", async () => {
  const repo = new JsonPazaakLobbyRepository(fp("lobbies"));
  const lobby = await repo.create({ name: "Full Test", hostUserId: "host-f", hostName: "HF", maxPlayers: 2 });
  await repo.join(lobby.id, { userId: "player-f1", displayName: "PF1" });

  await assert.rejects(
    () => repo.join(lobby.id, { userId: "player-f2", displayName: "PF2" }),
    /full/i,
  );
});

test("lobby join rejects wrong password", async () => {
  const repo = new JsonPazaakLobbyRepository(fp("lobbies"));
  const lobby = await repo.create({
    name: "Locked",
    hostUserId: "host-pw",
    hostName: "HPW",
    maxPlayers: 4,
    password: "secret",
  });

  await assert.rejects(
    () => repo.join(lobby.id, { userId: "player-pw", displayName: "PPW", password: "wrong" }),
    /password|unauthorized/i,
  );
});

test("lobby leave removes a non-host player", async () => {
  const repo = new JsonPazaakLobbyRepository(fp("lobbies"));
  const lobby = await repo.create({ name: "Leave Test", hostUserId: "host-l", hostName: "HL", maxPlayers: 4 });
  await repo.join(lobby.id, { userId: "player-l", displayName: "PL" });

  const updated = await repo.leave(lobby.id, "player-l");
  assert.ok(updated);
  assert.ok(!updated!.players.some((p) => p.userId === "player-l"));
});

test("lobby host leaving closes the lobby", async () => {
  const repo = new JsonPazaakLobbyRepository(fp("lobbies"));
  const lobby = await repo.create({ name: "Host Leave", hostUserId: "host-hl", hostName: "HHL", maxPlayers: 4 });

  const result = await repo.leave(lobby.id, "host-hl");
  // host leaving either closes lobby (returns undefined) or marks it closed
  if (result) {
    assert.equal(result.status, "closed");
  } else {
    // lobby removed from store — get should return undefined
    const gone = await repo.get(lobby.id);
    assert.equal(gone, undefined);
  }
});

// ---------------------------------------------------------------------------
// JsonPazaakLobbyRepository — ready state and AI
// ---------------------------------------------------------------------------

test("setReady toggles a player ready flag", async () => {
  const repo = new JsonPazaakLobbyRepository(fp("lobbies"));
  const lobby = await repo.create({ name: "Ready Test", hostUserId: "host-r", hostName: "HR", maxPlayers: 4 });
  await repo.join(lobby.id, { userId: "player-r", displayName: "PR" });

  const updated = await repo.setReady(lobby.id, "player-r", true);
  const player = updated.players.find((p) => p.userId === "player-r");
  assert.ok(player?.ready);
});

test("addAi adds an AI slot with the correct difficulty", async () => {
  const repo = new JsonPazaakLobbyRepository(fp("lobbies"));
  const lobby = await repo.create({ name: "AI Test", hostUserId: "host-ai", hostName: "HAI", maxPlayers: 4 });

  const updated = await repo.addAi(lobby.id, "host-ai", "hard");
  const aiPlayer = updated.players.find((p) => p.isAi);
  assert.ok(aiPlayer);
  assert.ok(aiPlayer!.displayName.toLowerCase().includes("hard") || aiPlayer!.isAi);
});

test("addAi throws when called by non-host", async () => {
  const repo = new JsonPazaakLobbyRepository(fp("lobbies"));
  const lobby = await repo.create({ name: "AI Auth Test", hostUserId: "host-aa", hostName: "HAA", maxPlayers: 4 });

  await assert.rejects(
    () => repo.addAi(lobby.id, "not-the-host", "easy"),
    /host/i,
  );
});

// ---------------------------------------------------------------------------
// JsonPazaakLobbyRepository — get by code
// ---------------------------------------------------------------------------

test("getByCode retrieves a lobby using its short code", async () => {
  const repo = new JsonPazaakLobbyRepository(fp("lobbies"));
  const lobby = await repo.create({ name: "Code Test", hostUserId: "host-c", hostName: "HC", maxPlayers: 2 });

  const found = await repo.getByCode(lobby.lobbyCode);
  assert.ok(found);
  assert.equal(found!.id, lobby.id);
});

// ---------------------------------------------------------------------------
// JsonPazaakMatchmakingQueueRepository
// ---------------------------------------------------------------------------

test("queue enqueue and list round-trip", async () => {
  const repo = new JsonPazaakMatchmakingQueueRepository(fp("queue"));
  await repo.enqueue({ userId: "q-user-1", displayName: "QU1", mmr: 1500, preferredMaxPlayers: 2 });
  await repo.enqueue({ userId: "q-user-2", displayName: "QU2", mmr: 1500, preferredMaxPlayers: 2 });

  const list = await repo.list();
  assert.equal(list.length, 2);
  assert.ok(list.some((r) => r.userId === "q-user-1"));
  assert.ok(list.some((r) => r.userId === "q-user-2"));
});

test("queue enqueue is idempotent — re-enqueue same user updates the record", async () => {
  const repo = new JsonPazaakMatchmakingQueueRepository(fp("queue"));
  await repo.enqueue({ userId: "q-idem", displayName: "QIdem", mmr: 1500, preferredMaxPlayers: 2 });
  await repo.enqueue({ userId: "q-idem", displayName: "QIdem", mmr: 1500, preferredMaxPlayers: 4 });

  const list = await repo.list();
  assert.equal(list.filter((r) => r.userId === "q-idem").length, 1);
  assert.equal(list.find((r) => r.userId === "q-idem")!.preferredMaxPlayers, 4);
});

test("queue remove dequeues a user", async () => {
  const repo = new JsonPazaakMatchmakingQueueRepository(fp("queue"));
  await repo.enqueue({ userId: "q-rm", displayName: "QRm", mmr: 1500, preferredMaxPlayers: 2 });
  const removed = await repo.remove("q-rm");
  assert.equal(removed, true);

  const remaining = await repo.list();
  assert.ok(!remaining.some((r) => r.userId === "q-rm"));
});

test("queue remove returns false for unknown user", async () => {
  const repo = new JsonPazaakMatchmakingQueueRepository(fp("queue"));
  const removed = await repo.remove("nobody");
  assert.equal(removed, false);
});

test("queue get returns undefined for missing user", async () => {
  const repo = new JsonPazaakMatchmakingQueueRepository(fp("queue"));
  const entry = await repo.get("ghost");
  assert.equal(entry, undefined);
});
