import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectPolicyEnvOverrides, deepMergePolicy, loadPazaakOpsPolicy, cloneDefaultPolicy } from "./merge.js";
import { PAZAAK_POLICY_DEFAULTS } from "./defaults.js";
import { toPublicConfig } from "./public.js";
import { loadPolicyFromFile } from "./file-loader.js";

test("loadPazaakOpsPolicy merges env scalar overrides", () => {
  const policy = loadPazaakOpsPolicy({
    PAZAAK_POLICY__TIMERS__TURN_TIMER_SECONDS: "90",
    PAZAAK_POLICY__FEATURES__WORKER_MATCH_AUTHORITY: "true",
  });
  assert.equal(policy.timers.turnTimerSeconds, 90);
  assert.equal(policy.features.workerMatchAuthority, true);
});

test("collectPolicyEnvOverrides builds nested structure", () => {
  const struct = collectPolicyEnvOverrides({
    PAZAAK_POLICY__MATCHMAKING__DEFAULT_REGION_ID: "weur",
  });
  assert.equal((struct.matchmaking as { defaultRegionId: string }).defaultRegionId, "weur");
});

// ---------------------------------------------------------------------------
// cloneDefaultPolicy — produces a valid independent copy
// ---------------------------------------------------------------------------

test("cloneDefaultPolicy returns the expected version and default turnTimerSeconds", () => {
  const policy = cloneDefaultPolicy();
  assert.equal(policy.version, 1);
  assert.equal(policy.timers.turnTimerSeconds, PAZAAK_POLICY_DEFAULTS.timers.turnTimerSeconds);
});

test("cloneDefaultPolicy returns a deep clone — mutations do not affect the original defaults", () => {
  const policy = cloneDefaultPolicy();
  (policy as { timers: { turnTimerSeconds: number } }).timers.turnTimerSeconds = 999;
  // Cloning again should still return the original default
  const fresh = cloneDefaultPolicy();
  assert.equal(fresh.timers.turnTimerSeconds, PAZAAK_POLICY_DEFAULTS.timers.turnTimerSeconds);
});

// ---------------------------------------------------------------------------
// deepMergePolicy
// ---------------------------------------------------------------------------

test("deepMergePolicy merges a nested scalar override", () => {
  const base = cloneDefaultPolicy();
  const merged = deepMergePolicy(base, { timers: { turnTimerSeconds: 120 } });
  assert.equal(merged.timers.turnTimerSeconds, 120);
  // Unrelated field is preserved
  assert.equal(merged.timers.disconnectForfeitMs, PAZAAK_POLICY_DEFAULTS.timers.disconnectForfeitMs);
});

test("deepMergePolicy replaces arrays wholesale (patch wins)", () => {
  const base = cloneDefaultPolicy();
  const newRegions = [{ id: "test", label: "Test Region" }];
  const merged = deepMergePolicy(base, { matchmaking: { regions: newRegions } });
  assert.equal(merged.matchmaking.regions.length, 1);
  assert.equal(merged.matchmaking.regions[0]!.id, "test");
});

test("deepMergePolicy ignores non-object patches", () => {
  const base = cloneDefaultPolicy();
  const merged = deepMergePolicy(base, null);
  assert.equal(merged.timers.turnTimerSeconds, PAZAAK_POLICY_DEFAULTS.timers.turnTimerSeconds);
});

test("deepMergePolicy ignores array patches", () => {
  const base = cloneDefaultPolicy();
  const merged = deepMergePolicy(base, [1, 2, 3]);
  assert.equal(merged.timers.turnTimerSeconds, PAZAAK_POLICY_DEFAULTS.timers.turnTimerSeconds);
});

// ---------------------------------------------------------------------------
// loadPazaakOpsPolicy — JSON env layer
// ---------------------------------------------------------------------------

test("loadPazaakOpsPolicy applies PAZAAK_POLICY_JSON env override", () => {
  const policy = loadPazaakOpsPolicy({
    PAZAAK_POLICY_JSON: JSON.stringify({ timers: { turnTimerSeconds: 75 } }),
  });
  assert.equal(policy.timers.turnTimerSeconds, 75);
});

test("loadPazaakOpsPolicy silently ignores malformed PAZAAK_POLICY_JSON", () => {
  const policy = loadPazaakOpsPolicy({ PAZAAK_POLICY_JSON: "{bad json!!" });
  // Falls back to defaults
  assert.equal(policy.timers.turnTimerSeconds, PAZAAK_POLICY_DEFAULTS.timers.turnTimerSeconds);
});

test("loadPazaakOpsPolicy PAZAAK_POLICY__ env takes priority over PAZAAK_POLICY_JSON", () => {
  const policy = loadPazaakOpsPolicy({
    PAZAAK_POLICY_JSON: JSON.stringify({ timers: { turnTimerSeconds: 75 } }),
    PAZAAK_POLICY__TIMERS__TURN_TIMER_SECONDS: "100",
  });
  // env prefix wins over JSON
  assert.equal(policy.timers.turnTimerSeconds, 100);
});

// ---------------------------------------------------------------------------
// loadPazaakOpsPolicy — jsonOverride layer (highest priority)
// ---------------------------------------------------------------------------

test("loadPazaakOpsPolicy jsonOverride wins over all env layers", () => {
  const policy = loadPazaakOpsPolicy(
    { PAZAAK_POLICY__TIMERS__TURN_TIMER_SECONDS: "60" },
    { jsonOverride: { timers: { turnTimerSeconds: 999 } } },
  );
  assert.equal(policy.timers.turnTimerSeconds, 999);
});

test("loadPazaakOpsPolicy basePolicy is the starting point before env overrides", () => {
  const base = cloneDefaultPolicy();
  // Set a custom base value
  (base as { timers: { turnTimerSeconds: number } }).timers.turnTimerSeconds = 200;
  const policy = loadPazaakOpsPolicy({}, { basePolicy: base });
  assert.equal(policy.timers.turnTimerSeconds, 200);
});

// ---------------------------------------------------------------------------
// collectPolicyEnvOverrides — type coercion
// ---------------------------------------------------------------------------

test("collectPolicyEnvOverrides coerces boolean strings", () => {
  const result = collectPolicyEnvOverrides({ PAZAAK_POLICY__FEATURES__WORKER_MATCH_AUTHORITY: "true" });
  const features = result.features as { workerMatchAuthority: unknown };
  assert.equal(features.workerMatchAuthority, true);
});

test("collectPolicyEnvOverrides coerces integer strings", () => {
  const result = collectPolicyEnvOverrides({ PAZAAK_POLICY__TIMERS__TURN_TIMER_SECONDS: "90" });
  const timers = result.timers as { turnTimerSeconds: unknown };
  assert.equal(timers.turnTimerSeconds, 90);
});

test("collectPolicyEnvOverrides ignores keys not starting with the prefix", () => {
  const result = collectPolicyEnvOverrides({ NOT_PAZAAK_POLICY: "value", PAZAAK_OTHER: "value2" });
  assert.equal(Object.keys(result).length, 0);
});

test("collectPolicyEnvOverrides ignores keys with undefined values", () => {
  const result = collectPolicyEnvOverrides({ PAZAAK_POLICY__TIMERS__TURN_TIMER_SECONDS: undefined });
  assert.equal(Object.keys(result).length, 0);
});

// ---------------------------------------------------------------------------
// toPublicConfig — security: strips admin fields, maps correct public fields
// ---------------------------------------------------------------------------

test("toPublicConfig includes timers.turnTimerSeconds", () => {
  const policy = cloneDefaultPolicy();
  const pub = toPublicConfig(policy);
  assert.equal(pub.timers.turnTimerSeconds, policy.timers.turnTimerSeconds);
});

test("toPublicConfig does NOT expose admin.discordUserAllowlist", () => {
  const policy = cloneDefaultPolicy();
  const pub = toPublicConfig(policy);
  assert.ok(!("admin" in pub), "admin field must not appear in public config");
});

test("toPublicConfig does NOT expose progression or blackjack settings", () => {
  const policy = cloneDefaultPolicy();
  const pub = toPublicConfig(policy);
  assert.ok(!("progression" in pub));
  assert.ok(!("blackjack" in pub));
});

test("toPublicConfig includes matchmaking regions and defaultRegionId", () => {
  const policy = cloneDefaultPolicy();
  const pub = toPublicConfig(policy);
  assert.ok(pub.matchmaking.regions.length > 0);
  assert.ok(typeof pub.matchmaking.defaultRegionId === "string");
});

test("toPublicConfig exposes only the two safe feature flags", () => {
  const policy = cloneDefaultPolicy();
  const pub = toPublicConfig(policy);
  const featureKeys = Object.keys(pub.features);
  assert.ok(featureKeys.includes("blackjackOnlineEnabled"));
  assert.ok(featureKeys.includes("allowPrivateBackendUrl"));
  assert.ok(!featureKeys.includes("workerMatchAuthority"));
  assert.ok(!featureKeys.includes("dualWriteMatchesToWorker"));
});

test("toPublicConfig version is always 1", () => {
  const pub = toPublicConfig(cloneDefaultPolicy());
  assert.equal(pub.version, 1);
});

// ---------------------------------------------------------------------------
// loadPolicyFromFile — JSON and YAML roundtrips
// ---------------------------------------------------------------------------

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "pazaak-policy-test-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("loadPolicyFromFile reads a JSON file and merges onto defaults", () => {
  withTempDir((dir) => {
    const path = join(dir, "policy.json");
    writeFileSync(path, JSON.stringify({ version: 1, timers: { turnTimerSeconds: 77 } }));
    const policy = loadPolicyFromFile(path);
    assert.equal(policy.timers.turnTimerSeconds, 77);
    // Other defaults preserved
    assert.equal(policy.version, 1);
  });
});

test("loadPolicyFromFile reads a YAML file and merges onto defaults", () => {
  withTempDir((dir) => {
    const path = join(dir, "policy.yaml");
    writeFileSync(path, "version: 1\ntimers:\n  turnTimerSeconds: 88\n");
    const policy = loadPolicyFromFile(path);
    assert.equal(policy.timers.turnTimerSeconds, 88);
  });
});

test("loadPolicyFromFile accepts .yml extension", () => {
  withTempDir((dir) => {
    const path = join(dir, "policy.yml");
    writeFileSync(path, "version: 1\ntimers:\n  disconnectForfeitMs: 60000\n");
    const policy = loadPolicyFromFile(path);
    assert.equal(policy.timers.disconnectForfeitMs, 60000);
  });
});

test("loadPolicyFromFile throws on unsupported extension", () => {
  withTempDir((dir) => {
    const path = join(dir, "policy.toml");
    writeFileSync(path, "");
    assert.throws(() => loadPolicyFromFile(path), /Unsupported policy file extension/);
  });
});
