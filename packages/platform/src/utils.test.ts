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

// ---------------------------------------------------------------------------
// createObjectEnvLookup
// ---------------------------------------------------------------------------

import { createObjectEnvLookup, resolveSocialAuthProviderConfig, listSocialAuthProviders, buildSocialAuthAuthorizeUrl } from "./oauth.js";

test("createObjectEnvLookup returns a string value from the source object", () => {
  const lookup = createObjectEnvLookup({ MY_KEY: "my-value" });
  assert.equal(lookup("MY_KEY"), "my-value");
});

test("createObjectEnvLookup returns undefined for missing keys", () => {
  const lookup = createObjectEnvLookup({});
  assert.equal(lookup("MISSING"), undefined);
});

test("createObjectEnvLookup returns undefined for non-string values", () => {
  const lookup = createObjectEnvLookup({ NUM: 42, BOOL: true });
  assert.equal(lookup("NUM"), undefined);
  assert.equal(lookup("BOOL"), undefined);
});

// ---------------------------------------------------------------------------
// resolveSocialAuthProviderConfig
// ---------------------------------------------------------------------------

test("resolveSocialAuthProviderConfig marks enabled=true when clientId and clientSecret are present", () => {
  const lookup = createObjectEnvLookup({
    DISCORD_CLIENT_ID: "my-id",
    DISCORD_CLIENT_SECRET: "my-secret",
    DISCORD_CALLBACK_URL: "https://example.com/cb",
  });
  const config = resolveSocialAuthProviderConfig("discord", lookup);
  assert.equal(config.enabled, true);
  assert.equal(config.clientId, "my-id");
  assert.equal(config.clientSecret, "my-secret");
});

test("resolveSocialAuthProviderConfig marks enabled=false when clientSecret is missing", () => {
  const lookup = createObjectEnvLookup({ DISCORD_CLIENT_ID: "my-id" });
  const config = resolveSocialAuthProviderConfig("discord", lookup);
  assert.equal(config.enabled, false);
});

test("resolveSocialAuthProviderConfig resolves fallback env keys", () => {
  const lookup = createObjectEnvLookup({ ALT_DISCORD_ID: "alt-id", ALT_DISCORD_SECRET: "alt-secret" });
  const config = resolveSocialAuthProviderConfig("discord", lookup, {
    fallbackEnvKeys: {
      discord: { clientId: "ALT_DISCORD_ID", clientSecret: "ALT_DISCORD_SECRET" },
    },
  });
  assert.equal(config.clientId, "alt-id");
  assert.equal(config.enabled, true);
});

// ---------------------------------------------------------------------------
// listSocialAuthProviders
// ---------------------------------------------------------------------------

test("listSocialAuthProviders returns an entry for each of the three providers", () => {
  const lookup = createObjectEnvLookup({});
  const providers = listSocialAuthProviders(lookup);
  const ids = providers.map((p) => p.provider);
  assert.ok(ids.includes("google"));
  assert.ok(ids.includes("discord"));
  assert.ok(ids.includes("github"));
  assert.equal(ids.length, 3);
});

test("listSocialAuthProviders marks providers as disabled when env is empty", () => {
  const lookup = createObjectEnvLookup({});
  const providers = listSocialAuthProviders(lookup);
  assert.ok(providers.every((p) => !p.enabled));
});

// ---------------------------------------------------------------------------
// buildSocialAuthAuthorizeUrl
// ---------------------------------------------------------------------------

const baseInput = {
  clientId: "client-123",
  redirectUri: "https://example.com/callback",
  state: "csrf-state",
};

test("buildSocialAuthAuthorizeUrl uses startUrl template when provided", () => {
  const url = buildSocialAuthAuthorizeUrl("discord", {
    ...baseInput,
    startUrl: "https://auth.example.com/start?state={state}&cb={callback}&id={clientId}",
  });
  assert.ok(url.includes("csrf-state"), "state should be substituted");
  assert.ok(url.includes("client-123"), "clientId should be substituted");
  assert.ok(url.includes("callback"), "redirectUri should be substituted");
});

test("buildSocialAuthAuthorizeUrl builds a valid Google URL", () => {
  const url = buildSocialAuthAuthorizeUrl("google", baseInput);
  assert.ok(url.startsWith("https://accounts.google.com"));
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("client_id"), "client-123");
  assert.equal(parsed.searchParams.get("response_type"), "code");
  assert.equal(parsed.searchParams.get("state"), "csrf-state");
});

test("buildSocialAuthAuthorizeUrl builds a valid Discord URL", () => {
  const url = buildSocialAuthAuthorizeUrl("discord", baseInput);
  assert.ok(url.includes("discord.com"));
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("client_id"), "client-123");
  assert.ok(parsed.searchParams.get("scope")?.includes("identify"));
});

test("buildSocialAuthAuthorizeUrl builds a valid GitHub URL", () => {
  const url = buildSocialAuthAuthorizeUrl("github", baseInput);
  assert.ok(url.startsWith("https://github.com/login/oauth/authorize"));
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("client_id"), "client-123");
  assert.ok(parsed.searchParams.get("scope")?.includes("read:user"));
});

test("buildSocialAuthAuthorizeUrl respects custom discordApiBase", () => {
  const url = buildSocialAuthAuthorizeUrl("discord", baseInput, {
    discordApiBase: "https://discord.example.com/api/v10",
  });
  assert.ok(url.startsWith("https://discord.example.com"));
});

// ---------------------------------------------------------------------------
// parseConfiguredBases and buildApiUrl (browser.ts)
// ---------------------------------------------------------------------------

import { parseConfiguredBases, buildApiUrl, resolveBrowserApiBases } from "./browser.js";

test("parseConfiguredBases splits a comma-separated string", () => {
  const result = parseConfiguredBases("https://a.com,https://b.com,https://c.com");
  assert.deepEqual(result, ["https://a.com", "https://b.com", "https://c.com"]);
});

test("parseConfiguredBases trims whitespace around each entry", () => {
  const result = parseConfiguredBases(" https://a.com , https://b.com ");
  assert.deepEqual(result, ["https://a.com", "https://b.com"]);
});

test("parseConfiguredBases filters empty entries", () => {
  const result = parseConfiguredBases("https://a.com,,https://b.com");
  assert.deepEqual(result, ["https://a.com", "https://b.com"]);
});

test("parseConfiguredBases returns empty array for null/undefined", () => {
  assert.deepEqual(parseConfiguredBases(null), []);
  assert.deepEqual(parseConfiguredBases(undefined), []);
});

test("parseConfiguredBases returns empty array for empty string", () => {
  assert.deepEqual(parseConfiguredBases(""), []);
});

test("parseConfiguredBases handles a single entry without comma", () => {
  assert.deepEqual(parseConfiguredBases("https://example.com"), ["https://example.com"]);
});

test("buildApiUrl joins base and path correctly", () => {
  assert.equal(buildApiUrl("/api/query", "https://api.example.com"), "https://api.example.com/api/query");
});

test("buildApiUrl adds leading slash to path if missing", () => {
  assert.equal(buildApiUrl("api/query", "https://api.example.com"), "https://api.example.com/api/query");
});

test("buildApiUrl strips trailing slashes from base", () => {
  assert.equal(buildApiUrl("/api/query", "https://api.example.com///"), "https://api.example.com/api/query");
});

test("buildApiUrl returns path as-is when base is empty string", () => {
  assert.equal(buildApiUrl("/api/query", ""), "/api/query");
});

test("resolveBrowserApiBases returns configuredBases when provided", () => {
  const result = resolveBrowserApiBases({ configuredBases: ["https://my-api.com"] });
  assert.deepEqual(result, ["https://my-api.com"]);
});

test("resolveBrowserApiBases returns [''] when no location and no configuredBases", () => {
  const result = resolveBrowserApiBases({ location: undefined, configuredBases: undefined });
  assert.deepEqual(result, [""]);
});

test("resolveBrowserApiBases injects local API port for localhost", () => {
  const result = resolveBrowserApiBases({
    localApiPort: 4001,
    location: { protocol: "http:", hostname: "localhost", port: "5173" },
  });
  assert.ok(result.some((b) => b.includes("4001")));
});

// ---------------------------------------------------------------------------
// buildBrowserCorsAllowedOrigins and resolveCorsHeaders (cors.ts)
// ---------------------------------------------------------------------------

import { buildBrowserCorsAllowedOrigins, resolveCorsHeaders } from "./cors.js";

test("buildBrowserCorsAllowedOrigins includes discordsays.com when discordAppId is set", () => {
  const origins = buildBrowserCorsAllowedOrigins({ discordAppId: "123456789" });
  assert.ok(origins.some((o) => o.includes("123456789") && o.includes("discordsays.com")));
});

test("buildBrowserCorsAllowedOrigins omits discordsays.com when discordAppId is absent", () => {
  const origins = buildBrowserCorsAllowedOrigins({});
  assert.ok(!origins.some((o) => o.includes("discordsays.com")));
});

test("buildBrowserCorsAllowedOrigins includes publicWebOrigin when provided", () => {
  const origins = buildBrowserCorsAllowedOrigins({ publicWebOrigin: "https://openkotor.github.io" });
  assert.ok(origins.some((o) => o === "https://openkotor.github.io"));
});

test("buildBrowserCorsAllowedOrigins includes default local ports", () => {
  const origins = buildBrowserCorsAllowedOrigins({});
  assert.ok(origins.some((o) => o.includes("localhost:3000")));
  assert.ok(origins.some((o) => o.includes("localhost:5173")));
});

test("resolveCorsHeaders sets Allow-Origin for a matching origin", () => {
  const result = resolveCorsHeaders(
    { method: "GET", origin: "https://example.com" },
    ["https://example.com"],
  );
  assert.equal(result.headers["Access-Control-Allow-Origin"], "https://example.com");
});

test("resolveCorsHeaders does NOT set Allow-Origin for an unknown origin", () => {
  const result = resolveCorsHeaders(
    { method: "GET", origin: "https://evil.com" },
    ["https://allowed.com"],
  );
  assert.equal(result.headers["Access-Control-Allow-Origin"], undefined);
});

test("resolveCorsHeaders marks preflight correctly for OPTIONS request", () => {
  const result = resolveCorsHeaders({ method: "OPTIONS", origin: "https://example.com" }, []);
  assert.equal(result.isPreflight, true);
});

test("resolveCorsHeaders marks non-OPTIONS as not preflight", () => {
  const result = resolveCorsHeaders({ method: "POST", origin: "https://example.com" }, []);
  assert.equal(result.isPreflight, false);
});

test("resolveCorsHeaders includes Vary: Origin header", () => {
  const result = resolveCorsHeaders({ method: "GET" }, []);
  assert.equal(result.headers["Vary"], "Origin");
});
