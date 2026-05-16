import test from "node:test";
import assert from "node:assert/strict";

import {
  pazaakOpponents,
  getPazaakOpponentById,
  getPazaakOpponentsByDifficulty,
  getDefaultPazaakOpponentForAdvisorDifficulty,
  getRandomPazaakOpponent,
  pickPazaakOpponentPhrase,
} from "./opponents.js";

// ---------------------------------------------------------------------------
// Data integrity — all opponents have required fields
// ---------------------------------------------------------------------------

test("pazaakOpponents array is non-empty", () => {
  assert.ok(pazaakOpponents.length > 0);
});

test("every opponent has a non-empty id and name", () => {
  for (const opp of pazaakOpponents) {
    assert.ok(opp.id.length > 0, `Opponent missing id: ${JSON.stringify(opp)}`);
    assert.ok(opp.name.length > 0, `Opponent '${opp.id}' missing name`);
  }
});

test("every opponent has all required phrase keys", () => {
  const requiredKeys: Array<keyof typeof pazaakOpponents[0]["phrases"]> = [
    "chosen", "play", "stand", "winRound", "loseRound", "winGame", "loseGame",
  ];
  for (const opp of pazaakOpponents) {
    for (const key of requiredKeys) {
      const phrases = opp.phrases[key];
      assert.ok(
        Array.isArray(phrases) && phrases.length > 0,
        `Opponent '${opp.id}' missing phrase key '${key}'`,
      );
    }
  }
});

test("opponent ids are unique", () => {
  const ids = pazaakOpponents.map((o) => o.id);
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length, "Duplicate opponent ids found");
});

// ---------------------------------------------------------------------------
// getPazaakOpponentById
// ---------------------------------------------------------------------------

test("getPazaakOpponentById returns the correct opponent", () => {
  const first = pazaakOpponents[0]!;
  const found = getPazaakOpponentById(first.id);
  assert.ok(found);
  assert.equal(found!.id, first.id);
});

test("getPazaakOpponentById resolves aliases", () => {
  const withAlias = pazaakOpponents.find((o) => o.aliases && o.aliases.length > 0);
  if (!withAlias) {
    // No opponent has aliases in the current dataset — skip gracefully
    return;
  }
  const alias = withAlias.aliases![0]!;
  const found = getPazaakOpponentById(alias);
  assert.ok(found);
  assert.equal(found!.id, withAlias.id);
});

test("getPazaakOpponentById returns undefined for unknown id", () => {
  assert.equal(getPazaakOpponentById("not-a-real-opponent-xyz"), undefined);
});

test("getPazaakOpponentById returns undefined for undefined input", () => {
  assert.equal(getPazaakOpponentById(undefined), undefined);
});

test("getPazaakOpponentById returns undefined for empty string", () => {
  assert.equal(getPazaakOpponentById(""), undefined);
});

// ---------------------------------------------------------------------------
// getPazaakOpponentsByDifficulty
// ---------------------------------------------------------------------------

test("getPazaakOpponentsByDifficulty returns only opponents of that difficulty", () => {
  for (const opp of pazaakOpponents) {
    const byDiff = getPazaakOpponentsByDifficulty(opp.difficulty);
    assert.ok(byDiff.some((o) => o.id === opp.id));
    assert.ok(byDiff.every((o) => o.difficulty === opp.difficulty));
  }
});

// ---------------------------------------------------------------------------
// getDefaultPazaakOpponentForAdvisorDifficulty
// ---------------------------------------------------------------------------

test("getDefaultPazaakOpponentForAdvisorDifficulty returns an opponent for each advisor level", () => {
  const levels = ["easy", "hard", "professional"] as const;
  for (const level of levels) {
    const opp = getDefaultPazaakOpponentForAdvisorDifficulty(level);
    assert.ok(opp, `Expected an opponent for advisor difficulty '${level}'`);
    assert.ok(opp.id.length > 0);
  }
});

test("easy advisor maps to novice/easy difficulty opponents", () => {
  // Run several times because it's random
  const seen = new Set<string>();
  for (let i = 0; i < 20; i += 1) {
    const opp = getDefaultPazaakOpponentForAdvisorDifficulty("easy");
    seen.add(opp.difficulty);
  }
  for (const diff of seen) {
    assert.ok(
      diff === "novice" || diff === "easy",
      `Unexpected difficulty '${diff}' for easy advisor`,
    );
  }
});

// ---------------------------------------------------------------------------
// getRandomPazaakOpponent
// ---------------------------------------------------------------------------

test("getRandomPazaakOpponent returns a valid opponent without difficulty filter", () => {
  const opp = getRandomPazaakOpponent();
  assert.ok(opp);
  assert.ok(opp.id.length > 0);
});

test("getRandomPazaakOpponent respects difficulty filter", () => {
  const opp = getRandomPazaakOpponent("novice");
  assert.equal(opp.difficulty, "novice");
});

test("getRandomPazaakOpponent with injected RNG is deterministic", () => {
  let callCount = 0;
  const deterministicRandom = () => {
    callCount += 1;
    return 0;  // always picks first in pool
  };
  const a = getRandomPazaakOpponent(undefined, deterministicRandom);
  const b = getRandomPazaakOpponent(undefined, deterministicRandom);
  assert.equal(a.id, b.id);
  assert.ok(callCount >= 2);
});

// ---------------------------------------------------------------------------
// pickPazaakOpponentPhrase
// ---------------------------------------------------------------------------

test("pickPazaakOpponentPhrase returns a string from the opponent's phrase bank", () => {
  const opp = pazaakOpponents[0]!;
  const line = pickPazaakOpponentPhrase(opp, "chosen");
  assert.ok(typeof line === "string");
  assert.ok(opp.phrases["chosen"].includes(line));
});

test("pickPazaakOpponentPhrase avoids repeating the previousLine when alternatives exist", () => {
  // Find an opponent with multiple 'play' phrases for a reliable test
  const opp = pazaakOpponents.find((o) => o.phrases["play"].length >= 2);
  if (!opp) {
    return;  // no multi-play-phrase opponent available
  }

  const previous = opp.phrases["play"][0]!;
  let sawDifferent = false;

  // Run several times — should pick something other than previous at some point
  for (let i = 0; i < 20; i += 1) {
    const line = pickPazaakOpponentPhrase(opp, "play", previous);
    if (line !== previous) {
      sawDifferent = true;
      break;
    }
  }

  assert.ok(sawDifferent, "pickPazaakOpponentPhrase never avoided the previousLine");
});

test("pickPazaakOpponentPhrase returns fallback when phrase bank is empty", () => {
  const opp = {
    ...pazaakOpponents[0]!,
    phrases: { ...pazaakOpponents[0]!.phrases, winGame: [] as string[] } as typeof pazaakOpponents[0]["phrases"],
  };
  const result = pickPazaakOpponentPhrase(opp, "winGame", undefined, "fallback text");
  assert.equal(result, "fallback text");
});
