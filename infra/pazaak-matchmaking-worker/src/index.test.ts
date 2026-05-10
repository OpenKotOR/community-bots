import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMatchActorCreatePayload,
  normalizeLobbyRoundAndTimerSettings,
  selectAccountByUsernameOrEmail,
} from "./lobby-auth-helpers.js";

test("selectAccountByUsernameOrEmail ignores null-email collisions", () => {
  const accounts = {
    a: {
      accountId: "a",
      username: "alpha",
      displayName: "Alpha",
      email: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      mmr: 1000,
      mmrRd: 350,
    },
    b: {
      accountId: "b",
      username: "beta",
      displayName: "Beta",
      email: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      mmr: 1000,
      mmrRd: 350,
    },
  };

  const byUsername = selectAccountByUsernameOrEmail(accounts, "beta", null);
  assert.equal(byUsername?.accountId, "b");

  const byEmailWhenNull = selectAccountByUsernameOrEmail(accounts, "missing", null);
  assert.equal(byEmailWhenNull, undefined);
});

test("normalizeLobbyRoundAndTimerSettings preserves explicit zero timer", () => {
  const normalized = normalizeLobbyRoundAndTimerSettings({
    maxRounds: 5,
    turnTimerSeconds: 0,
  });

  assert.equal(normalized.maxRounds, 5);
  assert.equal(normalized.turnTimerSeconds, 0);
});

test("normalizeLobbyRoundAndTimerSettings clamps and defaults invalid values", () => {
  const normalized = normalizeLobbyRoundAndTimerSettings({
    maxRounds: Number.NaN,
    turnTimerSeconds: Number.POSITIVE_INFINITY,
  });

  assert.equal(normalized.maxRounds, 3);
  assert.equal(normalized.turnTimerSeconds, 45);

  const clamped = normalizeLobbyRoundAndTimerSettings({
    maxRounds: 99,
    turnTimerSeconds: -20,
  });

  assert.equal(clamped.maxRounds, 9);
  assert.equal(clamped.turnTimerSeconds, 0);
});

test("buildMatchActorCreatePayload maps lobby mutators to actor payload", () => {
  const payload = buildMatchActorCreatePayload({
    matchId: "m1",
    playerOneId: "p1",
    playerOneName: "Host",
    playerTwoId: "p2",
    playerTwoName: "Join",
    gameMode: "wacky",
    maxRounds: 7,
    turnTimerSeconds: 60,
  });

  assert.deepEqual(payload, {
    matchId: "m1",
    playerOneId: "p1",
    playerOneName: "Host",
    playerTwoId: "p2",
    playerTwoName: "Join",
    gameMode: "wacky",
    setsToWin: 7,
    turnTimeoutMs: 60000,
  });
});
