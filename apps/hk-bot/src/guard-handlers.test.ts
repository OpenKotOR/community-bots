import assert from "node:assert/strict";
import test from "node:test";

import { formatGuardMessage, shouldTreatAsFreshJoin, shouldTrustMember } from "./guard-handlers.js";

void test("formatGuardMessage replaces common welcome placeholders", () => {
  assert.equal(
    formatGuardMessage("Statement: $mention entered $server as $user.", {
      mention: "<@123>",
      user: "Revanchist",
      server: "Ebon Hawk",
    }),
    "Statement: <@123> entered Ebon Hawk as Revanchist.",
  );
});

void test("shouldTreatAsFreshJoin gates honeypots to new members and young accounts", () => {
  const now = Date.parse("2026-05-03T21:00:00.000Z");

  assert.equal(
    shouldTreatAsFreshJoin({
      now,
      joinedTimestamp: now - 60_000,
      accountCreatedTimestamp: now - 60_000,
      ignoreMembersOlderThanMs: 3_600_000,
      ignoreAccountsOlderThanMs: 86_400_000,
    }),
    true,
  );

  assert.equal(
    shouldTreatAsFreshJoin({
      now,
      joinedTimestamp: now - 7_200_000,
      accountCreatedTimestamp: now - 60_000,
      ignoreMembersOlderThanMs: 3_600_000,
      ignoreAccountsOlderThanMs: 86_400_000,
    }),
    false,
  );
});

void test("shouldTrustMember detects trusted roles", () => {
  assert.equal(shouldTrustMember(["111111111111111111"], new Set(["111111111111111111"])), true);
  assert.equal(shouldTrustMember(["111111111111111111"], new Set(["222222222222222222"])), false);
});
