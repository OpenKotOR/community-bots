import test from "node:test";
import assert from "node:assert/strict";

import {
  MAIN_MENU_PRESET,
  MAX_BOARD_SIZE,
  type MatchPlayerState,
  type PazaakMatch,
  PazaakCoordinator,
  type SideCard,
  createCustomSideDeck,
  getDefaultPazaakOpponentForAdvisorDifficulty,
  getAdvisorSnapshotForPlayer,
  getPazaakOpponentById,
  pazaakOpponents,
  pickPazaakOpponentPhrase,
} from "./index.js";

const createCard = (overrides: Partial<SideCard> = {}): SideCard => ({
  id: overrides.id ?? "card",
  label: overrides.label ?? "+1",
  value: overrides.value ?? 1,
  type: overrides.type ?? "plus",
});

const createPlayer = (overrides: Partial<MatchPlayerState> = {}): MatchPlayerState => ({
  userId: overrides.userId ?? "p1",
  displayName: overrides.displayName ?? "Player 1",
  roundWins: overrides.roundWins ?? 0,
  sideDeckId: overrides.sideDeckId ?? null,
  sideDeckLabel: overrides.sideDeckLabel ?? null,
  sideDeck: overrides.sideDeck ?? [],
  hand: overrides.hand ?? [],
  usedCardIds: overrides.usedCardIds ?? new Set<string>(),
  board: overrides.board ?? [],
  sideCardsPlayed: overrides.sideCardsPlayed ?? [],
  total: overrides.total ?? 0,
  stood: overrides.stood ?? false,
  hasTiebreaker: overrides.hasTiebreaker ?? false,
});

const createMatch = (
  player: MatchPlayerState,
  opponent: MatchPlayerState,
  overrides: Partial<PazaakMatch> = {},
): PazaakMatch => ({
  id: overrides.id ?? "match-1",
  channelId: overrides.channelId ?? "channel-1",
  publicMessageId: overrides.publicMessageId ?? null,
  spectatorMirrors: overrides.spectatorMirrors ?? [],
  wager: overrides.wager ?? 100,
  players: overrides.players ?? [player, opponent],
  activePlayerIndex: overrides.activePlayerIndex ?? 0,
  setNumber: overrides.setNumber ?? 1,
  mainDeck: overrides.mainDeck ?? [],
  phase: overrides.phase ?? "after-draw",
  pendingDraw: overrides.pendingDraw ?? 5,
  statusLine: overrides.statusLine ?? "Test state",
  createdAt: overrides.createdAt ?? 0,
  updatedAt: overrides.updatedAt ?? 0,
  turnStartedAt: overrides.turnStartedAt ?? 0,
  initialStarterIndex: overrides.initialStarterIndex ?? 0,
  lastSetWinnerIndex: overrides.lastSetWinnerIndex ?? null,
  consecutiveTies: overrides.consecutiveTies ?? 0,
  winnerId: overrides.winnerId ?? null,
  winnerName: overrides.winnerName ?? null,
  loserId: overrides.loserId ?? null,
  loserName: overrides.loserName ?? null,
  settled: overrides.settled ?? false,
});

test("advisor recommends a safe ninth-slot side card for an immediate set win", () => {
  const player = createPlayer({
    hand: [createCard({ id: "plus1", label: "+1", value: 1, type: "plus" })],
    board: Array.from({ length: MAX_BOARD_SIZE - 1 }, () => ({ value: 2, frozen: false as const })),
    total: 19,
  });
  const opponent = createPlayer({ userId: "p2", displayName: "Opponent", total: 18 });
  const match = createMatch(player, opponent);

  const snapshot = getAdvisorSnapshotForPlayer(match, player.userId, "professional");

  assert.ok(snapshot);
  assert.equal(snapshot.recommendation.action, "play_side");
  if (snapshot.recommendation.action !== "play_side") {
    throw new Error("Expected play_side recommendation");
  }
  assert.equal(snapshot.recommendation.cardId, "plus1");
  assert.match(snapshot.recommendation.rationale, /ninth slot/i);
  assert.equal(snapshot.confidence, "high");
});

test("advisor prefers standing on match point with a solid total", () => {
  const player = createPlayer({
    roundWins: 2,
    total: 17,
    hand: [createCard({ id: "plus5", label: "+5", value: 5, type: "plus" })],
    board: [{ value: 10, frozen: false }, { value: 7, frozen: false }],
  });
  const opponent = createPlayer({ userId: "p2", displayName: "Opponent", roundWins: 1, total: 16 });
  const match = createMatch(player, opponent, { pendingDraw: 7 });

  const snapshot = getAdvisorSnapshotForPlayer(match, player.userId, "professional");

  assert.ok(snapshot);
  assert.equal(snapshot.recommendation.action, "stand");
  assert.match(snapshot.recommendation.rationale, /one set from winning the match/i);
});

test("advisor avoids standing too early when opponent is on match point and recovery exists", () => {
  const player = createPlayer({
    roundWins: 1,
    total: 17,
    hand: [createCard({ id: "minus2", label: "-2", value: 2, type: "minus" })],
    board: [{ value: 9, frozen: false }, { value: 8, frozen: false }],
  });
  const opponent = createPlayer({ userId: "p2", displayName: "Opponent", roundWins: 2, total: 16 });
  const match = createMatch(player, opponent, { pendingDraw: 8 });

  const snapshot = getAdvisorSnapshotForPlayer(match, player.userId, "professional");

  assert.ok(snapshot);
  assert.notEqual(snapshot.recommendation.action, "stand");
});

test("advisor uses D as a recovery play when the previous card is negative", () => {
  const player = createPlayer({
    total: 19,
    hand: [createCard({ id: "copyprev", label: "D", value: 0, type: "copy_previous" })],
    board: [{ value: 10, frozen: false }, { value: -4, frozen: false, source: "minus" }],
  });
  const opponent = createPlayer({ userId: "p2", displayName: "Opponent", total: 17 });
  const match = createMatch(player, opponent, { pendingDraw: 9 });

  const snapshot = getAdvisorSnapshotForPlayer(match, player.userId, "professional");

  assert.ok(snapshot);
  assert.equal(snapshot.recommendation.action, "play_side");
  if (snapshot.recommendation.action !== "play_side") {
    throw new Error("Expected play_side recommendation");
  }
  assert.equal(snapshot.recommendation.cardId, "copyprev");
  assert.match(snapshot.recommendation.rationale, /clean recovery line/i);
});

test("advisor uses VV to find the exact finish", () => {
  const player = createPlayer({
    total: 18,
    hand: [createCard({ id: "valuechange", label: "±1/2", value: 0, type: "value_change" })],
    board: [{ value: 10, frozen: false }, { value: 8, frozen: false }],
  });
  const opponent = createPlayer({ userId: "p2", displayName: "Opponent", total: 16 });
  const match = createMatch(player, opponent, { pendingDraw: 8 });

  const snapshot = getAdvisorSnapshotForPlayer(match, player.userId, "professional");

  assert.ok(snapshot);
  assert.equal(snapshot.recommendation.action, "play_side");
  if (snapshot.recommendation.action !== "play_side") {
    throw new Error("Expected play_side recommendation");
  }
  assert.equal(snapshot.recommendation.cardId, "valuechange");
  assert.equal(snapshot.recommendation.appliedValue, 2);
  assert.match(snapshot.recommendation.rationale, /precise \+2/i);
});

test("advisor uses Tiebreaker to pressure a standing opponent on the same total", () => {
  const player = createPlayer({
    total: 18,
    hand: [createCard({ id: "tiebreaker", label: "±1T", value: 1, type: "tiebreaker" })],
    board: [{ value: 10, frozen: false }, { value: 8, frozen: false }],
  });
  const opponent = createPlayer({ userId: "p2", displayName: "Opponent", total: 19, stood: true });
  const match = createMatch(player, opponent, { pendingDraw: 8 });

  const snapshot = getAdvisorSnapshotForPlayer(match, player.userId, "professional");

  assert.ok(snapshot);
  assert.equal(snapshot.recommendation.action, "play_side");
  if (snapshot.recommendation.action !== "play_side") {
    throw new Error("Expected play_side recommendation");
  }
  assert.equal(snapshot.recommendation.cardId, "tiebreaker");
  assert.equal(snapshot.recommendation.appliedValue, 1);
  assert.match(snapshot.recommendation.rationale, /tiebreaker edge/i);
});

test("advisor recognizes flip cards as live recovery when they hit real targets", () => {
  const player = createPlayer({
    total: 18,
    hand: [createCard({ id: "flip36", label: "Flip 3&6", value: 0, type: "flip_three_six" })],
    board: [
      { value: 9, frozen: false },
      { value: 6, frozen: false },
      { value: 3, frozen: false },
    ],
  });
  const opponent = createPlayer({ userId: "p2", displayName: "Opponent", total: 17 });
  const match = createMatch(player, opponent, { pendingDraw: 3 });

  const snapshot = getAdvisorSnapshotForPlayer(match, player.userId, "professional");

  assert.ok(snapshot);
  assert.equal(snapshot.recommendation.action, "play_side");
  if (snapshot.recommendation.action !== "play_side") {
    throw new Error("Expected play_side recommendation");
  }
  assert.equal(snapshot.recommendation.cardId, "flip36");
  assert.match(snapshot.recommendation.rationale, /flips 2 live board cards/i);
});

test("advisor does not recommend a flip card when there are no live targets", () => {
  const player = createPlayer({
    total: 16,
    hand: [createCard({ id: "flip24", label: "Flip 2&4", value: 0, type: "flip_two_four" })],
    board: [
      { value: 10, frozen: false },
      { value: 5, frozen: false },
      { value: 1, frozen: false },
    ],
  });
  const opponent = createPlayer({ userId: "p2", displayName: "Opponent", total: 18 });
  const match = createMatch(player, opponent, { pendingDraw: 1 });

  const snapshot = getAdvisorSnapshotForPlayer(match, player.userId, "professional");

  assert.ok(snapshot);
  assert.notEqual(snapshot.recommendation.action, "play_side");
  assert.equal(snapshot.alternatives[0]?.displayLabel, "Play Flip 2&4");
  assert.match(snapshot.alternatives[0]?.rationale ?? "", /weak use of the card/i);
});

test("advisor does not recommend D when it only copies a neutral zero", () => {
  const player = createPlayer({
    total: 10,
    hand: [createCard({ id: "copyprev", label: "D", value: 0, type: "copy_previous" })],
    board: [
      { value: 10, frozen: false },
      { value: 0, frozen: false, source: "flip_two_four" },
    ],
  });
  const opponent = createPlayer({ userId: "p2", displayName: "Opponent", total: 14 });
  const match = createMatch(player, opponent, { pendingDraw: 10 });

  const snapshot = getAdvisorSnapshotForPlayer(match, player.userId, "professional");

  assert.ok(snapshot);
  assert.equal(snapshot.recommendation.action, "end_turn");
  assert.equal(snapshot.alternatives[0]?.displayLabel, "Play D (= 0)");
  assert.match(snapshot.alternatives[0]?.rationale ?? "", /neutral 0/i);
});

test("main menu preset keeps canonical PazaakWorld card and rule structure", () => {
  assert.equal(MAIN_MENU_PRESET.heroTitle, "PAZAAK");
  assert.equal(MAIN_MENU_PRESET.modeCards.length, 3);
  assert.equal(MAIN_MENU_PRESET.rules.length, 3);

  const aiCard = MAIN_MENU_PRESET.modeCards.find((card) => card.key === "ai");
  assert.ok(aiCard);
  assert.equal(aiCard.aiOptions?.length, 3);
  assert.deepEqual(
    aiCard.aiOptions?.map((option) => option.difficulty),
    ["easy", "hard", "professional"],
  );

  const quickMatch = MAIN_MENU_PRESET.modeCards.find((card) => card.key === "quick_match");
  assert.ok(quickMatch?.requiresAuth);
  assert.equal(quickMatch?.primaryAction?.label, "Find Match");
});

test("opponent catalogue includes HoloPazaak roster and Activity profiles", () => {
  const ids = new Set(pazaakOpponents.map((opponent) => opponent.id));
  for (const id of [
    "jarjar",
    "c3po",
    "butters",
    "porkins",
    "hk47",
    "hal9000",
    "republic_soldier",
    "ig88",
    "trump",
    "yoda",
    "theemperor",
    "revan",
    "atton",
    "t1000",
    "drchannard",
    "blaine",
    "nu",
  ]) {
    assert.ok(ids.has(id), `Expected ${id} in merged opponent catalogue`);
  }

  assert.equal(getPazaakOpponentById("hal")?.id, "hal9000");
  assert.equal(getDefaultPazaakOpponentForAdvisorDifficulty("easy").id, "jarjar");
  assert.equal(getDefaultPazaakOpponentForAdvisorDifficulty("hard").id, "porkins");
  assert.equal(getDefaultPazaakOpponentForAdvisorDifficulty("professional").id, "revan");
});

test("opponent sideboards build through canonical custom sideboard normalization", () => {
  for (const opponent of pazaakOpponents) {
    assert.equal(opponent.sideDeckTokens.length, 10, `${opponent.id} should define 10 sideboard tokens`);
    const result = createCustomSideDeck({ label: opponent.name, tokens: opponent.sideDeckTokens });
    assert.equal(result.sideDeck.length, 10, `${opponent.id} should build as a custom sideboard`);
  }
});

test("opponent phrase picker avoids immediate repeats when alternatives exist", () => {
  const opponent = getPazaakOpponentById("revan");
  assert.ok(opponent);

  const previous = opponent.phrases.chosen[0];
  const next = pickPazaakOpponentPhrase(opponent, "chosen", previous, "...", () => 0);

  assert.notEqual(next, previous);
});

test("advisor snapshot keeps the recommended line at the top of alternatives with metadata", () => {
  const player = createPlayer({
    total: 18,
    hand: [
      createCard({ id: "valuechange", label: "±1/2", value: 0, type: "value_change" }),
      createCard({ id: "plus1", label: "+1", value: 1, type: "plus" }),
      createCard({ id: "minus1", label: "-1", value: 1, type: "minus" }),
    ],
    board: [{ value: 10, frozen: false }, { value: 8, frozen: false }],
  });
  const opponent = createPlayer({ userId: "p2", displayName: "Opponent", total: 17 });
  const match = createMatch(player, opponent, { pendingDraw: 8 });

  const snapshot = getAdvisorSnapshotForPlayer(match, player.userId, "professional");

  assert.ok(snapshot);
  assert.equal(snapshot.recommendation.action, "play_side");
  if (snapshot.recommendation.action !== "play_side") {
    throw new Error("Expected play_side recommendation");
  }
  assert.equal(snapshot.difficulty, "professional");
  assert.equal(snapshot.category, "exact");
  assert.equal(snapshot.confidence, "high");
  assert.ok(snapshot.alternatives.length >= 2);
  assert.equal(snapshot.alternatives[0]?.displayLabel, snapshot.recommendation.displayLabel);
  assert.equal(snapshot.alternatives[0]?.category, snapshot.category);
});

test("direct matches initialize turn deadlines for cross-platform clients", () => {
  let now = 1000;
  const coordinator = new PazaakCoordinator(undefined, {
    turnTimeoutMs: 45_000,
    now: () => now,
  });

  const match = coordinator.createDirectMatch({
    channelId: "web-lobby",
    challengerId: "p1",
    challengerName: "Player 1",
    opponentId: "p2",
    opponentName: "Player 2",
  });

  assert.equal(match.turnStartedAt, 1000);
  assert.equal(match.turnDeadlineAt, 46_000);

  now = 2000;
  match.phase = "turn";
  match.mainDeck = [5];
  const activeUserId = match.players[match.activePlayerIndex]!.userId;
  coordinator.draw(match.id, activeUserId);

  assert.equal(match.turnStartedAt, 2000);
  assert.equal(match.turnDeadlineAt, 47_000);
});

test("turn timer tick auto-resolves an idle pre-draw turn", () => {
  let now = 1000;
  const coordinator = new PazaakCoordinator(undefined, {
    turnTimeoutMs: 1000,
    now: () => now,
  });
  const match = coordinator.createDirectMatch({
    channelId: "web-lobby",
    challengerId: "p1",
    challengerName: "Player 1",
    opponentId: "p2",
    opponentName: "Player 2",
  });
  match.mainDeck = [5];

  now = 2000;
  const updates = coordinator.tickTurnTimers(now);

  assert.equal(updates.length, 1);
  assert.match(updates[0]!.statusLine, /timed out/i);
  assert.equal(updates[0]!.phase, "turn");
  assert.equal(updates[0]!.turnDeadlineAt, 3000);
});

test("disconnect tick forfeits after the configured grace period", () => {
  let now = 1000;
  const coordinator = new PazaakCoordinator(undefined, {
    disconnectForfeitMs: 30_000,
    now: () => now,
  });
  const match = coordinator.createDirectMatch({
    channelId: "web-lobby",
    challengerId: "p1",
    challengerName: "Player 1",
    opponentId: "p2",
    opponentName: "Player 2",
  });

  coordinator.markDisconnected("p1");
  now = 30_999;
  assert.equal(coordinator.tickDisconnectForfeits(now).length, 0);

  now = 31_000;
  const updates = coordinator.tickDisconnectForfeits(now);

  assert.equal(updates.length, 1);
  assert.equal(match.phase, "completed");
  assert.equal(match.winnerId, "p2");
});

test("AI seats execute advisor-backed side-card moves", () => {
  const coordinator = new PazaakCoordinator();
  const match = coordinator.createDirectMatch({
    channelId: "solo",
    challengerId: "p1",
    challengerName: "Player 1",
    opponentId: "ai-professional",
    opponentName: "Professional AI",
    opponentAiDifficulty: "professional",
  });
  const aiIndex = match.players.findIndex((player) => player.userId === "ai-professional");
  const aiPlayer = match.players[aiIndex]!;
  match.activePlayerIndex = aiIndex;
  match.phase = "after-draw";
  match.pendingDraw = 8;
  aiPlayer.total = 18;
  aiPlayer.board = [{ value: 10, frozen: false }, { value: 8, frozen: false }];
  aiPlayer.hand = [createCard({ id: "valuechange", label: "±1/2", value: 0, type: "value_change" })];

  const updated = coordinator.executeAiMove(match.id, aiPlayer.userId);

  assert.equal(updated.phase, "after-card");
  assert.equal(aiPlayer.total, 20);
  assert.equal(aiPlayer.sideCardsPlayed[0]?.cardId, "valuechange");
});
