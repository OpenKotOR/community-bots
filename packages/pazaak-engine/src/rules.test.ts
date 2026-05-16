import test from "node:test";
import assert from "node:assert/strict";

import {
  getCardReference,
  getCardsForMode,
  getCardsByRarity,
  getBustProbabilityFromTable,
  getBustProbability,
  BUST_PROBABILITY_TABLE,
  PAZAAK_RULEBOOK,
  STARTER_TOKEN_GRANT,
} from "./rules.js";

// ---------------------------------------------------------------------------
// PAZAAK_RULEBOOK — basic shape validation
// ---------------------------------------------------------------------------

test("PAZAAK_RULEBOOK has a non-empty cards array", () => {
  assert.ok(PAZAAK_RULEBOOK.cards.length > 0);
});

test("PAZAAK_RULEBOOK cards all have a non-empty token string", () => {
  for (const card of PAZAAK_RULEBOOK.cards) {
    assert.ok(card.token.length > 0, `Card entry is missing token: ${JSON.stringify(card)}`);
  }
});

test("PAZAAK_RULEBOOK has deckLimits defined with a positive sideDeckSize", () => {
  assert.ok(PAZAAK_RULEBOOK.deckLimits);
  assert.ok(PAZAAK_RULEBOOK.deckLimits.sideDeckSize > 0);
});

// ---------------------------------------------------------------------------
// getCardReference
// ---------------------------------------------------------------------------

test("getCardReference returns an entry for a known token", () => {
  const ref = getCardReference("+1");
  assert.ok(ref, "Expected +1 to be a known card");
  assert.equal(ref!.token, "+1");
});

test("getCardReference returns undefined for an unknown token", () => {
  assert.equal(getCardReference("zzz-unknown"), undefined);
});

test("getCardReference handles empty string", () => {
  assert.equal(getCardReference(""), undefined);
});

// ---------------------------------------------------------------------------
// getCardsForMode
// ---------------------------------------------------------------------------

test("getCardsForMode returns cards for canonical mode", () => {
  const cards = getCardsForMode("canonical");
  assert.ok(cards.length > 0);
  assert.ok(cards.every((c) => c.gameMode === "canonical" || c.gameMode === "wacky"));
});

test("getCardsForMode returns cards for wacky mode (superset of canonical)", () => {
  const canonical = getCardsForMode("canonical");
  const wacky = getCardsForMode("wacky");
  assert.ok(wacky.length >= canonical.length);
});

// ---------------------------------------------------------------------------
// getCardsByRarity
// ---------------------------------------------------------------------------

test("getCardsByRarity returns cards for 'common' rarity", () => {
  const cards = getCardsByRarity("common");
  assert.ok(cards.length > 0);
  assert.ok(cards.every((c) => c.rarity === "common"));
});

test("getCardsByRarity returns cards for 'rare' rarity", () => {
  const cards = getCardsByRarity("rare");
  assert.ok(cards.length > 0);
  assert.ok(cards.every((c) => c.rarity === "rare"));
});

test("getCardsByRarity returns empty array for an unknown rarity", () => {
  // @ts-expect-error — intentional bad input
  const cards = getCardsByRarity("legendary");
  assert.deepEqual([...cards], []);
});

// ---------------------------------------------------------------------------
// BUST_PROBABILITY_TABLE — shape and boundary values
// ---------------------------------------------------------------------------

test("BUST_PROBABILITY_TABLE has entries for 0 through 20", () => {
  assert.equal(BUST_PROBABILITY_TABLE.length, 21);
});

test("BUST_PROBABILITY_TABLE probability at total=0 is 0 (cannot bust)", () => {
  assert.equal(BUST_PROBABILITY_TABLE[0], 0);
});

test("BUST_PROBABILITY_TABLE probability at total=20 is 1 (always bust)", () => {
  assert.equal(BUST_PROBABILITY_TABLE[20], 1);
});

test("BUST_PROBABILITY_TABLE values are monotonically non-decreasing", () => {
  for (let i = 1; i < BUST_PROBABILITY_TABLE.length; i += 1) {
    assert.ok(
      BUST_PROBABILITY_TABLE[i]! >= BUST_PROBABILITY_TABLE[i - 1]!,
      `Table not monotonic at index ${i}`,
    );
  }
});

// ---------------------------------------------------------------------------
// getBustProbabilityFromTable
// ---------------------------------------------------------------------------

test("getBustProbabilityFromTable returns 0 for total = 0", () => {
  assert.equal(getBustProbabilityFromTable(0), 0);
});

test("getBustProbabilityFromTable returns 1 for total >= 20", () => {
  assert.equal(getBustProbabilityFromTable(20), 1);
  assert.equal(getBustProbabilityFromTable(25), 1);
});

test("getBustProbabilityFromTable clamps negative values to 0 probability", () => {
  const result = getBustProbabilityFromTable(-5);
  assert.equal(result, BUST_PROBABILITY_TABLE[0]);
});

test("getBustProbabilityFromTable returns 0 for non-finite input", () => {
  assert.equal(getBustProbabilityFromTable(Infinity), 0);
  assert.equal(getBustProbabilityFromTable(NaN), 0);
});

// ---------------------------------------------------------------------------
// getBustProbability — deck-specific calculation
// ---------------------------------------------------------------------------

test("getBustProbability falls back to table when no deck is given", () => {
  const tableValue = getBustProbabilityFromTable(15);
  assert.equal(getBustProbability(15), tableValue);
});

test("getBustProbability falls back to table for empty deck", () => {
  const tableValue = getBustProbabilityFromTable(15);
  assert.equal(getBustProbability(15, []), tableValue);
});

test("getBustProbability returns 1 when total is already at 20", () => {
  assert.equal(getBustProbability(20, [1, 2, 3, 4, 5]), 1);
});

test("getBustProbability returns 0 when total is negative", () => {
  assert.equal(getBustProbability(-1, [1, 2, 3]), 0);
});

test("getBustProbability calculates exact bust fraction from deck snapshot", () => {
  // Total = 18, threshold = 2, any card > 2 busts (3-6 are bust cards)
  // Deck = [1, 2, 3, 4] → 2 bust (3,4), 2 safe (1,2) → bust probability = 0.5
  const prob = getBustProbability(18, [1, 2, 3, 4]);
  assert.equal(prob, 0.5);
});

test("getBustProbability returns 0 when all remaining deck cards are safe", () => {
  // Total = 14, threshold = 6, no card in deck > 6
  const prob = getBustProbability(14, [1, 2, 3, 4, 5, 6]);
  assert.equal(prob, 0);
});

test("getBustProbability returns 1 when all remaining deck cards bust", () => {
  // Total = 19, threshold = 1, deck only has 2-6
  const prob = getBustProbability(19, [2, 3, 4, 5, 6]);
  assert.equal(prob, 1);
});

test("getBustProbability returns 0 for non-finite total with deck", () => {
  assert.equal(getBustProbability(NaN, [1, 2, 3]), 0);
});

// ---------------------------------------------------------------------------
// STARTER_TOKEN_GRANT
// ---------------------------------------------------------------------------

test("STARTER_TOKEN_GRANT is non-empty", () => {
  assert.ok(STARTER_TOKEN_GRANT.length > 0);
});

test("STARTER_TOKEN_GRANT contains plus cards", () => {
  assert.ok(STARTER_TOKEN_GRANT.some((t) => t.startsWith("+")));
});

test("STARTER_TOKEN_GRANT contains minus cards", () => {
  assert.ok(STARTER_TOKEN_GRANT.some((t) => t.startsWith("-")));
});
