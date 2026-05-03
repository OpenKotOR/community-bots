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
