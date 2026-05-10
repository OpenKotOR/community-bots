import {
  DEFAULT_SOCIAL_AUTH_PROVIDER_ENV_MAP,
  PAZAAK_SOCIAL_AUTH_PROVIDER_ENV_MAP,
  buildSocialAuthAuthorizeUrl,
  createObjectEnvLookup,
  fetchDiscordSocialAuthProfile,
  fetchGithubSocialAuthProfile,
  fetchGoogleSocialAuthProfile,
  resolveSocialAuthProviderConfig,
  type EnvLookup,
} from "@openkotor/platform/oauth";
import {
  advanceTournament,
  buildBracketView,
  computeSwissStandings,
  createTournament,
  registerParticipant,
  startTournament,
  withdrawParticipant,
  type TournamentFormat,
  type TournamentState,
} from "@openkotor/pazaak-tournament";
import type { SerializedMatch } from "@openkotor/pazaak-engine";
import {
  deepMergePolicy,
  loadPazaakOpsPolicy,
  parsePolicyJson,
  toPublicConfig,
  type PazaakOpsPolicy,
} from "@openkotor/pazaak-policy";

import { MatchActor } from "./match-actor.js";
import {
  buildMatchActorCreatePayload,
  normalizeLobbyRoundAndTimerSettings,
  selectAccountByUsernameOrEmail,
} from "./lobby-auth-helpers.js";

export { MatchActor };

interface Env {
  COORDINATOR: DurableObjectNamespace;
  RELAY_ROOM: DurableObjectNamespace;
  MATCH_ACTOR: DurableObjectNamespace;
  SERVICE_NAME?: string;
  SESSION_JWT_SECRET?: string;
  PAZAAK_SESSION_JWT_SECRET?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_PUBLIC_CLIENT?: string;
  DISCORD_REDIRECT_URI?: string;
  PAZAAK_DISCORD_APP_ID?: string;
  PAZAAK_DISCORD_CLIENT_SECRET?: string;
  DISCORD_BOT_TOKEN?: string;
  ALLOW_UNVERIFIED_INSTANCES?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_REDIRECT_URI?: string;
  PAZAAK_OAUTH_GITHUB_CLIENT_ID?: string;
  PAZAAK_OAUTH_GITHUB_CLIENT_SECRET?: string;
  PAZAAK_OAUTH_GITHUB_CALLBACK_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  PAZAAK_OAUTH_GOOGLE_CLIENT_ID?: string;
  PAZAAK_OAUTH_GOOGLE_CLIENT_SECRET?: string;
  PAZAAK_OAUTH_GOOGLE_CALLBACK_URL?: string;
  PAZAAK_OAUTH_DISCORD_CLIENT_ID?: string;
  PAZAAK_OAUTH_DISCORD_CLIENT_SECRET?: string;
  PAZAAK_OAUTH_DISCORD_CALLBACK_URL?: string;
  PUBLIC_WEB_ORIGIN?: string;
  PAZAAK_POLICY_JSON?: string;
  ADMIN_USER_IDS?: string;
  PAZAAK_TURN_TIMEOUT_MS?: string;
  PAZAAK_DISCONNECT_FORFEIT_MS?: string;
  PAZAAK_BOT_SYNC_SECRET?: string;
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type Json = Record<string, JsonValue>;

type AccountState = {
  accountId: string;
  username: string;
  displayName: string;
  email: string | null;
  createdAt: string;
  updatedAt: string;
  mmr: number;
  /** Matches persistence default (Chess.com-style high RD for new accounts). */
  mmrRd?: number;
};

type SessionState = {
  sessionId: string;
  token: string;
  accountId: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
};

type QueueEntry = {
  userId: string;
  displayName: string;
  mmr: number;
  preferredMaxPlayers: number;
  enqueuedAt: string;
  preferredRegions: string[];
  enqueuedAtMs: number;
};

type LobbyPlayer = {
  userId: string;
  displayName: string;
  ready: boolean;
  isHost: boolean;
  isAi: boolean;
  joinedAt: string;
};

type LobbyRecord = {
  id: string;
  lobbyCode: string;
  name: string;
  hostUserId: string;
  maxPlayers: number;
  tableSettings: {
    variant: "canonical" | "multi_seat";
    maxPlayers: number;
    maxRounds: number;
    turnTimerSeconds: number;
    ranked: boolean;
    allowAiFill: boolean;
    sideboardMode: "runtime_random" | "player_active_custom" | "host_mirror_custom";
    gameMode: "canonical" | "wacky";
  };
  passwordHash: string | null;
  status: "waiting" | "matchmaking" | "in_game" | "closed";
  matchId: string | null;
  players: LobbyPlayer[];
  createdAt: string;
  updatedAt: string;
};

type PolicyRuntimeState = {
  blob: unknown;
  etag: string;
  updatedAt: string;
};

type AuditEntry = {
  at: string;
  actorId: string;
  action: string;
  detail: JsonValue | null;
};

type StorageShape = {
  accounts: Record<string, AccountState>;
  sessions: Record<string, SessionState>;
  queue: QueueEntry[];
  lobbies: LobbyRecord[];
  tournaments: Record<string, TournamentState>;
  oauthStates: Record<string, { provider: string; expiresAt: number; pendingMatchId?: string; codeVerifier?: string }>;
  policyRuntime?: PolicyRuntimeState;
  auditLog?: AuditEntry[];
};

type RelayMember = {
  ws: WebSocket;
  userId: string;
  username: string;
  seatIndex: number;
  color: string;
};

type RelayVerifyEntry = {
  ok: boolean;
  expiresAt: number;
};

type SessionTokenClaims = {
  iss: string;
  aud: string;
  sub: string;
  sid: string;
  iat: number;
  exp: number;
  typ: "access";
  v: 1;
};

const DEFAULT_SETTINGS = {
  theme: "kotor",
  soundEnabled: true,
  reducedMotionEnabled: false,
  turnTimerSeconds: 45,
  preferredAiDifficulty: "normal",
};

const SESSION_JWT_ISSUER = "openkotor-pazaak";
const SESSION_JWT_AUDIENCE = "pazaak-world";
const SESSION_TOKEN_VERSION = 1;
const MIN_SIGNING_SECRET_LENGTH = 32;
const BOT_SYNC_SIGNATURE_MAX_AGE_SECONDS = 5 * 60;

const SOCIAL_PROVIDERS = ["discord", "github", "google"] as const;
type WorkerSocialProvider = (typeof SOCIAL_PROVIDERS)[number];

function isDiscordPublicClientEnabled(env: Env): boolean {
  const value = env.DISCORD_PUBLIC_CLIENT?.trim().toLowerCase() ?? "";
  // Default to PKCE public-client mode unless explicitly disabled.
  if (!value) {
    return true;
  }
  if (value === "0" || value === "false" || value === "no" || value === "off") {
    return false;
  }
  return true;
}

/**
 * `resolveSocialAuthProviderConfig` prefers `PAZAAK_OAUTH_*` keys over `GOOGLE_*` / `GITHUB_*`.
 * On Workers we commonly set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` via Wrangler; an older
 * `PAZAAK_OAUTH_GOOGLE_CLIENT_ID` secret would incorrectly win and cause Google `invalid_client`.
 * When the Wrangler-style pair is complete, hide PAZAAK_* so fallbacks apply (same for GitHub).
 */
function createWorkerSocialAuthLookup(env: Env): EnvLookup {
  const base = createObjectEnvLookup(env);
  const sanitizeOauthEnvValue = (value: string | undefined): string => {
    if (!value) {
      return "";
    }
    // Drop control characters so malformed secret values cannot produce bogus OAuth client IDs.
    return value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  };
  const t = (key: string) => sanitizeOauthEnvValue(base(key));
  const discordPairComplete = t("DISCORD_CLIENT_ID") !== "" && t("DISCORD_CLIENT_SECRET") !== "";
  const googlePairComplete = t("GOOGLE_CLIENT_ID") !== "" && t("GOOGLE_CLIENT_SECRET") !== "";
  const githubPairComplete = t("GITHUB_CLIENT_ID") !== "" && t("GITHUB_CLIENT_SECRET") !== "";

  return (key: string) => {
    if (discordPairComplete) {
      if (
        key === "PAZAAK_OAUTH_DISCORD_CLIENT_ID" ||
        key === "PAZAAK_OAUTH_DISCORD_CLIENT_SECRET" ||
        key === "PAZAAK_OAUTH_DISCORD_CALLBACK_URL" ||
        key === "PAZAAK_OAUTH_DISCORD_URL"
      ) {
        return undefined;
      }
    }
    if (googlePairComplete) {
      if (
        key === "PAZAAK_OAUTH_GOOGLE_CLIENT_ID" ||
        key === "PAZAAK_OAUTH_GOOGLE_CLIENT_SECRET" ||
        key === "PAZAAK_OAUTH_GOOGLE_CALLBACK_URL" ||
        key === "PAZAAK_OAUTH_GOOGLE_URL"
      ) {
        return undefined;
      }
    }
    if (githubPairComplete) {
      if (
        key === "PAZAAK_OAUTH_GITHUB_CLIENT_ID" ||
        key === "PAZAAK_OAUTH_GITHUB_CLIENT_SECRET" ||
        key === "PAZAAK_OAUTH_GITHUB_CALLBACK_URL" ||
        key === "PAZAAK_OAUTH_GITHUB_URL"
      ) {
        return undefined;
      }
    }
    return t(key) || undefined;
  };
}

function buildOauthLandingRedirect(env: Env, callbackBase: string): URL {
  const landingBase = env.PUBLIC_WEB_ORIGIN?.trim() || callbackBase;
  try {
    const target = new URL(landingBase);
    // OAuth callback parameters are encoded on the landing URL itself.
    target.search = "";
    target.hash = "";
    return target;
  } catch {
    return new URL(callbackBase);
  }
}

function resolveOauthProviderConfig(env: Env, provider: WorkerSocialProvider) {
  const lookup = createWorkerSocialAuthLookup(env);
  let config = resolveSocialAuthProviderConfig(provider, lookup, {
    envMap: PAZAAK_SOCIAL_AUTH_PROVIDER_ENV_MAP,
    fallbackEnvKeys: {
      google: DEFAULT_SOCIAL_AUTH_PROVIDER_ENV_MAP.google,
      discord: DEFAULT_SOCIAL_AUTH_PROVIDER_ENV_MAP.discord,
      github: DEFAULT_SOCIAL_AUTH_PROVIDER_ENV_MAP.github,
    },
  });
  if (provider === "discord") {
    if (!config.clientId) {
      config = { ...config, clientId: env.PAZAAK_DISCORD_APP_ID?.trim() ?? "" };
    }
    if (!config.clientSecret) {
      config = { ...config, clientSecret: env.PAZAAK_DISCORD_CLIENT_SECRET?.trim() ?? "" };
    }
  }
  return config;
}

function oauthRedirectUriForProvider(provider: WorkerSocialProvider, callbackBase: string, callbackOverride: string): string {
  if (callbackOverride) return callbackOverride;
  if (provider === "discord") return `${callbackBase}/api/auth/oauth/discord/callback`;
  if (provider === "github") return `${callbackBase}/api/auth/oauth/github/callback`;
  return `${callbackBase}/api/auth/oauth/google/callback`;
}

function getOauthProviders(env: Env): { providers: Array<{ provider: string; enabled: boolean }> } {
  return {
    providers: SOCIAL_PROVIDERS.map((provider) => {
      const config = resolveOauthProviderConfig(env, provider);
      return {
        provider,
        enabled: Boolean(config.clientId && config.clientSecret),
      };
    }).map((entry) => ({
      provider: entry.provider,
      enabled: entry.enabled,
    })),
  };
}

const DISCORD_API = "https://discord.com/api/v10";
const RELAY_SEAT_COLORS = ["#ff6b6b", "#4dd0ff", "#9cff7a", "#ffd166"];
const RELAY_VERIFY_TTL_MS = 30_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,content-type",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
};

function json(data: JsonValue | object, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function readLobbyWackyGameMode(payload: Json): boolean {
  if (payload.gameMode === "wacky") {
    return true;
  }
  const tableSettings = payload.tableSettings;
  if (tableSettings !== null && typeof tableSettings === "object" && !Array.isArray(tableSettings)) {
    const gm = (tableSettings as Record<string, JsonValue>).gameMode;
    return gm === "wacky";
  }
  return false;
}

function empty(status = 204): Response {
  return new Response(null, { status, headers: corsHeaders });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function nowIso(): string {
  return new Date().toISOString();
}

function plusDaysIso(days: number): string {
  return new Date(Date.now() + (days * 24 * 60 * 60 * 1000)).toISOString();
}

function isoToEpochSeconds(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000);
}

function stringToBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  const maxLength = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}

function decodeBase64UrlJson<T>(value: string): T | null {
  try {
    const bytes = base64UrlToBytes(value);
    const jsonText = new TextDecoder().decode(bytes);
    return JSON.parse(jsonText) as T;
  } catch {
    return null;
  }
}

function resolveSessionSigningSecret(env: Env): string {
  const candidates = [
    env.PAZAAK_SESSION_JWT_SECRET,
    env.SESSION_JWT_SECRET,
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value) {
      if (value.length < MIN_SIGNING_SECRET_LENGTH) {
        throw new Error(`Session signing secret must be at least ${MIN_SIGNING_SECRET_LENGTH} characters.`);
      }
      return value;
    }
  }
  if (env.ALLOW_UNVERIFIED_INSTANCES === "1") {
    return `${env.SERVICE_NAME?.trim() || "openkotor-pazaak"}-dev-session-secret`;
  }
  throw new Error("Missing session signing secret. Set PAZAAK_SESSION_JWT_SECRET or SESSION_JWT_SECRET.");
}

async function importHmacSigningKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function importSessionSigningKey(env: Env): Promise<CryptoKey> {
  return importHmacSigningKey(resolveSessionSigningSecret(env));
}

async function verifyBotSyncSignature(secret: string, timestampHeader: string, signatureHeader: string, bodyText: string): Promise<boolean> {
  if (!/^\d{10}$/.test(timestampHeader)) {
    return false;
  }
  const timestampSeconds = Number(timestampHeader);
  if (!Number.isSafeInteger(timestampSeconds)) {
    return false;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > BOT_SYNC_SIGNATURE_MAX_AGE_SECONDS) {
    return false;
  }

  let providedSignature: Uint8Array;
  try {
    providedSignature = base64UrlToBytes(signatureHeader);
  } catch {
    return false;
  }

  const signingInput = `${timestampHeader}.${bodyText}`;
  const expectedSignature = new Uint8Array(
    await crypto.subtle.sign("HMAC", await importHmacSigningKey(secret), new TextEncoder().encode(signingInput)),
  );
  return timingSafeEqualBytes(providedSignature, expectedSignature);
}

async function createSignedSessionToken(accountId: string, sessionId: string, expiresAt: string, env: Env): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const claims: SessionTokenClaims = {
    iss: SESSION_JWT_ISSUER,
    aud: SESSION_JWT_AUDIENCE,
    sub: accountId,
    sid: sessionId,
    iat: nowSeconds,
    exp: isoToEpochSeconds(expiresAt),
    typ: "access",
    v: SESSION_TOKEN_VERSION,
  };
  const header = stringToBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = stringToBase64Url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign("HMAC", await importSessionSigningKey(env), new TextEncoder().encode(signingInput));
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function verifySignedSessionToken(token: string, env: Env): Promise<SessionTokenClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodeBase64UrlJson<{ alg?: string; typ?: string }>(headerPart);
  const claims = decodeBase64UrlJson<SessionTokenClaims>(payloadPart);
  if (!header || !claims) {
    return null;
  }
  if (header.alg !== "HS256" || header.typ !== "JWT") {
    return null;
  }
  if (
    claims.iss !== SESSION_JWT_ISSUER
    || claims.aud !== SESSION_JWT_AUDIENCE
    || claims.typ !== "access"
    || claims.v !== SESSION_TOKEN_VERSION
    || !claims.sid
    || !claims.sub
  ) {
    return null;
  }
  if (claims.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }
  const verified = await crypto.subtle.verify(
    "HMAC",
    await importSessionSigningKey(env),
    base64UrlToBytes(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  return verified ? claims : null;
}

async function createSessionRecord(accountId: string, env: Env): Promise<SessionState> {
  const createdAt = nowIso();
  const expiresAt = plusDaysIso(30);
  const sessionId = crypto.randomUUID();
  const token = await createSignedSessionToken(accountId, sessionId, expiresAt, env);
  return {
    sessionId,
    token,
    accountId,
    createdAt,
    lastUsedAt: createdAt,
    expiresAt,
  };
}

function parseAuthToken(req: Request): string | null {
  const value = req.headers.get("authorization");
  if (!value) return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function envToRecord(env: Env): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = typeof value === "string" ? value : undefined;
  }
  return out;
}

function resolvePolicy(env: Env, state: StorageShape): PazaakOpsPolicy {
  return loadPazaakOpsPolicy(envToRecord(env), { jsonOverride: state.policyRuntime?.blob });
}

function isAdminAccount(accountId: string, policy: PazaakOpsPolicy, env: Env): boolean {
  const extra = (env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return policy.admin.discordUserAllowlist.includes(accountId) || extra.includes(accountId);
}

function pickLocationHint(ra: string[], rb: string[], policy: PazaakOpsPolicy): string | undefined {
  const regs = policy.matchmaking.regions;
  const hintOf = (id: string) => regs.find((r) => r.id === id)?.locationHint;
  const shared = ra.find((r) => r !== "auto" && rb.includes(r));
  if (shared) {
    return hintOf(shared);
  }
  const nonAuto = ra.concat(rb).find((r) => r !== "auto");
  if (nonAuto) {
    return hintOf(nonAuto);
  }
  return hintOf(policy.matchmaking.defaultRegionId) ?? hintOf("enam");
}

function pushAudit(state: StorageShape, actorId: string, action: string, detail: JsonValue | null): void {
  const log = state.auditLog ?? [];
  log.push({ at: nowIso(), actorId, action, detail });
  state.auditLog = log.slice(-200);
}

function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get("Upgrade")?.toLowerCase() === "websocket";
}

async function handleDiscordTokenExchange(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return error("Method not allowed", 405);
  }

  const body = await request.json<Json>().catch(() => ({} as Json));
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) {
    return error("Missing authorization code", 400);
  }

  const clientId = env.DISCORD_CLIENT_ID?.trim();
  const clientSecret = env.DISCORD_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return error("Discord token exchange is not configured", 500);
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
  });
  const redirectUri = env.DISCORD_REDIRECT_URI?.trim();
  if (redirectUri) {
    params.set("redirect_uri", redirectUri);
  }

  const response = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const payload = await response.json().catch(() => ({ error: "Invalid Discord token response" })) as JsonValue;
  return json(payload, response.status);
}

function toSlug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "guest";
}

function randomCode(length: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return result;
}

// ---------------------------------------------------------------------------
// OAuth state TTL. State is persisted in the coordinator Durable Object so
// callback validation survives worker isolate changes between start/callback.
// ---------------------------------------------------------------------------
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

async function createWorkerOauthState(
  provider: WorkerSocialProvider,
  pendingMatchId: string | undefined,
  codeVerifier: string | undefined,
  coordinatorStub: { fetch(req: Request): Promise<Response> },
): Promise<string> {
  const response = await coordinatorStub.fetch(new Request("http://internal/api/auth/oauth/state/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, pendingMatchId, codeVerifier }),
  }));
  if (!response.ok) {
    throw new Error(`Failed to create OAuth state for ${provider}.`);
  }
  const payload = await response.json() as { state?: string };
  if (!payload.state) {
    throw new Error(`OAuth state response missing state token for ${provider}.`);
  }
  return payload.state;
}

async function consumeWorkerOauthState(
  state: string,
  provider: WorkerSocialProvider,
  coordinatorStub: { fetch(req: Request): Promise<Response> },
): Promise<{ pendingMatchId?: string; codeVerifier?: string } | null> {
  const response = await coordinatorStub.fetch(new Request("http://internal/api/auth/oauth/state/consume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, provider }),
  }));
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to consume OAuth state for ${provider}.`);
  }
  const payload = await response.json() as { pendingMatchId?: string | null; codeVerifier?: string | null };
  return {
    ...(payload.pendingMatchId ? { pendingMatchId: payload.pendingMatchId } : {}),
    ...(payload.codeVerifier ? { codeVerifier: payload.codeVerifier } : {}),
  };
}

function randomPkceVerifier(length = 64): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return result;
}

async function toPkceS256Challenge(codeVerifier: string): Promise<string> {
  const bytes = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = String.fromCharCode(...new Uint8Array(digest));
  return btoa(hash).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function buildProviderAuthorizeUrl(
  provider: WorkerSocialProvider,
  state: string,
  env: Env,
  callbackBase: string,
  discordPkce?: { codeChallenge: string; method: "S256" | "plain" },
): string {
  if (provider !== "discord" && provider !== "github" && provider !== "google") {
    throw new Error(`Unsupported provider: ${provider}`);
  }
  const config = resolveOauthProviderConfig(env, provider);

  const authorizeUrl = buildSocialAuthAuthorizeUrl(provider, {
    clientId: config.clientId,
    redirectUri: oauthRedirectUriForProvider(provider, callbackBase, config.callbackUrl),
    state,
  }, {
    discordApiBase: DISCORD_API,
    discordPrompt: provider === "discord" ? "none" : undefined,
  });

  if (provider === "discord" && discordPkce) {
    const url = new URL(authorizeUrl);
    url.searchParams.set("code_challenge", discordPkce.codeChallenge);
    url.searchParams.set("code_challenge_method", discordPkce.method);
    return url.toString();
  }

  return authorizeUrl;
}

async function handleOauthStart(
  request: Request,
  env: Env,
  provider: WorkerSocialProvider,
  callbackBase: string,
  coordinatorStub: { fetch(req: Request): Promise<Response> },
): Promise<Response> {
  if (request.method !== "POST") return error("Method not allowed", 405);
  let pendingMatchId: string | undefined;
  const discordPkceEnabled = provider === "discord" && isDiscordPublicClientEnabled(env);
  const codeVerifier = discordPkceEnabled ? randomPkceVerifier() : undefined;
  const codeChallenge = codeVerifier ? await toPkceS256Challenge(codeVerifier) : undefined;
  try {
    const body = await request.json<Json>();
    if (typeof body.matchId === "string" && body.matchId.trim()) pendingMatchId = body.matchId.trim();
  } catch { /* body may be empty */ }
  const state = await createWorkerOauthState(provider, pendingMatchId, codeVerifier, coordinatorStub);
  const redirectUrl = buildProviderAuthorizeUrl(
    provider,
    state,
    env,
    callbackBase,
    codeChallenge ? { codeChallenge, method: "S256" } : undefined,
  );
  return json({ provider, redirectUrl });
}

async function handleOauthCallback(request: Request, env: Env, provider: WorkerSocialProvider, callbackBase: string, coordinatorStub: { fetch(req: Request): Promise<Response> }): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const oauthError = url.searchParams.get("error") ?? "";
  const redirect = buildOauthLandingRedirect(env, callbackBase);

  if (oauthError) {
    redirect.searchParams.set("oauth_error", oauthError);
    return Response.redirect(redirect.toString(), 302);
  }

  if (!code || !state) {
    redirect.searchParams.set("oauth_error", "missing_code_or_state");
    return Response.redirect(redirect.toString(), 302);
  }

  const pending = await consumeWorkerOauthState(state, provider, coordinatorStub);
  if (!pending) {
    redirect.searchParams.set("oauth_error", "invalid_or_expired_state");
    return Response.redirect(redirect.toString(), 302);
  }

  try {
    const oauthConfig = resolveOauthProviderConfig(env, provider);
    const discordPkceEnabled = provider === "discord" && isDiscordPublicClientEnabled(env);
    if (!oauthConfig.clientId || (!discordPkceEnabled && !oauthConfig.clientSecret)) {
      throw new Error(`OAuth provider ${provider} is not configured on this server.`);
    }
    const redirectUri = oauthRedirectUriForProvider(provider, callbackBase, oauthConfig.callbackUrl);
    let profile: { providerUserId: string; username: string; displayName: string; email: string | null };
    if (provider === "discord") {
      const secretCandidates = Array.from(new Set([
        oauthConfig.clientSecret?.trim() ?? "",
        env.PAZAAK_DISCORD_CLIENT_SECRET?.trim() ?? "",
        env.DISCORD_CLIENT_SECRET?.trim() ?? "",
        "",
      ]));
      let discordError: unknown;
      let discordProfile: { providerUserId: string; username: string; displayName: string; email: string | null } | null = null;
      for (const candidateSecret of secretCandidates) {
        try {
          discordProfile = await fetchDiscordSocialAuthProfile(code, {
            clientId: oauthConfig.clientId,
            clientSecret: candidateSecret,
            redirectUri,
          }, {
            discordApiBase: DISCORD_API,
            codeVerifier: discordPkceEnabled ? pending.codeVerifier : undefined,
          });
          break;
        } catch (error) {
          discordError = error;
          const message = error instanceof Error ? error.message : String(error);
          if (!message.toLowerCase().includes("invalid_client")) {
            throw error;
          }
        }
      }
      if (!discordProfile) {
        throw discordError instanceof Error ? discordError : new Error("Discord token exchange failed.");
      }
      profile = discordProfile;
    } else if (provider === "github") {
      profile = await fetchGithubSocialAuthProfile(code, {
        clientId: oauthConfig.clientId,
        clientSecret: oauthConfig.clientSecret,
        redirectUri,
      }, {
        userAgent: "PazaakWorld/1.0",
      });
    } else {
      profile = await fetchGoogleSocialAuthProfile(code, {
        clientId: oauthConfig.clientId,
        clientSecret: oauthConfig.clientSecret,
        redirectUri,
      });
    }

    // Delegate account creation to the Coordinator DO
    const ensureRes = await coordinatorStub.fetch(new Request("http://internal/api/auth/oauth/ensure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, ...profile }),
    }));
    const ensureData = await ensureRes.json<{ app_token?: string; displayName?: string; userId?: string; error?: string }>();
    if (!ensureData.app_token) {
      throw new Error(ensureData.error ?? "Account creation failed");
    }

    redirect.searchParams.set("oauth_provider", provider);
    redirect.searchParams.set("oauth_app_token", ensureData.app_token);
    redirect.searchParams.set("oauth_username", ensureData.displayName ?? profile.displayName);
    redirect.searchParams.set("oauth_user_id", ensureData.userId ?? profile.providerUserId);
    if (pending.pendingMatchId) redirect.searchParams.set("matchId", pending.pendingMatchId);
    return Response.redirect(redirect.toString(), 302);
  } catch (err) {
    redirect.searchParams.set("oauth_error", err instanceof Error ? err.message : String(err));
    return Response.redirect(redirect.toString(), 302);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return empty();

    const url = new URL(request.url);
    const callbackBase = `${url.protocol}//${url.host}`;

    if (url.pathname === "/api/auth/token" || url.pathname === "/api/token") {
      return handleDiscordTokenExchange(request, env);
    }

    if (url.pathname.startsWith("/relay")) {
      if (!isWebSocketUpgrade(request)) {
        return error("Expected WebSocket upgrade", 426);
      }

      const roomName = url.pathname.replace(/^\/relay\/?/, "").split("/").filter(Boolean)[0] ?? "lobby";
      const id = env.RELAY_ROOM.idFromName(roomName);
      const stub = env.RELAY_ROOM.get(id);
      return stub.fetch(request);
    }

    // Activity clients subscribe to a tournament broadcast room without the
    // Discord-activity instance verification requirements.
    if (url.pathname.startsWith("/ws/tournaments/")) {
      if (!isWebSocketUpgrade(request)) {
        return error("Expected WebSocket upgrade", 426);
      }
      const tournamentId = url.pathname.replace(/^\/ws\/tournaments\/?/, "").split("/").filter(Boolean)[0] ?? "";
      if (!tournamentId) return error("Missing tournament id", 400);
      const id = env.RELAY_ROOM.idFromName(`tournament:${tournamentId}`);
      const stub = env.RELAY_ROOM.get(id);
      return stub.fetch(request);
    }

    // Generic WebSocket subscriptions for lobbies and match updates.
    // Supports ?stream=lobbies for lobby list updates and ?matchId=<id> for specific match updates.
    if (url.pathname === "/ws") {
      if (!isWebSocketUpgrade(request)) {
        return error("Expected WebSocket upgrade", 426);
      }
      const stream = url.searchParams.get("stream");
      const matchId = url.searchParams.get("matchId");
      let roomName = "default";
      if (stream === "lobbies") {
        roomName = "lobbies";
      } else if (matchId) {
        roomName = `match:${matchId}`;
      }
      const id = env.RELAY_ROOM.idFromName(roomName);
      const stub = env.RELAY_ROOM.get(id);
      return stub.fetch(request);
    }

    if (!url.pathname.startsWith("/api/")) {
      return error("Not found", 404);
    }

    const id = env.COORDINATOR.idFromName("global");
    const stub = env.COORDINATOR.get(id);

    // OAuth providers list — resolved dynamically from env secrets
    if (url.pathname === "/api/auth/oauth/providers" && request.method === "GET") {
      return json(getOauthProviders(env));
    }

    // OAuth start — handled here so we have env access for client IDs
    const oauthStartMatch = url.pathname.match(/^\/api\/auth\/oauth\/([a-z]+)\/start$/);
    if (oauthStartMatch) {
      const provider = oauthStartMatch[1] as WorkerSocialProvider;
      if (!(SOCIAL_PROVIDERS as readonly string[]).includes(provider)) {
        return error("Unsupported OAuth provider.", 404);
      }
      const providers = getOauthProviders(env).providers;
      if (!providers.find((p) => p.provider === provider)?.enabled) {
        return error(`OAuth provider ${provider} is not configured on this server.`, 501);
      }
      return handleOauthStart(request, env, provider, callbackBase, stub);
    }

    // OAuth callback — handled here so we can redirect to the frontend
    const oauthCallbackMatch = url.pathname.match(/^\/api\/auth\/oauth\/([a-z]+)\/callback$/);
    if (oauthCallbackMatch && request.method === "GET") {
      const provider = oauthCallbackMatch[1] as WorkerSocialProvider;
      if (!(SOCIAL_PROVIDERS as readonly string[]).includes(provider)) {
        return error("Unsupported OAuth provider.", 404);
      }
      return handleOauthCallback(request, env, provider, callbackBase, stub);
    }

    if (url.pathname === "/api/bot-match-sync" && request.method === "POST") {
      const secret = env.PAZAAK_BOT_SYNC_SECRET?.trim();
      if (!secret || secret.length < MIN_SIGNING_SECRET_LENGTH) {
        return error(`PAZAAK_BOT_SYNC_SECRET must be configured with at least ${MIN_SIGNING_SECRET_LENGTH} characters.`, 500);
      }
      const timestampHeader = request.headers.get("x-pazaak-sync-timestamp")?.trim() ?? "";
      const signatureHeader = request.headers.get("x-pazaak-sync-signature")?.trim() ?? "";
      if (!timestampHeader || !signatureHeader) {
        return error("Missing sync signature headers", 401);
      }
      const rawBody = await request.text();
      const verifiedSignature = await verifyBotSyncSignature(secret, timestampHeader, signatureHeader, rawBody);
      if (!verifiedSignature) {
        return error("Forbidden", 403);
      }
      if (!env.MATCH_ACTOR) {
        return error("Match actor unavailable", 501);
      }
      let body: { matchId?: string; snapshot?: SerializedMatch };
      try {
        body = JSON.parse(rawBody) as { matchId?: string; snapshot?: SerializedMatch };
      } catch {
        return error("Invalid JSON", 400);
      }
      const matchId = String(body.matchId ?? "").trim();
      if (!matchId || !body.snapshot) {
        return error("matchId and snapshot required", 400);
      }
      const namespace = env.MATCH_ACTOR;
      const actorStub = namespace.get(namespace.idFromName(matchId));
      return actorStub.fetch(
        new Request("http://internal/snapshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snapshot: body.snapshot }),
        }),
      );
    }

    const matchRoute = url.pathname.match(/^\/api\/matches\/([^/]+)\/(state|command)$/);
    if (matchRoute && env.MATCH_ACTOR) {
      const matchId = decodeURIComponent(matchRoute[1] ?? "");
      const sub = matchRoute[2] ?? "";
      if (!matchId) {
        return error("Missing match id", 400);
      }
      const namespace = env.MATCH_ACTOR;
      const actorStub = namespace.get(namespace.idFromName(matchId));
      const suffix = sub === "state" ? `/state${url.search}` : "/command";
      return actorStub.fetch(
        new Request(`http://internal${suffix}`, {
          method: request.method,
          headers: request.headers,
          body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
        }),
      );
    }

    return stub.fetch(request);
  },
};

export class PazaakRelayRoom {
  private readonly ctx: DurableObjectState;
  private readonly env: Env;
  private readonly members = new Map<string, RelayMember>();
  private readonly subscribers = new Set<WebSocket>();
  private readonly verifyCache = new Map<string, RelayVerifyEntry>();

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    if (!isWebSocketUpgrade(request)) {
      // Internal broadcast endpoint so the Coordinator DO can push tournament
      // events to every subscribed WebSocket client.
      const url = new URL(request.url);
      if (url.pathname === "/broadcast" && request.method === "POST") {
        let payload: JsonValue;
        try {
          payload = await request.json<JsonValue>();
        } catch {
          return error("Invalid broadcast payload", 400);
        }
        this.broadcast(payload);
        return json({ ok: true });
      }
      return error("Expected WebSocket upgrade", 426);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);
    this.subscribers.add(server);
    server.addEventListener("message", (event: MessageEvent) => {
      void this.handleMessage(server, String(event.data));
    });
    server.addEventListener("close", () => this.handleClose(server));
    server.addEventListener("error", () => this.handleClose(server));

    return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: WebSocket });
  }

  private async handleMessage(ws: WebSocket, raw: string): Promise<void> {
    const message = parseRelayMessage(raw);
    if (!message) {
      return;
    }

    if (message.type === "join") {
      const instanceId = getRelayString(message.instanceId);
      const userId = getRelayString(message.userId);
      const username = getRelayString(message.username) || "Player";
      if (!instanceId || !userId) {
        this.reject(ws, "missing-instance-or-user");
        return;
      }

      const verified = await this.verifyParticipant(instanceId, userId);
      if (!verified) {
        this.reject(ws, "instance-not-verified");
        return;
      }

      const seatIndex = this.pickSeat();
      const color = RELAY_SEAT_COLORS[seatIndex] ?? "#cfd8dc";
      this.members.set(userId, { ws, userId, username, seatIndex, color });
      this.send(ws, { type: "welcome", instanceId, userId, username, seat: seatIndex, color });
      this.broadcastPresence();
      return;
    }

    const member = this.findMember(ws);
    if (!member) {
      return;
    }

    if (message.type === "ping") {
      this.send(ws, { type: "pong", at: Date.now() });
      return;
    }

    if (message.type === "presence") {
      this.broadcastPresence();
      return;
    }

    if (message.type === "relay") {
      this.broadcast({ type: "relay", from: { userId: member.userId, username: member.username }, payload: message.payload ?? null }, ws);
    }
  }

  private handleClose(ws: WebSocket): void {
    this.subscribers.delete(ws);
    const entry = [...this.members.entries()].find(([, member]) => member.ws === ws);
    if (!entry) {
      return;
    }

    this.members.delete(entry[0]);
    this.broadcastPresence();
  }

  private async verifyParticipant(instanceId: string, userId: string): Promise<boolean> {
    if (instanceId.startsWith("local-") || instanceId.startsWith("dev-") || instanceId.startsWith("match-")) {
      return true;
    }

    if (this.env.ALLOW_UNVERIFIED_INSTANCES === "1") {
      return true;
    }

    const clientId = this.env.DISCORD_CLIENT_ID?.trim();
    const botToken = this.env.DISCORD_BOT_TOKEN?.trim();
    if (!clientId || !botToken) {
      return false;
    }

    const key = `${instanceId}:${userId}`;
    const cached = this.verifyCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.ok;
    }

    let ok = false;
    try {
      const response = await fetch(`${DISCORD_API}/applications/${clientId}/activity-instances/${instanceId}`, {
        headers: { Authorization: `Bot ${botToken}` },
      });
      if (response.ok) {
        const payload = await response.json() as { users?: string[] };
        ok = Array.isArray(payload.users) && payload.users.includes(userId);
      }
    } catch {
      ok = false;
    }

    this.verifyCache.set(key, { ok, expiresAt: Date.now() + RELAY_VERIFY_TTL_MS });
    return ok;
  }

  private pickSeat(): number {
    const used = new Set([...this.members.values()].map((member) => member.seatIndex));
    for (let index = 0; index < RELAY_SEAT_COLORS.length; index += 1) {
      if (!used.has(index)) {
        return index;
      }
    }

    return this.members.size;
  }

  private findMember(ws: WebSocket): RelayMember | null {
    return [...this.members.values()].find((member) => member.ws === ws) ?? null;
  }

  private broadcastPresence(): void {
    this.broadcast({
      type: "presence",
      members: [...this.members.values()].map((member) => ({
        userId: member.userId,
        username: member.username,
        seat: member.seatIndex,
        color: member.color,
      })),
    });
  }

  private broadcast(message: JsonValue, except?: WebSocket): void {
    // Broadcast to every connected socket (members + plain subscribers) so
    // tournament-subscription clients without an activity `join` still get
    // events. `members` is a subset of `subscribers` once the socket joins,
    // so iterating the subscriber set alone covers everyone.
    for (const ws of this.subscribers) {
      if (ws !== except) {
        this.send(ws, message);
      }
    }
  }

  private send(ws: WebSocket, message: JsonValue): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Ignore closed sockets.
    }
  }

  private reject(ws: WebSocket, reason: string): void {
    this.send(ws, { type: "error", reason });
    try {
      ws.close(1008, reason);
    } catch {
      // Ignore closed sockets.
    }
  }
}

function parseRelayMessage(raw: string): Record<string, JsonValue> | null {
  try {
    const value = JSON.parse(raw) as JsonValue;
    return value && typeof value === "object" ? value as Record<string, JsonValue> : null;
  } catch {
    return null;
  }
}

function getRelayString(value: JsonValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export class MatchCoordinator {
  private readonly ctx: DurableObjectState;
  private readonly env: Env;
  private loaded: StorageShape | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  private async readState(): Promise<StorageShape> {
    if (this.loaded) return this.loaded;
    const existing = await this.ctx.storage.get<StorageShape>("state");
    const loaded: StorageShape = existing ?? {
      accounts: {},
      sessions: {},
      queue: [],
      lobbies: [],
      tournaments: {},
      oauthStates: {},
    };
    // Back-fill tournaments map for pre-existing storage snapshots.
    if (!loaded.tournaments) {
      loaded.tournaments = {};
    }
    for (const entry of loaded.queue) {
      if (!entry.preferredRegions?.length) {
        entry.preferredRegions = ["auto"];
      }
      if (entry.enqueuedAtMs === undefined) {
        entry.enqueuedAtMs = Date.parse(entry.enqueuedAt) || Date.now();
      }
    }
    this.loaded = loaded;
    return loaded;
  }

  private async persist(state: StorageShape): Promise<void> {
    this.loaded = state;
    await this.ctx.storage.put("state", state);
  }

  private async resolveSession(
    token: string | null,
    state: StorageShape,
  ): Promise<{ account: AccountState; session: SessionState; storageKey: string } | null> {
    if (!token) return null;
    const claims = await verifySignedSessionToken(token, this.env);
    if (claims) {
      const session = state.sessions[claims.sid];
      if (!session) return null;
      if (session.accountId !== claims.sub || session.sessionId !== claims.sid) return null;
      if (new Date(session.expiresAt).getTime() <= Date.now()) return null;
      const account = state.accounts[session.accountId];
      if (!account) return null;
      return { account, session, storageKey: claims.sid };
    }

    const legacySession = state.sessions[token];
    if (!legacySession) return null;
    if (new Date(legacySession.expiresAt).getTime() <= Date.now()) return null;
    const legacyAccount = state.accounts[legacySession.accountId];
    if (!legacyAccount) return null;
    return { account: legacyAccount, session: legacySession, storageKey: token };
  }

  private buildWallet(account: AccountState): Json {
    const mmrRd = typeof account.mmrRd === "number" && Number.isFinite(account.mmrRd) ? account.mmrRd : 350;
    return {
      userId: account.accountId,
      displayName: account.displayName,
      preferredRuntimeDeckId: null,
      balance: 1000,
      wins: 0,
      losses: 0,
      mmr: account.mmr,
      mmrRd,
      gamesPlayed: 0,
      gamesWon: 0,
      lastMatchAt: null,
      userSettings: DEFAULT_SETTINGS,
      streak: 0,
      bestStreak: 0,
      lastDailyAt: null,
      updatedAt: nowIso(),
    };
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") return empty();

    const state = await this.readState();
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/ping" && (request.method === "GET" || request.method === "HEAD")) {
      return empty();
    }

    if (path === "/api/config/public" && request.method === "GET") {
      return json(toPublicConfig(resolvePolicy(this.env, state)));
    }

    // OAuth providers list is handled by the main Worker (has env access).
    // This route is kept here only as a fallback but should not be reached.
    if (path === "/api/auth/oauth/providers" && request.method === "GET") {
      return json({ providers: [] });
    }

    // Internal: create OAuth state so callbacks can validate across worker isolates.
    if (path === "/api/auth/oauth/state/create" && request.method === "POST") {
      const body = await request.json<Json>().catch(() => ({} as Json));
      const provider = typeof body.provider === "string" ? body.provider.trim() : "";
      if (!SOCIAL_PROVIDERS.includes(provider as WorkerSocialProvider)) {
        return error("Unsupported OAuth provider.", 404);
      }
      const pendingMatchId = typeof body.pendingMatchId === "string" && body.pendingMatchId.trim()
        ? body.pendingMatchId.trim()
        : undefined;
      const codeVerifier = typeof body.codeVerifier === "string" && body.codeVerifier.trim()
        ? body.codeVerifier.trim()
        : undefined;
      const now = Date.now();
      for (const [token, entry] of Object.entries(state.oauthStates)) {
        if (entry.expiresAt <= now) {
          delete state.oauthStates[token];
        }
      }
      const oauthStateToken = crypto.randomUUID().replace(/-/g, "");
      state.oauthStates[oauthStateToken] = {
        provider,
        expiresAt: now + OAUTH_STATE_TTL_MS,
        pendingMatchId,
        codeVerifier,
      };
      await this.persist(state);
      return json({ state: oauthStateToken });
    }

    // Internal: consume OAuth state exactly once on callback.
    if (path === "/api/auth/oauth/state/consume" && request.method === "POST") {
      const body = await request.json<Json>().catch(() => ({} as Json));
      const oauthStateToken = typeof body.state === "string" ? body.state.trim() : "";
      const provider = typeof body.provider === "string" ? body.provider.trim() : "";
      if (!oauthStateToken || !provider) {
        return error("Missing OAuth state or provider.", 400);
      }
      const entry = state.oauthStates[oauthStateToken];
      if (entry) {
        delete state.oauthStates[oauthStateToken];
        await this.persist(state);
      }
      if (!entry || entry.expiresAt <= Date.now() || entry.provider !== provider) {
        return error("OAuth state is invalid or expired.", 404);
      }
      return json({ pendingMatchId: entry.pendingMatchId ?? null, codeVerifier: entry.codeVerifier ?? null });
    }

    // Internal: called by the main Worker after a successful OAuth code exchange
    if (path === "/api/auth/oauth/ensure" && request.method === "POST") {
      const body = await request.json<Json>().catch(() => ({} as Json));
      const provider = String(body.provider ?? "");
      const providerUserId = String(body.providerUserId ?? "");
      const username = toSlug(String(body.username ?? providerUserId)).slice(0, 32);
      const displayName = String(body.displayName ?? username).slice(0, 48) || "Player";
      const email = typeof body.email === "string" && body.email.includes("@") ? body.email : null;
      const identityKey = `${provider}:${providerUserId}`;
      // Find existing account by provider identity key stored in accountId prefix or username
      let account = Object.values(state.accounts).find(
        (a) => a.accountId.startsWith(`${identityKey}:`) || (email !== null && a.email === email),
      );
      if (!account) {
        const createdAt = nowIso();
        account = {
          accountId: `${identityKey}:${crypto.randomUUID()}`,
          username,
          displayName,
          email,
          createdAt,
          updatedAt: createdAt,
          mmr: 1000,
          mmrRd: 350,
        };
        state.accounts[account.accountId] = account;
      }
      const session = await createSessionRecord(account.accountId, this.env);
      state.sessions[session.sessionId] = session;
      await this.persist(state);
      return json({ app_token: session.token, displayName: account.displayName, userId: account.accountId });
    }

    if ((path === "/api/auth/register" || path === "/api/auth/login") && request.method === "POST") {
      const body = await request.json<Json>().catch(() => ({} as Json));
      const identifier = String(body.identifier ?? body.username ?? body.displayName ?? "guest");
      const displayName = String(body.displayName ?? identifier ?? "Guest Pilot").slice(0, 48) || "Guest Pilot";
      const username = toSlug(String(body.username ?? identifier)).slice(0, 32);
      const email = typeof body.email === "string" && body.email.includes("@") ? body.email : null;

      let account = selectAccountByUsernameOrEmail(state.accounts, username, email);
      if (!account) {
        const createdAt = nowIso();
        account = {
          accountId: crypto.randomUUID(),
          username,
          displayName,
          email,
          createdAt,
          updatedAt: createdAt,
          mmr: 1000,
          mmrRd: 350,
        };
        state.accounts[account.accountId] = account;
      }

      const session = await createSessionRecord(account.accountId, this.env);
      state.sessions[session.sessionId] = session;
      account.updatedAt = session.createdAt;

      await this.persist(state);

      return json({
        app_token: session.token,
        token_type: "Bearer",
        account: {
          accountId: account.accountId,
          username: account.username,
          displayName: account.displayName,
          email: account.email,
          legacyGameUserId: null,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
        },
        session: {
          sessionId: session.sessionId,
          accountId: account.accountId,
          label: null,
          createdAt: session.createdAt,
          lastUsedAt: session.lastUsedAt,
          expiresAt: session.expiresAt,
        },
        linkedIdentities: [],
      });
    }

    const authed = await this.resolveSession(parseAuthToken(request), state);
    if (!authed) {
      return error("Unauthorized", 401);
    }

    authed.session.lastUsedAt = nowIso();

    if (path === "/api/admin/policy" && request.method === "GET") {
      const policy = resolvePolicy(this.env, state);
      if (!isAdminAccount(authed.account.accountId, policy, this.env)) {
        return error("Forbidden", 403);
      }
      await this.persist(state);
      return json({ policy: resolvePolicy(this.env, state), etag: state.policyRuntime?.etag ?? null });
    }

    if (path === "/api/admin/policy" && request.method === "PUT") {
      const policy = resolvePolicy(this.env, state);
      if (!isAdminAccount(authed.account.accountId, policy, this.env)) {
        return error("Forbidden", 403);
      }
      const body = await request.json<Json>().catch(() => ({} as Json));
      const merged = deepMergePolicy(policy, body);
      parsePolicyJson(merged);
      state.policyRuntime = { blob: merged, etag: crypto.randomUUID(), updatedAt: nowIso() };
      pushAudit(state, authed.account.accountId, "policy.update", {
        etag: state.policyRuntime.etag,
      } as unknown as JsonValue);
      await this.persist(state);
      return json({ ok: true, etag: state.policyRuntime.etag });
    }

    if (path === "/api/admin/audit" && request.method === "GET") {
      const policy = resolvePolicy(this.env, state);
      if (!isAdminAccount(authed.account.accountId, policy, this.env)) {
        return error("Forbidden", 403);
      }
      return json({ entries: state.auditLog ?? [] });
    }

    if (path === "/api/auth/logout" && request.method === "POST") {
      delete state.sessions[authed.storageKey];
      await this.persist(state);
      return json({ ok: true });
    }

    if (path === "/api/auth/session" && request.method === "GET") {
      await this.persist(state);
      return json({
        account: {
          accountId: authed.account.accountId,
          username: authed.account.username,
          displayName: authed.account.displayName,
          email: authed.account.email,
          legacyGameUserId: null,
          createdAt: authed.account.createdAt,
          updatedAt: authed.account.updatedAt,
        },
        linkedIdentities: [],
      });
    }

    if (path === "/api/me" && request.method === "GET") {
      const queue = state.queue.find((entry) => entry.userId === authed.account.accountId) ?? null;
      await this.persist(state);
      return json({
        user: {
          id: authed.account.accountId,
          username: authed.account.username,
          displayName: authed.account.displayName,
        },
        wallet: this.buildWallet(authed.account),
        queue,
        match: null,
      });
    }

    if (path === "/api/settings" && request.method === "GET") {
      await this.persist(state);
      const policy = resolvePolicy(this.env, state);
      return json({
        settings: { ...DEFAULT_SETTINGS, turnTimerSeconds: policy.timers.turnTimerSeconds },
        wallet: this.buildWallet(authed.account),
      });
    }

    if (path === "/api/settings" && request.method === "PUT") {
      await request.text();
      await this.persist(state);
      return json({ settings: DEFAULT_SETTINGS, wallet: this.buildWallet(authed.account) });
    }

    if (path === "/api/leaderboard" && request.method === "GET") {
      return json({ leaders: [] });
    }

    if (path === "/api/me/history" && request.method === "GET") {
      return json({ history: [] });
    }

    if (path === "/api/pazaak/opponents" && request.method === "GET") {
      return json({ opponents: [], serverTime: nowIso() });
    }

    if (path === "/api/matchmaking/enqueue" && request.method === "POST") {
      const payload = await request.json<Json>().catch(() => ({} as Json));
      const preferredMaxPlayers = Number(payload.preferredMaxPlayers ?? 2);
      const policy = resolvePolicy(this.env, state);
      const rawRegions = payload.preferredRegions;
      const preferredRegions = Array.isArray(rawRegions)
        ? rawRegions
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
        : [];
      const regions =
        preferredRegions.length > 0 ? preferredRegions : [policy.matchmaking.defaultRegionId];
      state.queue = state.queue.filter((entry) => entry.userId !== authed.account.accountId);
      const entry: QueueEntry = {
        userId: authed.account.accountId,
        displayName: authed.account.displayName,
        mmr: authed.account.mmr,
        preferredMaxPlayers: Number.isFinite(preferredMaxPlayers) ? Math.max(2, Math.min(8, preferredMaxPlayers)) : 2,
        enqueuedAt: nowIso(),
        preferredRegions: regions,
        enqueuedAtMs: Date.now(),
      };
      state.queue.push(entry);
      await this.persist(state);
      await this.tryPairMatchmakingQueue(state);
      await this.persist(state);
      return json({ queue: entry });
    }

    if (path === "/api/matchmaking/leave" && request.method === "POST") {
      const before = state.queue.length;
      state.queue = state.queue.filter((entry) => entry.userId !== authed.account.accountId);
      await this.persist(state);
      return json({ removed: state.queue.length < before });
    }

    if (path === "/api/matchmaking/status" && request.method === "GET") {
      const queue = state.queue.find((entry) => entry.userId === authed.account.accountId) ?? null;
      return json({ queue });
    }

    if (path === "/api/matchmaking/stats" && request.method === "GET") {
      return json({
        playersInQueue: state.queue.length,
        openLobbies: state.lobbies.filter((lobby) => lobby.status === "waiting").length,
        activeGames: 0,
        averageWaitSeconds: 12,
        averageWaitTime: "~12s",
        queueUpdatedAt: nowIso(),
      });
    }

    if (path === "/api/lobbies" && request.method === "GET") {
      return json({ lobbies: state.lobbies });
    }

    if (path === "/api/lobbies" && request.method === "POST") {
      const payload = await request.json<Json>().catch(() => ({} as Json));
      const createdAt = nowIso();
      const lobbyId = crypto.randomUUID();
      const maxPlayers = Math.max(2, Math.min(8, Number(payload.maxPlayers ?? 2) || 2));
      const roundsAndTimer = normalizeLobbyRoundAndTimerSettings({
        maxRounds: payload.maxRounds,
        turnTimerSeconds: payload.turnTimerSeconds,
      });
      const lobby: LobbyRecord = {
        id: lobbyId,
        lobbyCode: randomCode(6),
        name: String(payload.name ?? `${authed.account.displayName}'s Lobby`).slice(0, 64),
        hostUserId: authed.account.accountId,
        maxPlayers,
        tableSettings: {
          variant: payload.variant === "multi_seat" ? "multi_seat" : "canonical",
          maxPlayers,
          maxRounds: roundsAndTimer.maxRounds,
          turnTimerSeconds: roundsAndTimer.turnTimerSeconds,
          ranked: Boolean(payload.ranked),
          allowAiFill: Boolean(payload.allowAiFill),
          sideboardMode: payload.sideboardMode === "player_active_custom" || payload.sideboardMode === "host_mirror_custom"
            ? payload.sideboardMode
            : "runtime_random",
          gameMode: Boolean(payload.ranked) ? "canonical" : (readLobbyWackyGameMode(payload) ? "wacky" : "canonical"),
        },
        passwordHash: typeof payload.password === "string" && payload.password.length > 0 ? "set" : null,
        status: "waiting",
        matchId: null,
        players: [
          {
            userId: authed.account.accountId,
            displayName: authed.account.displayName,
            ready: false,
            isHost: true,
            isAi: false,
            joinedAt: createdAt,
          },
        ],
        createdAt,
        updatedAt: createdAt,
      };
      state.lobbies.unshift(lobby);
      await this.persist(state);
      return json({ lobby });
    }

    if (path === "/api/lobbies/join-by-code" && request.method === "POST") {
      const payload = await request.json<Json>().catch(() => ({} as Json));
      const lobbyCode = String(payload.lobbyCode ?? "").toUpperCase();
      const lobby = state.lobbies.find((candidate) => candidate.lobbyCode === lobbyCode);
      if (!lobby) return error("Lobby not found", 404);
      const existing = lobby.players.find((player) => player.userId === authed.account.accountId);
      if (!existing && lobby.players.length < lobby.maxPlayers) {
        lobby.players.push({
          userId: authed.account.accountId,
          displayName: authed.account.displayName,
          ready: false,
          isHost: false,
          isAi: false,
          joinedAt: nowIso(),
        });
        lobby.updatedAt = nowIso();
      }
      await this.persist(state);
      return json({ lobby });
    }

    const lobbyJoinMatch = path.match(/^\/api\/lobbies\/([^/]+)\/join$/);
    if (lobbyJoinMatch && request.method === "POST") {
      const lobbyId = decodeURIComponent(lobbyJoinMatch[1]);
      const lobby = state.lobbies.find((candidate) => candidate.id === lobbyId);
      if (!lobby) return error("Lobby not found", 404);
      const existing = lobby.players.find((player) => player.userId === authed.account.accountId);
      if (!existing && lobby.players.length < lobby.maxPlayers) {
        lobby.players.push({
          userId: authed.account.accountId,
          displayName: authed.account.displayName,
          ready: false,
          isHost: false,
          isAi: false,
          joinedAt: nowIso(),
        });
        lobby.updatedAt = nowIso();
      }
      await this.persist(state);
      return json({ lobby });
    }

    const lobbyReadyMatch = path.match(/^\/api\/lobbies\/([^/]+)\/ready$/);
    if (lobbyReadyMatch && request.method === "POST") {
      const payload = await request.json<Json>().catch(() => ({} as Json));
      const lobby = state.lobbies.find((candidate) => candidate.id === decodeURIComponent(lobbyReadyMatch[1]));
      if (!lobby) return error("Lobby not found", 404);
      const player = lobby.players.find((candidate) => candidate.userId === authed.account.accountId);
      if (player) player.ready = Boolean(payload.ready);
      lobby.updatedAt = nowIso();
      await this.persist(state);
      return json({ lobby });
    }

    const lobbyStatusMatch = path.match(/^\/api\/lobbies\/([^/]+)\/status$/);
    if (lobbyStatusMatch && request.method === "POST") {
      const payload = await request.json<Json>().catch(() => ({} as Json));
      const lobby = state.lobbies.find((candidate) => candidate.id === decodeURIComponent(lobbyStatusMatch[1]));
      if (!lobby) return error("Lobby not found", 404);
      lobby.status = payload.status === "matchmaking" ? "matchmaking" : "waiting";
      lobby.updatedAt = nowIso();
      await this.persist(state);
      return json({ lobby });
    }

    const lobbyLeaveMatch = path.match(/^\/api\/lobbies\/([^/]+)\/leave$/);
    if (lobbyLeaveMatch && request.method === "POST") {
      const lobby = state.lobbies.find((candidate) => candidate.id === decodeURIComponent(lobbyLeaveMatch[1]));
      if (!lobby) return json({ lobby: null });
      lobby.players = lobby.players.filter((player) => player.userId !== authed.account.accountId);
      if (lobby.players.length === 0) {
        state.lobbies = state.lobbies.filter((candidate) => candidate.id !== lobby.id);
        await this.persist(state);
        return json({ lobby: null });
      }
      if (!lobby.players.some((player) => player.isHost)) {
        lobby.players[0].isHost = true;
        lobby.hostUserId = lobby.players[0].userId;
      }
      lobby.updatedAt = nowIso();
      await this.persist(state);
      return json({ lobby });
    }

    const lobbyStartMatch = path.match(/^\/api\/lobbies\/([^/]+)\/start$/);
    if (lobbyStartMatch && request.method === "POST") {
      const policy = resolvePolicy(this.env, state);
      if (!policy.features.workerMatchAuthority || !this.env.MATCH_ACTOR) {
        return error("Multiplayer match hosting is not enabled on this free fallback backend.", 409);
      }
      const lobby = state.lobbies.find((candidate) => candidate.id === decodeURIComponent(lobbyStartMatch[1]));
      if (!lobby) return error("Lobby not found", 404);
      if (lobby.hostUserId !== authed.account.accountId) {
        return error("Only the host can start this lobby.", 403);
      }
      const humans = lobby.players.filter((player) => !player.isAi);
      if (humans.length < 2) {
        return error("At least two human players are required to start.", 400);
      }
      const [p1, p2] = humans;
      const matchId = crypto.randomUUID();
      const ra = [policy.matchmaking.defaultRegionId];
      const rb = [policy.matchmaking.defaultRegionId];
      const namespace = this.env.MATCH_ACTOR;
      const stub = namespace.get(
        namespace.idFromName(matchId),
      );
      const createPayload = buildMatchActorCreatePayload({
        matchId,
        playerOneId: p1!.userId,
        playerOneName: p1!.displayName,
        playerTwoId: p2!.userId,
        playerTwoName: p2!.displayName,
        gameMode: lobby.tableSettings.gameMode,
        maxRounds: lobby.tableSettings.maxRounds,
        turnTimerSeconds: lobby.tableSettings.turnTimerSeconds,
      });
      const createRes = await stub.fetch(
        new Request("http://internal/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createPayload),
        }),
      );
      if (!createRes.ok) {
        const errText = await createRes.text();
        return error(errText || "Failed to create match", createRes.status);
      }
      lobby.matchId = matchId;
      lobby.status = "in_game";
      lobby.updatedAt = nowIso();
      await this.persist(state);
      return json({ lobby, matchId });
    }

    if (path === "/api/match/me" && request.method === "GET") {
      return error("No active match", 404);
    }

    if (path.startsWith("/api/match/") && request.method === "GET") {
      return error("Match not found", 404);
    }

    if (path === "/api/blackjack/rules" && request.method === "GET") {
      const policy = resolvePolicy(this.env, state);
      if (!policy.features.blackjackOnlineEnabled) {
        return error("Blackjack online is disabled by policy.", 403);
      }
      return json({ blackjack: policy.blackjack });
    }

    // ---------- Tournaments ---------------------------------------------------

    if (path === "/api/tournaments" && request.method === "GET") {
      const tournaments = Object.values(state.tournaments)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((entry) => summarizeTournament(entry));
      return json({ tournaments });
    }

    if (path === "/api/tournaments" && request.method === "POST") {
      const payload = await request.json<Json>().catch(() => ({} as Json));
      const formatRaw = String(payload.format ?? "single_elim");
      const format: TournamentFormat = formatRaw === "double_elim" || formatRaw === "swiss"
        ? formatRaw
        : "single_elim";
      const modeRaw = String(payload.gameMode ?? payload.mode ?? "canonical");
      const gameMode = modeRaw === "wacky" ? "wacky" : "canonical";

      const tournament = createTournament({
        name: String(payload.name ?? "Unnamed Tournament").slice(0, 64),
        organizerId: authed.account.accountId,
        organizerName: authed.account.displayName,
        format,
        gameMode,
        setsPerMatch: Math.max(1, Math.min(9, Number(payload.setsPerMatch ?? 3) || 3)),
        rounds: Math.max(2, Math.min(12, Number(payload.rounds ?? 5) || 5)),
        maxParticipants: typeof payload.maxParticipants === "number" ? payload.maxParticipants : null,
      });
      state.tournaments[tournament.id] = tournament;
      await this.persist(state);
      await this.broadcastTournamentEvent("tournament.updated", tournament);
      return json({ tournament });
    }

    const tournamentIdMatch = path.match(/^\/api\/tournaments\/([^/]+)(?:\/([^/]+))?$/);
    if (tournamentIdMatch && request.method === "GET" && !tournamentIdMatch[2]) {
      const id = decodeURIComponent(tournamentIdMatch[1]);
      const tournament = state.tournaments[id];
      if (!tournament) return error("Tournament not found", 404);
      return json({
        tournament,
        bracket: buildBracketView(tournament),
        standings: tournament.format === "swiss" ? computeSwissStandings(tournament) : null,
      });
    }

    const tournamentJoinMatch = path.match(/^\/api\/tournaments\/([^/]+)\/join$/);
    if (tournamentJoinMatch && request.method === "POST") {
      const id = decodeURIComponent(tournamentJoinMatch[1]);
      const tournament = state.tournaments[id];
      if (!tournament) return error("Tournament not found", 404);
      let next: TournamentState;
      try {
        next = registerParticipant(tournament, {
          userId: authed.account.accountId,
          displayName: authed.account.displayName,
          mmr: authed.account.mmr,
        });
      } catch (err) {
        return error(err instanceof Error ? err.message : "Registration failed", 400);
      }
      state.tournaments[id] = next;
      await this.persist(state);
      await this.broadcastTournamentEvent("tournament.updated", next);
      return json({ tournament: next });
    }

    const tournamentLeaveMatch = path.match(/^\/api\/tournaments\/([^/]+)\/leave$/);
    if (tournamentLeaveMatch && request.method === "POST") {
      const id = decodeURIComponent(tournamentLeaveMatch[1]);
      const tournament = state.tournaments[id];
      if (!tournament) return error("Tournament not found", 404);
      const next = withdrawParticipant(tournament, authed.account.accountId);
      state.tournaments[id] = next;
      await this.persist(state);
      await this.broadcastTournamentEvent("tournament.updated", next);
      return json({ tournament: next });
    }

    const tournamentStartMatch = path.match(/^\/api\/tournaments\/([^/]+)\/start$/);
    if (tournamentStartMatch && request.method === "POST") {
      const id = decodeURIComponent(tournamentStartMatch[1]);
      const tournament = state.tournaments[id];
      if (!tournament) return error("Tournament not found", 404);
      if (tournament.organizerId !== authed.account.accountId) {
        return error("Only the organizer can start this tournament.", 403);
      }
      let started: TournamentState;
      try {
        started = startTournament(tournament);
      } catch (err) {
        return error(err instanceof Error ? err.message : "Unable to start", 400);
      }
      state.tournaments[id] = started;
      await this.persist(state);
      await this.broadcastTournamentEvent("tournament.updated", started);
      for (const match of started.matches.filter((entry) => entry.state === "active")) {
        await this.broadcastTournamentEvent("match.scheduled", started, match.id);
      }
      return json({ tournament: started });
    }

    const tournamentReportMatch = path.match(/^\/api\/tournaments\/([^/]+)\/report$/);
    if (tournamentReportMatch && request.method === "POST") {
      const id = decodeURIComponent(tournamentReportMatch[1]);
      const payload = await request.json<Json>().catch(() => ({} as Json));
      const tournament = state.tournaments[id];
      if (!tournament) return error("Tournament not found", 404);
      const matchId = String(payload.matchId ?? "");
      const winnerUserId = payload.winnerUserId === null ? null : String(payload.winnerUserId ?? "");
      const match = tournament.matches.find((entry) => entry.id === matchId);
      if (!match) return error("Match not found", 404);
      const isParticipant = authed.account.accountId === match.participantAId || authed.account.accountId === match.participantBId;
      const isOrganizer = authed.account.accountId === tournament.organizerId;
      if (!isParticipant && !isOrganizer) {
        return error("Only the match participants or the organizer can report this match.", 403);
      }
      let result;
      try {
        result = advanceTournament(tournament, { matchId, winnerUserId });
      } catch (err) {
        return error(err instanceof Error ? err.message : "Advance failed", 400);
      }
      state.tournaments[id] = result.state;
      await this.persist(state);
      await this.broadcastTournamentEvent("tournament.updated", result.state);
      if (result.newSwissRound !== null) {
        await this.broadcastTournamentEvent("round.advanced", result.state);
      }
      for (const scheduled of result.matchesToSchedule) {
        await this.broadcastTournamentEvent("match.scheduled", result.state, scheduled.id);
      }
      return json({ tournament: result.state, tournamentCompleted: result.tournamentCompleted });
    }

    const tournamentCancelMatch = path.match(/^\/api\/tournaments\/([^/]+)\/cancel$/);
    if (tournamentCancelMatch && request.method === "POST") {
      const id = decodeURIComponent(tournamentCancelMatch[1]);
      const tournament = state.tournaments[id];
      if (!tournament) return error("Tournament not found", 404);
      if (tournament.organizerId !== authed.account.accountId) {
        return error("Only the organizer can cancel this tournament.", 403);
      }
      const cancelled: TournamentState = { ...tournament, status: "cancelled", updatedAt: Date.now() };
      state.tournaments[id] = cancelled;
      await this.persist(state);
      await this.broadcastTournamentEvent("tournament.updated", cancelled);
      return json({ tournament: cancelled });
    }

    return error("Not found", 404);
  }

  private async tryPairMatchmakingQueue(state: StorageShape): Promise<void> {
    const policy = resolvePolicy(this.env, state);
    if (!policy.features.workerMatchAuthority || !this.env.MATCH_ACTOR) {
      return;
    }
    const namespace = this.env.MATCH_ACTOR;
    const now = Date.now();
    const q = [...state.queue];
    outer: for (let i = 0; i < q.length - 1; i++) {
      for (let j = i + 1; j < q.length; j++) {
        const a = q[i]!;
        const b = q[j]!;
        const ra = a.preferredRegions ?? [policy.matchmaking.defaultRegionId];
        const rb = b.preferredRegions ?? [policy.matchmaking.defaultRegionId];
        const waited = now - Math.min(a.enqueuedAtMs ?? now, b.enqueuedAtMs ?? now);
        const widen = waited >= policy.matchmaking.queueWidenAfterMs;
        let ok = widen;
        if (!ok) {
          if (ra.includes("auto") || rb.includes("auto")) {
            ok = true;
          } else {
            ok = ra.some((region) => rb.includes(region));
          }
        }
        if (!ok) {
          continue;
        }
        const matchId = crypto.randomUUID();
        const stub = namespace.get(
          namespace.idFromName(matchId),
        );
        const res = await stub.fetch(
          new Request("http://internal/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              matchId,
              playerOneId: a.userId,
              playerOneName: a.displayName,
              playerTwoId: b.userId,
              playerTwoName: b.displayName,
              gameMode: "canonical",
            }),
          }),
        );
        if (!res.ok) {
          continue;
        }
        state.queue = state.queue.filter((e) => e.userId !== a.userId && e.userId !== b.userId);
        break outer;
      }
    }
  }

  private async broadcastTournamentEvent(
    type: "tournament.updated" | "match.scheduled" | "round.advanced",
    tournament: TournamentState,
    matchId?: string,
  ): Promise<void> {
    try {
      const roomName = `tournament:${tournament.id}`;
      const id = this.env.RELAY_ROOM.idFromName(roomName);
      const stub = this.env.RELAY_ROOM.get(id);
      await stub.fetch(new Request("http://internal/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: type,
          tournamentId: tournament.id,
          ...(matchId ? { matchId } : {}),
          summary: summarizeTournament(tournament),
        }),
      }));
    } catch {
      // Broadcast failures should not block API responses.
    }
  }
}

const summarizeTournament = (state: TournamentState): Json => {
  return {
    id: state.id,
    name: state.name,
    format: state.format,
    gameMode: state.gameMode,
    status: state.status,
    currentRound: state.currentRound,
    participants: Object.values(state.participants).map((entry) => ({
      userId: entry.userId,
      displayName: entry.displayName,
      seed: entry.seed,
      status: entry.status,
      mmr: entry.mmr,
    })) as JsonValue,
    championUserId: state.championUserId,
    setsPerMatch: state.setsPerMatch,
    rounds: state.rounds,
    maxParticipants: state.maxParticipants,
    organizerId: state.organizerId,
    organizerName: state.organizerName,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
};
