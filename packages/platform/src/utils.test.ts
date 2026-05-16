import test from "node:test";
import assert from "node:assert/strict";

import { trimTrailingSlashes, normalizeOrigin, isLocalhostUrl, isWebSocketUpgradeHeader } from "./index.js";
import { extractBearerToken, requireBearerToken } from "./bearer-tokens.js";
import { isCardGameType, normalizeCardGameType } from "./game-mode.js";
import { normalizeAuthHandlerError } from "./auth.js";
import { buildLocalWebOrigins } from "./cors.js";

// ---------------------------------------------------------------------------
// trimTrailingSlashes
// ---------------------------------------------------------------------------

test("trimTrailingSlashes removes one trailing slash", () => {
  assert.equal(trimTrailingSlashes("https://example.com/"), "https://example.com");
});

test("trimTrailingSlashes removes multiple trailing slashes", () => {
  assert.equal(trimTrailingSlashes("https://example.com///"), "https://example.com");
});

test("trimTrailingSlashes is idempotent when no trailing slash", () => {
  assert.equal(trimTrailingSlashes("https://example.com"), "https://example.com");
});

test("trimTrailingSlashes handles empty string", () => {
  assert.equal(trimTrailingSlashes(""), "");
});

// ---------------------------------------------------------------------------
// normalizeOrigin
// ---------------------------------------------------------------------------

test("normalizeOrigin extracts origin from a full URL", () => {
  assert.equal(normalizeOrigin("https://example.com/path?q=1"), "https://example.com");
});

test("normalizeOrigin trims whitespace", () => {
  assert.equal(normalizeOrigin("  https://example.com  "), "https://example.com");
});

test("normalizeOrigin returns undefined for undefined input", () => {
  assert.equal(normalizeOrigin(undefined), undefined);
});

test("normalizeOrigin returns undefined for empty string", () => {
  assert.equal(normalizeOrigin(""), undefined);
});

test("normalizeOrigin falls back to trimmed string for invalid URL", () => {
  const result = normalizeOrigin("localhost:3000/");
  assert.ok(result);
  assert.ok(!result.endsWith("/"));
});

// ---------------------------------------------------------------------------
// isLocalhostUrl
// ---------------------------------------------------------------------------

test("isLocalhostUrl returns true for localhost URLs", () => {
  assert.equal(isLocalhostUrl("http://localhost:3000"), true);
  assert.equal(isLocalhostUrl("http://localhost"), true);
});

test("isLocalhostUrl returns true for 127.0.0.1", () => {
  assert.equal(isLocalhostUrl("http://127.0.0.1:4001"), true);
});

test("isLocalhostUrl returns false for public URLs", () => {
  assert.equal(isLocalhostUrl("https://example.com"), false);
  assert.equal(isLocalhostUrl("https://api.openkotor.com"), false);
});

// ---------------------------------------------------------------------------
// isWebSocketUpgradeHeader
// ---------------------------------------------------------------------------

test("isWebSocketUpgradeHeader returns true for 'websocket' (case-insensitive)", () => {
  assert.equal(isWebSocketUpgradeHeader("websocket"), true);
  assert.equal(isWebSocketUpgradeHeader("WebSocket"), true);
  assert.equal(isWebSocketUpgradeHeader("WEBSOCKET"), true);
});

test("isWebSocketUpgradeHeader returns false for null/undefined", () => {
  assert.equal(isWebSocketUpgradeHeader(null), false);
  assert.equal(isWebSocketUpgradeHeader(undefined), false);
});

test("isWebSocketUpgradeHeader returns false for other values", () => {
  assert.equal(isWebSocketUpgradeHeader("http/1.1"), false);
  assert.equal(isWebSocketUpgradeHeader(""), false);
});

// ---------------------------------------------------------------------------
// extractBearerToken / requireBearerToken
// ---------------------------------------------------------------------------

test("extractBearerToken extracts the token from a valid header", () => {
  assert.equal(extractBearerToken("Bearer mytoken123"), "mytoken123");
});

test("extractBearerToken is case-insensitive on 'Bearer'", () => {
  assert.equal(extractBearerToken("bearer mytoken"), "mytoken");
  assert.equal(extractBearerToken("BEARER abc"), "abc");
});

test("extractBearerToken returns null for null/undefined", () => {
  assert.equal(extractBearerToken(null), null);
  assert.equal(extractBearerToken(undefined), null);
});

test("extractBearerToken returns null for empty string", () => {
  assert.equal(extractBearerToken(""), null);
});

test("extractBearerToken returns null for header without Bearer prefix", () => {
  assert.equal(extractBearerToken("Basic dXNlcjpwYXNz"), null);
  assert.equal(extractBearerToken("justtoken"), null);
});

test("requireBearerToken returns the token when present", () => {
  assert.equal(requireBearerToken("Bearer valid-token"), "valid-token");
});

test("requireBearerToken throws 401 when header is missing", () => {
  assert.throws(
    () => requireBearerToken(undefined),
    (err: { status?: number }) => {
      assert.equal(err.status, 401);
      return true;
    },
  );
});

test("requireBearerToken throws 401 for malformed header", () => {
  assert.throws(
    () => requireBearerToken("Basic dXNlcjpwYXNz"),
    (err: { status?: number }) => {
      assert.equal(err.status, 401);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// isCardGameType / normalizeCardGameType
// ---------------------------------------------------------------------------

test("isCardGameType returns true for known game types", () => {
  assert.equal(isCardGameType("pazaak"), true);
  assert.equal(isCardGameType("blackjack"), true);
  assert.equal(isCardGameType("poker"), true);
});

test("isCardGameType returns false for unknown values", () => {
  assert.equal(isCardGameType("chess"), false);
  assert.equal(isCardGameType(""), false);
  assert.equal(isCardGameType(null), false);
  assert.equal(isCardGameType(42), false);
});

test("normalizeCardGameType returns the value when it is a valid game type", () => {
  assert.equal(normalizeCardGameType("pazaak"), "pazaak");
  assert.equal(normalizeCardGameType("blackjack"), "blackjack");
});

test("normalizeCardGameType returns the fallback for unknown values", () => {
  assert.equal(normalizeCardGameType("chess"), "blackjack");
  assert.equal(normalizeCardGameType(null), "blackjack");
  assert.equal(normalizeCardGameType(undefined), "blackjack");
});

test("normalizeCardGameType respects a custom fallback", () => {
  assert.equal(normalizeCardGameType("invalid", "pazaak"), "pazaak");
});

// ---------------------------------------------------------------------------
// normalizeAuthHandlerError
// ---------------------------------------------------------------------------

test("normalizeAuthHandlerError extracts status from Error with status property", () => {
  const err = Object.assign(new Error("Unauthorized"), { status: 401 });
  const result = normalizeAuthHandlerError(err);
  assert.equal(result.status, 401);
  assert.equal(result.message, "Unauthorized");
});

test("normalizeAuthHandlerError defaults status to 500 when not present", () => {
  const result = normalizeAuthHandlerError(new Error("Unknown failure"));
  assert.equal(result.status, 500);
  assert.equal(result.message, "Unknown failure");
});

test("normalizeAuthHandlerError handles plain string", () => {
  const result = normalizeAuthHandlerError("Something bad");
  assert.equal(result.status, 500);
  assert.equal(result.message, "Something bad");
});

test("normalizeAuthHandlerError handles an object with status but no message", () => {
  const result = normalizeAuthHandlerError({ status: 403 });
  assert.equal(result.status, 403);
  assert.ok(typeof result.message === "string");
});

// ---------------------------------------------------------------------------
// buildLocalWebOrigins
// ---------------------------------------------------------------------------

test("buildLocalWebOrigins generates http://localhost and 127.0.0.1 pairs for each port", () => {
  const origins = buildLocalWebOrigins([3000]);
  assert.ok(origins.includes("http://localhost:3000"));
  assert.ok(origins.includes("http://127.0.0.1:3000"));
  assert.equal(origins.length, 2);
});

test("buildLocalWebOrigins handles multiple ports", () => {
  const origins = buildLocalWebOrigins([3000, 5173]);
  assert.equal(origins.length, 4);
});

test("buildLocalWebOrigins uses DEFAULT_LOCAL_WEB_PORTS when called with no args", () => {
  const origins = buildLocalWebOrigins();
  assert.ok(origins.length >= 6);  // at least 3 default ports × 2
});
