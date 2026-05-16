import test from "node:test";
import assert from "node:assert/strict";

import { toErrorMessage, formatDuration, mentionUser, createLogger } from "./index.js";

// ---------------------------------------------------------------------------
// toErrorMessage
// ---------------------------------------------------------------------------

test("toErrorMessage returns the message of an Error instance", () => {
  assert.equal(toErrorMessage(new Error("something went wrong")), "something went wrong");
});

test("toErrorMessage converts a plain string", () => {
  assert.equal(toErrorMessage("raw error string"), "raw error string");
});

test("toErrorMessage converts a number", () => {
  assert.equal(toErrorMessage(42), "42");
});

test("toErrorMessage converts null", () => {
  assert.equal(toErrorMessage(null), "null");
});

test("toErrorMessage converts an object via String()", () => {
  assert.equal(toErrorMessage({ code: 404 }), "[object Object]");
});

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

test("formatDuration formats sub-minute as seconds", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(500), "0s");
  assert.equal(formatDuration(1000), "1s");
  assert.equal(formatDuration(59_000), "59s");
  assert.equal(formatDuration(59_999), "59s");
});

test("formatDuration formats exactly 1 minute", () => {
  assert.equal(formatDuration(60_000), "1m 0s");
});

test("formatDuration formats minutes and seconds", () => {
  assert.equal(formatDuration(90_000), "1m 30s");
  assert.equal(formatDuration(3_661_000), "61m 1s");
});

test("formatDuration floors partial seconds", () => {
  assert.equal(formatDuration(1_500), "1s");
  assert.equal(formatDuration(61_999), "1m 1s");
});

// ---------------------------------------------------------------------------
// mentionUser
// ---------------------------------------------------------------------------

test("mentionUser wraps userId in Discord mention format", () => {
  assert.equal(mentionUser("123456789"), "<@123456789>");
});

test("mentionUser works with arbitrary string user ids", () => {
  const mention = mentionUser("user-abc");
  assert.equal(mention, "<@user-abc>");
  assert.ok(mention.startsWith("<@"));
  assert.ok(mention.endsWith(">"));
});

// ---------------------------------------------------------------------------
// createLogger — smoke test (does not throw, returns expected shape)
// ---------------------------------------------------------------------------

test("createLogger returns an object with info/warn/error/debug methods", () => {
  const logger = createLogger("test-scope");
  assert.equal(typeof logger.info, "function");
  assert.equal(typeof logger.warn, "function");
  assert.equal(typeof logger.error, "function");
  assert.equal(typeof logger.debug, "function");
});

test("createLogger methods do not throw when called with a message", () => {
  const logger = createLogger("smoke");
  assert.doesNotThrow(() => logger.info("test message"));
  assert.doesNotThrow(() => logger.warn("test warning", { detail: "extra" }));
  assert.doesNotThrow(() => logger.error("test error", new Error("inner")));
  assert.doesNotThrow(() => logger.debug("debug msg", null));
});
