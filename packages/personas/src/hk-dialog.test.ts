import assert from "node:assert/strict";
import test from "node:test";

import { buildHkDialogMessages, sanitizeHkDialogReply } from "./hk-dialog.js";

test("buildHkDialogMessages creates a structured system prompt with HK style and safety rules", () => {
  const messages = buildHkDialogMessages({
    task: "Rewrite a role assignment success line.",
    facts: ["User display name: Revanchist", "Role: Ebon Hawk Crew"],
    draft: "Assigned the role.",
    maxCharacters: 280,
  });

  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.role, "system");
  assert.match(messages[0]?.content ?? "", /HK-47/i);
  assert.match(messages[0]?.content ?? "", /Statement|Observation|Query|Mockery/);
  assert.match(messages[0]?.content ?? "", /Do not reveal/i);
  assert.match(messages[1]?.content ?? "", /Revanchist/);
  assert.match(messages[1]?.content ?? "", /Assigned the role/);
});

test("sanitizeHkDialogReply removes mass mentions and enforces length", () => {
  const sanitized = sanitizeHkDialogReply("@everyone Statement: Meatbags assemble for a very long diagnostic.", 32);

  assert.equal(sanitized.includes("@everyone"), false);
  assert.ok(sanitized.length <= 32);
  assert.match(sanitized, /Statement/);
});

import { hkCuratedRoles, findCuratedRoleById, groupCuratedRolesByCategory } from "./index.js";

// ---------------------------------------------------------------------------
// hkCuratedRoles data integrity
// ---------------------------------------------------------------------------

test("hkCuratedRoles array is non-empty", () => {
  assert.ok(hkCuratedRoles.length > 0);
});

test("every curated role has a non-empty id, name, and description", () => {
  for (const role of hkCuratedRoles) {
    assert.ok(role.id.length > 0, `Role missing id`);
    assert.ok(role.name.length > 0, `Role '${role.id}' missing name`);
    assert.ok(role.description.length > 0, `Role '${role.id}' missing description`);
  }
});

test("curated role ids are unique", () => {
  const ids = hkCuratedRoles.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "Duplicate curated role ids found");
});

// ---------------------------------------------------------------------------
// findCuratedRoleById
// ---------------------------------------------------------------------------

test("findCuratedRoleById returns the correct role", () => {
  const first = hkCuratedRoles[0]!;
  const result = findCuratedRoleById(first.id);
  assert.ok(result);
  assert.equal(result!.id, first.id);
});

test("findCuratedRoleById returns undefined for unknown id", () => {
  assert.equal(findCuratedRoleById("not-a-real-role-xyz"), undefined);
});

// ---------------------------------------------------------------------------
// groupCuratedRolesByCategory
// ---------------------------------------------------------------------------

test("groupCuratedRolesByCategory includes all roles", () => {
  const groups = groupCuratedRolesByCategory();
  const total = [...groups.values()].reduce((sum, arr) => sum + arr.length, 0);
  assert.equal(total, hkCuratedRoles.length);
});

test("groupCuratedRolesByCategory produces one entry per distinct category", () => {
  const groups = groupCuratedRolesByCategory();
  const distinctCategories = new Set(hkCuratedRoles.map((r) => r.category));
  assert.equal(groups.size, distinctCategories.size);
});
