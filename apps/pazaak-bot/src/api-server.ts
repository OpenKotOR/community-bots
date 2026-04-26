/**
 * Embedded HTTP + WebSocket API server that runs inside the pazaak-bot
 * process and exposes match state to external interfaces (Discord Activities,
 * standalone browser).
 *
 * Architecture:
 *   - The bot's PazaakCoordinator is the single source of truth.
 *   - The HTTP server exposes REST endpoints for all game actions.
 *   - The WebSocket hub pushes match-state snapshots to connected clients
 *     whenever the coordinator mutates a match.
 *   - Discord token verification: clients pass their Discord OAuth2 access
 *     token (obtained by the Activity SDK or the OAuth2 code flow) in the
 *     Authorization header.  The server calls https://discord.com/api/users/@me
 *     to verify the token and extract the caller's user ID before acting.
 */

import http from "node:http";
import { randomUUID } from "node:crypto";
import type { AiDifficulty, PazaakCoordinator, PazaakMatch } from "@openkotor/pazaak-engine";
import { MAIN_MENU_PRESET, SIDE_DECK_SIZE, normalizeSideDeckToken, pazaakOpponents, serializeMatch } from "@openkotor/pazaak-engine";
import { hashPazaakPassword, verifyPazaakPassword } from "@openkotor/persistence";
import type {
  JsonPazaakAccountRepository,
  PazaakLobbyRecord,
  JsonPazaakLobbyRepository,
  JsonPazaakMatchHistoryRepository,
  JsonPazaakMatchmakingQueueRepository,
  JsonPazaakSideboardRepository,
  JsonWalletRepository,
  PazaakAccountRecord,
  PazaakAccountSessionRecord,
  PazaakLinkedIdentityRecord,
  PazaakTableSettings,
  PazaakThemePreference,
} from "@openkotor/persistence";
import express, { type Request, type Response, type NextFunction } from "express";
import { WebSocketServer, type WebSocket } from "ws";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  discriminator: string;
}

interface GoogleUser {
  sub: string;
  email?: string;
  name?: string;
  given_name?: string;
  picture?: string;
}

interface GithubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
}

interface AuthenticatedPazaakUser {
  /** The identity currently used by game/wallet records during migration. */
  id: string;
  accountId: string;
  username: string;
  displayName: string;
  source: "session" | "discord" | "dev";
  discordUserId?: string | undefined;
  sessionId?: string | undefined;
}

interface SerializedAccountSession {
  account: PazaakAccountRecord;
  session: Omit<PazaakAccountSessionRecord, "tokenHash">;
  linkedIdentities: readonly PazaakLinkedIdentityRecord[];
}

// ---------------------------------------------------------------------------
// Discord token verification
// ---------------------------------------------------------------------------

const DISCORD_API = "https://discord.com/api/v10";
const APP_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const OAUTH_PROVIDER_ENV = {
  google: {
    clientId: "PAZAAK_OAUTH_GOOGLE_CLIENT_ID",
    clientSecret: "PAZAAK_OAUTH_GOOGLE_CLIENT_SECRET",
    callbackUrl: "PAZAAK_OAUTH_GOOGLE_CALLBACK_URL",
    startUrl: "PAZAAK_OAUTH_GOOGLE_URL",
  },
  discord: {
    clientId: "PAZAAK_OAUTH_DISCORD_CLIENT_ID",
    clientSecret: "PAZAAK_OAUTH_DISCORD_CLIENT_SECRET",
    callbackUrl: "PAZAAK_OAUTH_DISCORD_CALLBACK_URL",
    startUrl: "PAZAAK_OAUTH_DISCORD_URL",
  },
  github: {
    clientId: "PAZAAK_OAUTH_GITHUB_CLIENT_ID",
    clientSecret: "PAZAAK_OAUTH_GITHUB_CLIENT_SECRET",
    callbackUrl: "PAZAAK_OAUTH_GITHUB_CALLBACK_URL",
    startUrl: "PAZAAK_OAUTH_GITHUB_URL",
  },
} as const;

type SocialAuthProvider = keyof typeof OAUTH_PROVIDER_ENV;

const SOCIAL_PROVIDERS = Object.keys(OAUTH_PROVIDER_ENV) as SocialAuthProvider[];

const resolveOauthConfig = (provider: SocialAuthProvider) => {
  const env = OAUTH_PROVIDER_ENV[provider];
  const clientId = (process.env[env.clientId]?.trim()
    || (provider === "discord" ? process.env.PAZAAK_DISCORD_APP_ID?.trim() : "")
    || "");
  const clientSecret = (process.env[env.clientSecret]?.trim()
    || (provider === "discord" ? process.env.PAZAAK_DISCORD_CLIENT_SECRET?.trim() : "")
    || "");
  const callbackUrl = process.env[env.callbackUrl]?.trim() ?? "";
  const startUrl = process.env[env.startUrl]?.trim() ?? "";

  return {
    clientId,
    clientSecret,
    callbackUrl,
    startUrl,
    enabled: Boolean(clientId && clientSecret),
  };
};

const getSessionExpiresAt = (): string => new Date(Date.now() + APP_SESSION_TTL_MS).toISOString();
const resolveGameUserId = (account: PazaakAccountRecord): string => account.legacyGameUserId ?? account.accountId;

const serializeSession = async (
  accountRepository: JsonPazaakAccountRepository,
  account: PazaakAccountRecord,
  session: PazaakAccountSessionRecord,
): Promise<SerializedAccountSession> => {
  const { tokenHash: _tokenHash, ...safeSession } = session;
  return {
    account,
    session: safeSession,
    linkedIdentities: await accountRepository.listLinkedIdentities(account.accountId),
  };
};

/** Verify Bearer token → Discord user. Throws on bad/missing token. */
async function resolveDiscordUser(authHeader: string | undefined): Promise<DiscordUser> {
  if (!authHeader?.startsWith("Bearer ")) {
    throw Object.assign(new Error("Missing or malformed Authorization header."), { status: 401 });
  }

  const token = authHeader.slice(7);

  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw Object.assign(new Error("Invalid Discord access token."), { status: 401 });
  }

  return res.json() as Promise<DiscordUser>;
}

// ---------------------------------------------------------------------------
// JSON serialization helpers  (Set<string> → string[] before sending)
// ---------------------------------------------------------------------------

const safeSerialize = (match: PazaakMatch) => serializeMatch(match);

// ---------------------------------------------------------------------------
// Chat message type
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  matchId: string;
  userId: string;
  displayName: string;
  text: string;
  at: number;
}

// ---------------------------------------------------------------------------
// WebSocket hub — broadcast match updates to all subscribed clients
// ---------------------------------------------------------------------------

type WsClient = {
  ws: WebSocket;
  stream: "match" | "lobbies";
  matchId: string;
};

class WsHub {
  private readonly clients = new Set<WsClient>();
  private readonly wss: WebSocketServer;
  private readonly chatHistory = new Map<string, ChatMessage[]>();

  public constructor(server: http.Server) {
    this.wss = new WebSocketServer({ server, path: "/ws" });

    this.wss.on("connection", (ws, req) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const stream = url.searchParams.get("stream") === "lobbies" ? "lobbies" : "match";
      const matchId = url.searchParams.get("matchId") ?? "";
      const entry: WsClient = { ws, stream, matchId };
      this.clients.add(entry);

      ws.on("close", () => {
        this.clients.delete(entry);
      });

      ws.on("error", () => {
        this.clients.delete(entry);
      });
    });
  }

  /** Push a serialized match snapshot to all subscribers of that match. */
  public broadcast(match: PazaakMatch): void {
    const payload = JSON.stringify({ type: "match_update", data: safeSerialize(match) });

    for (const client of this.clients) {
      if (client.stream === "match" && client.matchId === match.id && client.ws.readyState === 1 /* OPEN */) {
        try {
          client.ws.send(payload);
        } catch {
          // Ignore send errors; client will be cleaned up on close.
        }
      }
    }
  }

  /** Push a single lobby snapshot to all lobby stream subscribers. */
  public broadcastLobby(lobby: PazaakLobbyRecord): void {
    const payload = JSON.stringify({ type: "lobby_update", data: lobby });

    for (const client of this.clients) {
      if (client.stream === "lobbies" && client.ws.readyState === 1 /* OPEN */) {
        try {
          client.ws.send(payload);
        } catch {
          // Ignore send errors; client will be cleaned up on close.
        }
      }
    }
  }

  /** Persist a chat message and push it to all match subscribers. */
  public broadcastChatMessage(matchId: string, msg: ChatMessage): void {
    const history = this.chatHistory.get(matchId) ?? [];
    history.push(msg);
    if (history.length > 100) history.splice(0, history.length - 100);
    this.chatHistory.set(matchId, history);

    const payload = JSON.stringify({ type: "chat_message", data: msg });
    for (const client of this.clients) {
      if (client.stream === "match" && client.matchId === matchId && client.ws.readyState === 1) {
        try { client.ws.send(payload); } catch { /* ignore */ }
      }
    }
  }

  /** Return stored chat history for a match. */
  public getChatHistory(matchId: string): ChatMessage[] {
    return this.chatHistory.get(matchId) ?? [];
  }

  /** Push the current open lobby list to all lobby stream subscribers. */
  public broadcastLobbyList(lobbies: readonly PazaakLobbyRecord[]): void {
    const payload = JSON.stringify({ type: "lobby_list_update", data: lobbies });

    for (const client of this.clients) {
      if (client.stream === "lobbies" && client.ws.readyState === 1 /* OPEN */) {
        try {
          client.ws.send(payload);
        } catch {
          // Ignore send errors; client will be cleaned up on close.
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// API Server factory
// ---------------------------------------------------------------------------

export function createApiServer(
  coordinator: PazaakCoordinator,
  opts: {
    port: number;
    discordAppId: string;
    discordClientSecret: string | undefined;
    activityOrigin: string;
    publicWebOrigin: string | undefined;
    accountRepository: JsonPazaakAccountRepository;
    walletRepository: JsonWalletRepository;
    sideboardRepository: JsonPazaakSideboardRepository;
    matchmakingQueueRepository: JsonPazaakMatchmakingQueueRepository;
    lobbyRepository: JsonPazaakLobbyRepository;
    matchHistoryRepository: JsonPazaakMatchHistoryRepository;
    matchmakingTickMs?: number | undefined;
    allowDevAuth?: boolean | undefined;
  },
): { server: http.Server; hub: WsHub; listen: () => void } {
  const app = express();

  app.use(express.json());

  // Allow the Discord Activity iframe and localhost browser origins.
  app.use((req, res, next) => {
    const allowedOrigins = [
      `https://${opts.discordAppId}.discordsays.com`,
      "http://localhost:5173",
      "http://localhost:3000",
      opts.activityOrigin,
      opts.publicWebOrigin,
    ].filter(Boolean);

    const origin = req.headers.origin ?? "";
    if (allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    res.setHeader("Vary", "Origin");

    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }

    next();
  });

  // withAuth — wraps a handler that needs a verified Pazaak account.
  type AuthedHandler = (req: Request, res: Response, user: AuthenticatedPazaakUser) => void | Promise<void>;

  const resolveDevUser = async (authHeader: string | undefined): Promise<AuthenticatedPazaakUser | null> => {
    if (!opts.allowDevAuth) {
      return null;
    }

    if (!authHeader?.startsWith("Bearer ")) {
      return null;
    }

    const token = authHeader.slice(7);
    if (!token.startsWith("dev-user-")) {
      return null;
    }

    const rawId = token.slice("dev-user-".length).trim();
    if (!rawId) {
      throw Object.assign(new Error("Invalid dev auth token format."), { status: 401 });
    }

    const decoded = decodeURIComponent(rawId);
    const username = decoded.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 32) || "devuser";
    const { account } = await opts.accountRepository.ensureDiscordAccount({
      discordUserId: decoded,
      username,
      displayName: decoded,
    });

    return {
      id: resolveGameUserId(account),
      accountId: account.accountId,
      username,
      displayName: decoded,
      source: "dev",
      discordUserId: decoded,
    };
  };

  const resolveAuthenticatedUser = async (authHeader: string | undefined): Promise<AuthenticatedPazaakUser> => {
    if (!authHeader?.startsWith("Bearer ")) {
      throw Object.assign(new Error("Missing or malformed Authorization header."), { status: 401 });
    }

    const token = authHeader.slice(7);
    const session = await opts.accountRepository.resolveSessionToken(token);
    if (session) {
      return {
        id: resolveGameUserId(session.account),
        accountId: session.account.accountId,
        username: session.account.username,
        displayName: session.account.displayName,
        source: "session",
        sessionId: session.session.sessionId,
      };
    }

    const devUser = await resolveDevUser(authHeader);
    if (devUser) {
      return devUser;
    }

    const discordUser = await resolveDiscordUser(authHeader);
    const displayName = resolveDiscordDisplayName(discordUser);
    const { account } = await opts.accountRepository.ensureDiscordAccount({
      discordUserId: discordUser.id,
      username: discordUser.username,
      displayName,
    });

    return {
      id: resolveGameUserId(account),
      accountId: account.accountId,
      username: account.username,
      displayName,
      source: "discord",
      discordUserId: discordUser.id,
    };
  };

  const withAuth = (handler: AuthedHandler) => {
    return async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
      try {
        const user = await resolveAuthenticatedUser(req.headers.authorization);
        await handler(req, res, user);
      } catch (err: unknown) {
        const status = (err as { status?: number }).status ?? 500;
        const message = err instanceof Error ? err.message : String(err);
        res.status(status).json({ error: message });
      }
    };
  };

  // Helper: extract a string path param (Express 5 params can be string | string[]).
  const param = (req: Request, name: string): string => String(req.params[name] ?? "");
  const resolveDiscordDisplayName = (user: DiscordUser): string => user.global_name?.trim() || user.username;
  const resolveDisplayName = (user: AuthenticatedPazaakUser): string => user.displayName;

  const normalizeSideboardTokens = (value: unknown): string[] => {
    if (!Array.isArray(value) || value.length !== SIDE_DECK_SIZE) {
      throw Object.assign(new Error(`Body must include exactly ${SIDE_DECK_SIZE} sideboard tokens.`), { status: 422 });
    }

    return value.map((token, index) => {
      if (typeof token !== "string") {
        throw Object.assign(new Error(`Token ${index + 1} must be a string.`), { status: 422 });
      }

      const normalized = normalizeSideDeckToken(token);

      if (!normalized) {
        throw Object.assign(new Error(`Unsupported sideboard token: ${token}`), { status: 422 });
      }

      return normalized;
    });
  };

  const parseAiDifficulty = (value: unknown): AiDifficulty => {
    if (value === "easy" || value === "hard" || value === "professional") {
      return value;
    }

    throw Object.assign(new Error("AI difficulty must be easy, hard, or professional."), { status: 422 });
  };

  const parseThemePreference = (value: unknown): PazaakThemePreference | undefined => {
    if (value === undefined) return undefined;
    if (value === "kotor" || value === "modern" || value === "adaptive") return value;
    throw Object.assign(new Error("Theme must be kotor, modern, or adaptive."), { status: 422 });
  };

  type PendingOauthState = {
    provider: SocialAuthProvider;
    expiresAt: number;
    accountId?: string;
  };

  const oauthStateStore = new Map<string, PendingOauthState>();
  const OAUTH_STATE_TTL_MS = 1000 * 60 * 10;
  const oauthLandingBase = opts.publicWebOrigin?.trim() || "http://localhost:5173";

  const cleanupOauthState = (): void => {
    const now = Date.now();
    for (const [key, entry] of oauthStateStore.entries()) {
      if (entry.expiresAt <= now) {
        oauthStateStore.delete(key);
      }
    }
  };

  const createOauthState = (provider: SocialAuthProvider, accountId?: string): string => {
    cleanupOauthState();
    const state = randomUUID().replace(/-/g, "");
    oauthStateStore.set(state, {
      provider,
      expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
      ...(accountId ? { accountId } : {}),
    });
    return state;
  };

  const consumeOauthState = (state: string, provider: SocialAuthProvider): PendingOauthState => {
    cleanupOauthState();
    const entry = oauthStateStore.get(state);
    oauthStateStore.delete(state);

    if (!entry || entry.expiresAt <= Date.now() || entry.provider !== provider) {
      throw Object.assign(new Error("OAuth state is invalid or expired."), { status: 401 });
    }

    return entry;
  };

  const resolveCallbackUrl = (provider: SocialAuthProvider, configured: string): string => {
    if (configured) {
      return configured;
    }
    return `${oauthLandingBase.replace(/\/$/u, "")}/api/auth/oauth/${provider}/callback`;
  };

  const fetchGoogleProfile = async (code: string): Promise<{ providerUserId: string; username: string; displayName: string; email: string | null }> => {
    const config = resolveOauthConfig("google");
    const callbackUrl = resolveCallbackUrl("google", config.callbackUrl);
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: callbackUrl,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const message = await tokenRes.text();
      throw Object.assign(new Error(`Google token exchange failed: ${message}`), { status: 401 });
    }

    const tokenBody = await tokenRes.json() as { access_token?: string };
    const accessToken = tokenBody.access_token;
    if (!accessToken) {
      throw Object.assign(new Error("Google token response did not include an access token."), { status: 401 });
    }

    const profileRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profileRes.ok) {
      const message = await profileRes.text();
      throw Object.assign(new Error(`Google profile fetch failed: ${message}`), { status: 401 });
    }

    const profile = await profileRes.json() as GoogleUser;
    return {
      providerUserId: profile.sub,
      username: profile.email?.split("@")[0] || profile.name || "google-user",
      displayName: profile.name || profile.given_name || profile.email || "Google User",
      email: profile.email?.trim() || null,
    };
  };

  const fetchDiscordProfile = async (code: string): Promise<{ providerUserId: string; username: string; displayName: string; email: string | null }> => {
    const config = resolveOauthConfig("discord");
    const callbackUrl = resolveCallbackUrl("discord", config.callbackUrl);
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: callbackUrl,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const message = await tokenRes.text();
      throw Object.assign(new Error(`Discord token exchange failed: ${message}`), { status: 401 });
    }

    const tokenBody = await tokenRes.json() as { access_token?: string };
    const accessToken = tokenBody.access_token;
    if (!accessToken) {
      throw Object.assign(new Error("Discord token response did not include an access token."), { status: 401 });
    }

    const profileRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profileRes.ok) {
      const message = await profileRes.text();
      throw Object.assign(new Error(`Discord profile fetch failed: ${message}`), { status: 401 });
    }

    const profile = await profileRes.json() as DiscordUser & { email?: string | null };
    return {
      providerUserId: profile.id,
      username: profile.username,
      displayName: resolveDiscordDisplayName(profile),
      email: profile.email?.trim() || null,
    };
  };

  const fetchGithubProfile = async (code: string): Promise<{ providerUserId: string; username: string; displayName: string; email: string | null }> => {
    const config = resolveOauthConfig("github");
    const callbackUrl = resolveCallbackUrl("github", config.callbackUrl);
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: callbackUrl,
      }),
    });

    if (!tokenRes.ok) {
      const message = await tokenRes.text();
      throw Object.assign(new Error(`GitHub token exchange failed: ${message}`), { status: 401 });
    }

    const tokenBody = await tokenRes.json() as { access_token?: string };
    const accessToken = tokenBody.access_token;
    if (!accessToken) {
      throw Object.assign(new Error("GitHub token response did not include an access token."), { status: 401 });
    }

    const profileRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (!profileRes.ok) {
      const message = await profileRes.text();
      throw Object.assign(new Error(`GitHub profile fetch failed: ${message}`), { status: 401 });
    }

    const profile = await profileRes.json() as GithubUser;
    let email = profile.email?.trim() || null;
    if (!email) {
      const emailsRes = await fetch("https://api.github.com/user/emails", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
        },
      });
      if (emailsRes.ok) {
        const emails = await emailsRes.json() as Array<{ email: string; primary?: boolean; verified?: boolean }>;
        email = emails.find((entry) => entry.primary && entry.verified)?.email
          ?? emails.find((entry) => entry.verified)?.email
          ?? emails[0]?.email
          ?? null;
      }
    }

    return {
      providerUserId: String(profile.id),
      username: profile.login,
      displayName: profile.name || profile.login,
      email,
    };
  };

  const settleCompletedMatch = async (match: PazaakMatch): Promise<void> => {
    if (match.phase !== "completed" || match.settled || !match.winnerId || !match.winnerName || !match.loserId || !match.loserName) {
      return;
    }

    await opts.walletRepository.recordMatch({
      winnerId: match.winnerId,
      winnerName: match.winnerName,
      loserId: match.loserId,
      loserName: match.loserName,
      wager: match.wager,
    });
    await opts.matchHistoryRepository.append({
      matchId: match.id,
      channelId: match.channelId,
      winnerId: match.winnerId,
      winnerName: match.winnerName,
      loserId: match.loserId,
      loserName: match.loserName,
      wager: match.wager,
      completedAt: new Date(match.updatedAt).toISOString(),
      summary: match.statusLine,
    });
    coordinator.markSettled(match.id);
  };

  const broadcastLobbyState = async (lobby?: PazaakLobbyRecord | null): Promise<void> => {
    if (lobby) {
      hub.broadcastLobby(lobby);
    }
    const openLobbies = await opts.lobbyRepository.listOpen();
    hub.broadcastLobbyList(openLobbies);
  };

  let backgroundTickRunning = false;

  const runBackgroundTick = async (): Promise<void> => {
    if (backgroundTickRunning) {
      return;
    }

    backgroundTickRunning = true;

    try {
      const now = Date.now();
      const timerUpdates = coordinator.tickTurnTimers(now);
      const disconnectUpdates = coordinator.tickDisconnectForfeits(now);
      const updatesByMatchId = new Map<string, PazaakMatch>();

      for (const update of [...timerUpdates, ...disconnectUpdates]) {
        updatesByMatchId.set(update.id, update);
      }

      for (const update of updatesByMatchId.values()) {
        await settleCompletedMatch(update);
        hub.broadcast(update);
      }

      const queue = await opts.matchmakingQueueRepository.list();
      const available = [...queue].sort((left, right) => left.enqueuedAt.localeCompare(right.enqueuedAt));

      const mmrTolerance = (mmr: number): number => {
        if (mmr < 1000) return 200;
        if (mmr < 1500) return 150;
        return 300;
      };

      for (let index = 0; index + 1 < available.length; index += 2) {
        const first = available[index]!;
        const second = available[index + 1]!;

        if (first.userId === second.userId) {
          await opts.matchmakingQueueRepository.remove(second.userId);
          continue;
        }

        const mmrDiff = Math.abs(first.mmr - second.mmr);
        const tolerance = Math.max(mmrTolerance(first.mmr), mmrTolerance(second.mmr));
        if (mmrDiff > tolerance) {
          // Players are too far apart in skill — skip this pair.
          continue;
        }

        if (coordinator.getActiveMatchForUser(first.userId) || coordinator.getActiveMatchForUser(second.userId)) {
          await opts.matchmakingQueueRepository.remove(first.userId);
          await opts.matchmakingQueueRepository.remove(second.userId);
          continue;
        }

        try {
          const match = coordinator.createDirectMatch({
            channelId: `matchmaking:${first.userId}:${second.userId}`,
            challengerId: first.userId,
            challengerName: first.displayName,
            opponentId: second.userId,
            opponentName: second.displayName,
          });
          await opts.matchmakingQueueRepository.remove(first.userId);
          await opts.matchmakingQueueRepository.remove(second.userId);
          hub.broadcast(match);
        } catch {
          // Skip pairing errors for this tick and try again on the next tick.
        }
      }
    } finally {
      backgroundTickRunning = false;
    }
  };

  // -------------------------------------------------------------------------
  // Routes
  // -------------------------------------------------------------------------

  /**
   * POST /api/auth/token
   * Exchanges a Discord OAuth2 authorization code for an access token.
   * Required by the Discord Embedded App SDK auth flow.
   * Body: { code: string }
   */
  app.post("/api/auth/token", async (req, res): Promise<void> => {
    const { code } = req.body as { code?: string };

    if (typeof code !== "string" || !code) {
      res.status(422).json({ error: "Body must include a code string." });
      return;
    }

    if (!opts.discordClientSecret) {
      res.status(501).json({ error: "OAuth2 token exchange is not configured on this server." });
      return;
    }

    const params = new URLSearchParams({
      client_id: opts.discordAppId,
      client_secret: opts.discordClientSecret,
      grant_type: "authorization_code",
      code,
    });

    const discordRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!discordRes.ok) {
      const text = await discordRes.text();
      res.status(401).json({ error: `Token exchange failed: ${text}` });
      return;
    }

    const data = await discordRes.json() as { access_token: string };
    const discordUser = await resolveDiscordUser(`Bearer ${data.access_token}`);
    const { account } = await opts.accountRepository.ensureDiscordAccount({
      discordUserId: discordUser.id,
      username: discordUser.username,
      displayName: resolveDiscordDisplayName(discordUser),
    });
    const { token: appToken, session } = await opts.accountRepository.createSession(account.accountId, {
      expiresAt: getSessionExpiresAt(),
      label: "Discord Activity",
    });

    res.json({
      access_token: data.access_token,
      app_token: appToken,
      token_type: "Bearer",
      ...(await serializeSession(opts.accountRepository, account, session)),
    });
  });

  app.post("/api/auth/register", async (req, res): Promise<void> => {
    const body = req.body as { username?: unknown; displayName?: unknown; email?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : undefined;
    const email = typeof body.email === "string" ? body.email.trim() : undefined;
    const password = typeof body.password === "string" ? body.password : "";

    if (username.length < 3 || username.length > 32) {
      res.status(422).json({ error: "Username must be between 3 and 32 characters." });
      return;
    }

    if (password.length < 10) {
      res.status(422).json({ error: "Password must be at least 10 characters." });
      return;
    }

    try {
      const account = await opts.accountRepository.createPasswordAccount({
        username,
        displayName,
        email,
        passwordHash: await hashPazaakPassword(password),
      });
      const { token: appToken, session } = await opts.accountRepository.createSession(account.accountId, {
        expiresAt: getSessionExpiresAt(),
        label: "Password Login",
      });
      res.status(201).json({ app_token: appToken, token_type: "Bearer", ...(await serializeSession(opts.accountRepository, account, session)) });
    } catch (err) {
      res.status(409).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/auth/login", async (req, res): Promise<void> => {
    const body = req.body as { identifier?: unknown; username?: unknown; password?: unknown };
    const identifier = typeof body.identifier === "string"
      ? body.identifier.trim()
      : typeof body.username === "string"
        ? body.username.trim()
        : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!identifier || !password) {
      res.status(422).json({ error: "Identifier and password are required." });
      return;
    }

    const record = await opts.accountRepository.findPasswordAccount(identifier);

    if (!record || !(await verifyPazaakPassword(password, record.credential.passwordHash))) {
      res.status(401).json({ error: "Invalid username/email or password." });
      return;
    }

    const { token: appToken, session } = await opts.accountRepository.createSession(record.account.accountId, {
      expiresAt: getSessionExpiresAt(),
      label: "Password Login",
    });
    res.json({ app_token: appToken, token_type: "Bearer", ...(await serializeSession(opts.accountRepository, record.account, session)) });
  });

  app.get("/api/auth/session", withAuth(async (_req, res, user) => {
    const account = await opts.accountRepository.getAccount(user.accountId);
    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    res.json({ account, linkedIdentities: await opts.accountRepository.listLinkedIdentities(account.accountId), user });
  }));

  app.post("/api/auth/logout", withAuth(async (_req, res, user) => {
    if (user.sessionId) {
      await opts.accountRepository.deleteSession(user.sessionId);
    }

    res.json({ ok: true });
  }));

  app.get("/api/auth/linked-identities", withAuth(async (_req, res, user) => {
    res.json({ linkedIdentities: await opts.accountRepository.listLinkedIdentities(user.accountId) });
  }));

  app.post("/api/auth/discord/link", withAuth(async (req, res, user) => {
    const { access_token: accessToken } = req.body as { access_token?: unknown };

    if (typeof accessToken !== "string" || !accessToken) {
      res.status(422).json({ error: "Body must include a Discord access_token." });
      return;
    }

    try {
      const discordUser = await resolveDiscordUser(`Bearer ${accessToken}`);
      const identity = await opts.accountRepository.linkDiscordAccount(user.accountId, {
        discordUserId: discordUser.id,
        username: discordUser.username,
        displayName: resolveDiscordDisplayName(discordUser),
      });
      res.json({ identity, linkedIdentities: await opts.accountRepository.listLinkedIdentities(user.accountId) });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 409;
      res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }));

  /** GET /api/health  —  basic liveness check */
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  /** HEAD/GET /api/ping  —  lightweight latency probe for Activity connection status. */
  app.head("/api/ping", (_req, res) => {
    res.status(204).end();
  });

  app.get("/api/ping", (_req, res) => {
    res.status(204).end();
  });

  app.get("/api/ui/main-menu", (_req, res) => {
    res.json({
      preset: MAIN_MENU_PRESET,
      serverTime: new Date().toISOString(),
    });
  });

  app.get("/api/pazaak/opponents", (_req, res) => {
    res.json({
      opponents: pazaakOpponents,
      serverTime: new Date().toISOString(),
    });
  });

  app.get("/api/auth/oauth/providers", (_req, res) => {
    res.json({
      providers: SOCIAL_PROVIDERS.map((provider) => ({
        provider,
        enabled: resolveOauthConfig(provider).enabled,
      })),
    });
  });

  const buildProviderAuthorizeUrl = (provider: SocialAuthProvider, state: string): string => {
    const config = resolveOauthConfig(provider);
    const callbackUrl = resolveCallbackUrl(provider, config.callbackUrl);

    if (config.startUrl) {
      return config.startUrl
        .replaceAll("{state}", encodeURIComponent(state))
        .replaceAll("{callback}", encodeURIComponent(callbackUrl))
        .replaceAll("{clientId}", encodeURIComponent(config.clientId));
    }

    if (provider === "google") {
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", callbackUrl);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid profile email");
      url.searchParams.set("access_type", "online");
      url.searchParams.set("prompt", "select_account");
      url.searchParams.set("state", state);
      return url.toString();
    }

    if (provider === "discord") {
      const url = new URL(`${DISCORD_API}/oauth2/authorize`);
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", callbackUrl);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "identify email");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("state", state);
      return url.toString();
    }

    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", callbackUrl);
    url.searchParams.set("scope", "read:user user:email");
    url.searchParams.set("state", state);
    return url.toString();
  };

  app.post("/api/auth/oauth/:provider/start", async (req, res) => {
    const providerParam = (req.params.provider ?? "").toLowerCase();
    if (!SOCIAL_PROVIDERS.includes(providerParam as SocialAuthProvider)) {
      res.status(404).json({ error: "Unsupported OAuth provider." });
      return;
    }

    const provider = providerParam as SocialAuthProvider;
    const config = resolveOauthConfig(provider);
    if (!config.enabled) {
      res.status(501).json({
        error: `OAuth provider ${provider} is not configured on this server.`,
      });
      return;
    }

    let accountId: string | undefined;
    try {
      const user = await resolveAuthenticatedUser(req.headers.authorization);
      accountId = user.accountId;
    } catch {
      // Continue as login flow for anonymous users.
    }

    const state = createOauthState(provider, accountId);
    const redirectUrl = buildProviderAuthorizeUrl(provider, state);

    res.json({ provider, redirectUrl });
  });

  app.get("/api/auth/oauth/:provider/callback", async (req, res) => {
    const providerParam = (req.params.provider ?? "").toLowerCase();
    if (!SOCIAL_PROVIDERS.includes(providerParam as SocialAuthProvider)) {
      res.status(404).send("Unsupported OAuth provider.");
      return;
    }

    const provider = providerParam as SocialAuthProvider;
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const error = typeof req.query.error === "string" ? req.query.error : "";

    const redirect = new URL("/", oauthLandingBase);

    if (error) {
      redirect.searchParams.set("oauth_error", error);
      if (typeof req.query.error_description === "string") {
        redirect.searchParams.set("oauth_error_description", req.query.error_description);
      }
      res.redirect(302, redirect.toString());
      return;
    }

    if (!code || !state) {
      redirect.searchParams.set("oauth_error", "missing_code_or_state");
      res.redirect(302, redirect.toString());
      return;
    }

    try {
      const pending = consumeOauthState(state, provider);
      const profile = provider === "google"
        ? await fetchGoogleProfile(code)
        : provider === "discord"
          ? await fetchDiscordProfile(code)
          : await fetchGithubProfile(code);

      if (pending.accountId) {
        await opts.accountRepository.linkExternalIdentity(pending.accountId, {
          provider,
          providerUserId: profile.providerUserId,
          username: profile.username,
          displayName: profile.displayName,
        });
        const account = await opts.accountRepository.getAccount(pending.accountId);
        if (!account) {
          throw Object.assign(new Error("Account not found after linking OAuth identity."), { status: 404 });
        }
        const { token: appToken } = await opts.accountRepository.createSession(account.accountId, {
          expiresAt: getSessionExpiresAt(),
          label: `${provider} OAuth`,
        });
        redirect.searchParams.set("oauth_provider", provider);
        redirect.searchParams.set("oauth_app_token", appToken);
        redirect.searchParams.set("oauth_username", account.displayName);
        redirect.searchParams.set("oauth_user_id", resolveGameUserId(account));
        res.redirect(302, redirect.toString());
        return;
      }

      const ensured = await opts.accountRepository.ensureExternalAccount({
        provider,
        providerUserId: profile.providerUserId,
        username: profile.username,
        displayName: profile.displayName,
        email: profile.email,
        legacyGameUserId: provider === "discord" ? profile.providerUserId : null,
      });
      const { token: appToken } = await opts.accountRepository.createSession(ensured.account.accountId, {
        expiresAt: getSessionExpiresAt(),
        label: `${provider} OAuth`,
      });

      redirect.searchParams.set("oauth_provider", provider);
      redirect.searchParams.set("oauth_app_token", appToken);
      redirect.searchParams.set("oauth_username", ensured.account.displayName);
      redirect.searchParams.set("oauth_user_id", resolveGameUserId(ensured.account));
      res.redirect(302, redirect.toString());
    } catch (err) {
      redirect.searchParams.set("oauth_error", err instanceof Error ? err.message : String(err));
      res.redirect(302, redirect.toString());
    }
  });

  app.get("/api/me", withAuth(async (_req, res, user) => {
    const wallet = await opts.walletRepository.getWallet(user.id, resolveDisplayName(user));
    const queue = await opts.matchmakingQueueRepository.get(user.id);
    const match = coordinator.getActiveMatchForUser(user.id);
    res.json({ user: { id: user.id, username: user.username, displayName: resolveDisplayName(user) }, wallet, queue, match: match ? safeSerialize(match) : null });
  }));

  app.get("/api/settings", withAuth(async (_req, res, user) => {
    const settings = await opts.walletRepository.getUserSettings(user.id, resolveDisplayName(user));
    res.json({ settings });
  }));

  app.put("/api/settings", withAuth(async (req, res, user) => {
    try {
      const body = req.body as {
        theme?: unknown;
        soundEnabled?: unknown;
        reducedMotionEnabled?: unknown;
        turnTimerSeconds?: unknown;
        preferredAiDifficulty?: unknown;
      };
      const settings: Parameters<JsonWalletRepository["updateUserSettings"]>[2] = {};
      const theme = parseThemePreference(body.theme);

      if (theme !== undefined) settings.theme = theme;
      if (typeof body.soundEnabled === "boolean") settings.soundEnabled = body.soundEnabled;
      if (typeof body.reducedMotionEnabled === "boolean") settings.reducedMotionEnabled = body.reducedMotionEnabled;
      if (typeof body.turnTimerSeconds === "number") settings.turnTimerSeconds = Math.max(10, Math.min(300, Math.trunc(body.turnTimerSeconds)));
      if (body.preferredAiDifficulty !== undefined) settings.preferredAiDifficulty = parseAiDifficulty(body.preferredAiDifficulty);

      const wallet = await opts.walletRepository.updateUserSettings(user.id, resolveDisplayName(user), settings);
      res.json({ settings: wallet.userSettings, wallet });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 400;
      res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }));

  app.get("/api/leaderboard", withAuth(async (_req, res) => {
    const wallets = await opts.walletRepository.listWallets();
    const leaders = [...wallets]
      .sort((left, right) => right.mmr - left.mmr || right.gamesWon - left.gamesWon || right.balance - left.balance)
      .slice(0, 50)
      .map((wallet, index) => ({
        rank: index + 1,
        userId: wallet.userId,
        displayName: wallet.displayName,
        mmr: wallet.mmr,
        gamesPlayed: wallet.gamesPlayed,
        gamesWon: wallet.gamesWon,
        wins: wallet.wins,
        losses: wallet.losses,
        balance: wallet.balance,
      }));
    res.json({ leaders });
  }));

  app.get("/api/me/history", withAuth(async (req, res, user) => {
    const limitRaw = Number(req.query.limit ?? 25);
    const history = await opts.matchHistoryRepository.listForUser(user.id, Number.isFinite(limitRaw) ? limitRaw : 25);
    res.json({ history });
  }));

  app.post("/api/matchmaking/enqueue", withAuth(async (req, res, user) => {
    const wallet = await opts.walletRepository.getWallet(user.id, resolveDisplayName(user));
    const preferredMaxPlayers = Number((req.body as { preferredMaxPlayers?: unknown }).preferredMaxPlayers ?? 2);
    const queue = await opts.matchmakingQueueRepository.enqueue({
      userId: user.id,
      displayName: resolveDisplayName(user),
      mmr: wallet.mmr,
      preferredMaxPlayers: Number.isFinite(preferredMaxPlayers) ? preferredMaxPlayers : 2,
    });
    await broadcastLobbyState();
    res.json({ queue });
  }));

  app.post("/api/matchmaking/leave", withAuth(async (_req, res, user) => {
    const removed = await opts.matchmakingQueueRepository.remove(user.id);
    await broadcastLobbyState();
    res.json({ removed });
  }));

  app.get("/api/matchmaking/status", withAuth(async (_req, res, user) => {
    const queue = await opts.matchmakingQueueRepository.get(user.id);
    res.json({ queue: queue ?? null });
  }));

  app.get("/api/matchmaking/stats", withAuth(async (_req, res) => {
    const queue = await opts.matchmakingQueueRepository.list();
    const lobbies = await opts.lobbyRepository.listOpen();
    const activeMatches = coordinator.getActiveMatches();
    const now = Date.now();
    const averageWaitSeconds = queue.length === 0
      ? 0
      : Math.round(queue.reduce((sum, entry) => sum + Math.max(0, now - new Date(entry.enqueuedAt).getTime()), 0) / queue.length / 1000);
    const averageWaitTime = averageWaitSeconds >= 120
      ? `~${Math.max(1, Math.round(averageWaitSeconds / 60))}m`
      : `~${Math.max(0, averageWaitSeconds)}s`;

    res.json({
      playersInQueue: queue.length,
      openLobbies: lobbies.length,
      activeGames: activeMatches.length,
      averageWaitSeconds,
      averageWaitTime,
      queueUpdatedAt: new Date(now).toISOString(),
    });
  }));

  app.get("/api/lobbies", withAuth(async (_req, res) => {
    const lobbies = await opts.lobbyRepository.listOpen();
    res.json({ lobbies });
  }));

  app.post("/api/lobbies", withAuth(async (req, res, user) => {
    const body = req.body as {
      name?: unknown;
      maxPlayers?: unknown;
      password?: unknown;
      variant?: unknown;
      tableSettings?: Partial<PazaakTableSettings> | undefined;
      maxRounds?: unknown;
      turnTimerSeconds?: unknown;
      ranked?: unknown;
      allowAiFill?: unknown;
    };

    const maxPlayers = Number(body.maxPlayers ?? 2);
    const maxRounds = Number(body.maxRounds ?? 3);
    const turnTimerSeconds = Number(body.turnTimerSeconds ?? 120);
    const variant = body.variant === "multi_seat" ? "multi_seat" : "canonical";

    const tableSettings: Partial<PazaakTableSettings> = {
      ...(body.tableSettings ?? {}),
      variant,
      maxPlayers: Number.isFinite(maxPlayers) ? maxPlayers : 2,
      maxRounds: Number.isFinite(maxRounds) ? maxRounds : 3,
      turnTimerSeconds: Number.isFinite(turnTimerSeconds) ? turnTimerSeconds : 120,
    };
    if (typeof body.ranked === "boolean") {
      tableSettings.ranked = body.ranked;
    }
    if (typeof body.allowAiFill === "boolean") {
      tableSettings.allowAiFill = body.allowAiFill;
    }

    const lobby = await opts.lobbyRepository.create({
      name: typeof body.name === "string" ? body.name : `${resolveDisplayName(user)}'s Table`,
      hostUserId: user.id,
      hostName: resolveDisplayName(user),
      maxPlayers: Number.isFinite(maxPlayers) ? maxPlayers : 2,
      password: typeof body.password === "string" ? body.password : undefined,
      tableSettings,
    });
    await broadcastLobbyState(lobby);
    res.json({ lobby });
  }));

  app.post("/api/lobbies/join-by-code", withAuth(async (req, res, user) => {
    try {
      const { lobbyCode, password } = req.body as { lobbyCode?: string; password?: string };

      if (!lobbyCode || !lobbyCode.trim()) {
        res.status(422).json({ error: "Lobby code is required." });
        return;
      }

      const lobby = await opts.lobbyRepository.getByCode(lobbyCode);
      if (!lobby) {
        res.status(404).json({ error: "Lobby not found for that code." });
        return;
      }

      const joinedLobby = await opts.lobbyRepository.join(lobby.id, { userId: user.id, displayName: resolveDisplayName(user), password });
      await broadcastLobbyState(joinedLobby);
      res.json({ lobby: joinedLobby });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }));

  app.post("/api/lobbies/:lobbyId/join", withAuth(async (req, res, user) => {
    try {
      const { password } = req.body as { password?: string };
      const lobby = await opts.lobbyRepository.join(param(req, "lobbyId"), { userId: user.id, displayName: resolveDisplayName(user), password });
      await broadcastLobbyState(lobby);
      res.json({ lobby });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }));

  app.post("/api/lobbies/:lobbyId/ready", withAuth(async (req, res, user) => {
    const ready = (req.body as { ready?: unknown }).ready !== false;
    const lobby = await opts.lobbyRepository.setReady(param(req, "lobbyId"), user.id, ready);
    await broadcastLobbyState(lobby);
    res.json({ lobby });
  }));

  app.post("/api/lobbies/:lobbyId/status", withAuth(async (req, res, user) => {
    try {
      const statusRaw = (req.body as { status?: unknown }).status;
      const status = statusRaw === "matchmaking" ? "matchmaking" : "waiting";
      const lobby = await opts.lobbyRepository.setStatus(param(req, "lobbyId"), user.id, status);
      await broadcastLobbyState(lobby);
      res.json({ lobby });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 400;
      res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }));

  app.post("/api/lobbies/:lobbyId/addAi", withAuth(async (req, res, user) => {
    try {
      const difficulty = parseAiDifficulty((req.body as { difficulty?: unknown }).difficulty ?? "professional");
      const lobby = await opts.lobbyRepository.addAi(param(req, "lobbyId"), user.id, difficulty);
      await broadcastLobbyState(lobby);
      res.json({ lobby });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 400;
      res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }));

  app.post("/api/lobbies/:lobbyId/ai/:aiUserId/difficulty", withAuth(async (req, res, user) => {
    try {
      const difficulty = parseAiDifficulty((req.body as { difficulty?: unknown }).difficulty ?? "professional");
      const lobby = await opts.lobbyRepository.updateAiDifficulty(
        param(req, "lobbyId"),
        user.id,
        decodeURIComponent(param(req, "aiUserId")),
        difficulty,
      );
      await broadcastLobbyState(lobby);
      res.json({ lobby });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 400;
      res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }));

  app.post("/api/lobbies/:lobbyId/leave", withAuth(async (req, res, user) => {
    const lobby = await opts.lobbyRepository.leave(param(req, "lobbyId"), user.id);
    await broadcastLobbyState(lobby);
    res.json({ lobby: lobby ?? null });
  }));

  app.post("/api/lobbies/:lobbyId/start", withAuth(async (req, res, user) => {
    try {
      const lobby = await opts.lobbyRepository.get(param(req, "lobbyId"));

      if (!lobby) {
        res.status(404).json({ error: "Lobby not found." });
        return;
      }

      if (lobby.hostUserId !== user.id) {
        res.status(403).json({ error: "Only the lobby host can start the match." });
        return;
      }

      const readyPlayers = lobby.players.filter((player) => player.ready);

      if (lobby.tableSettings.variant === "canonical" && lobby.players.length !== 2) {
        res.status(409).json({ error: "Canonical tables start once exactly two seats are occupied and ready." });
        return;
      }

      if (readyPlayers.length !== 2) {
        res.status(409).json({ error: "Select exactly two ready seats before starting. Multi-seat lobbies can keep additional non-ready seats waiting." });
        return;
      }

      const [challenger, opponent] = readyPlayers;
      const match = coordinator.createDirectMatch({
        channelId: `lobby:${lobby.id}`,
        challengerId: challenger!.userId,
        challengerName: challenger!.displayName,
        opponentId: opponent!.userId,
        opponentName: opponent!.displayName,
        opponentAiDifficulty: opponent!.aiDifficulty,
      });
      const updatedLobby = await opts.lobbyRepository.markInGame(lobby.id, match.id);
      hub.broadcast(match);
      await broadcastLobbyState(updatedLobby);
      res.json({ lobby: updatedLobby, match: safeSerialize(match) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }));

  /**
   * GET /api/match/me
   * Returns the caller's active match (or 404 if none).
   */
  app.get("/api/match/me", withAuth((req, res, user) => {
    const match = coordinator.getActiveMatchForUser(user.id);

    if (!match) {
      res.status(404).json({ error: "No active match." });
      return;
    }

    res.json({ match: safeSerialize(match) });
  }));

  /**
   * GET /api/match/:matchId
   * Returns a single match by ID.
   */
  app.get("/api/match/:matchId", withAuth((req, res) => {
    const match = coordinator.getMatch(param(req, "matchId"));

    if (!match) {
      res.status(404).json({ error: "Match not found." });
      return;
    }

    res.json({ match: safeSerialize(match) });
  }));

  /**
   * GET /api/sideboards
   * Returns the caller's saved named custom sideboards.
   */
  app.get("/api/sideboards", withAuth(async (_req, res, user) => {
    const sideboards = await opts.sideboardRepository.listSideboards(user.id, resolveDisplayName(user));
    res.json({ sideboards });
  }));

  /**
   * PUT /api/sideboards/:name
   * Creates or updates one named saved sideboard.
   * Body: { tokens: string[]; makeActive?: boolean }
   */
  app.put("/api/sideboards/:name", withAuth(async (req, res, user) => {
    const sideboardName = param(req, "name").trim();

    if (!sideboardName) {
      res.status(422).json({ error: "Sideboard name is required." });
      return;
    }

    try {
      const { makeActive } = req.body as { makeActive?: boolean };
      const tokens = normalizeSideboardTokens((req.body as { tokens?: unknown }).tokens);
      const sideboard = await opts.sideboardRepository.saveSideboard(
        user.id,
        resolveDisplayName(user),
        tokens,
        sideboardName,
        makeActive ?? true,
      );
      const sideboards = await opts.sideboardRepository.listSideboards(user.id, resolveDisplayName(user));
      res.json({ sideboard, sideboards });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 400;
      res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }));

  /**
   * POST /api/sideboards/active
   * Sets the active named sideboard.
   * Body: { name: string }
   */
  app.post("/api/sideboards/active", withAuth(async (req, res, user) => {
    const { name } = req.body as { name?: string };

    if (typeof name !== "string" || !name.trim()) {
      res.status(422).json({ error: "Body must include a sideboard name." });
      return;
    }

    try {
      const sideboard = await opts.sideboardRepository.setActiveSideboard(user.id, resolveDisplayName(user), name);
      const sideboards = await opts.sideboardRepository.listSideboards(user.id, resolveDisplayName(user));
      res.json({ sideboard, sideboards });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }));

  /**
   * DELETE /api/sideboards/:name
   * Deletes one named saved sideboard.
   */
  app.delete("/api/sideboards/:name", withAuth(async (req, res, user) => {
    const sideboardName = param(req, "name").trim();

    if (!sideboardName) {
      res.status(422).json({ error: "Sideboard name is required." });
      return;
    }

    const removed = await opts.sideboardRepository.clearSideboard(user.id, sideboardName);

    if (!removed) {
      res.status(404).json({ error: `No saved sideboard named \"${sideboardName}\" exists.` });
      return;
    }

    const sideboards = await opts.sideboardRepository.listSideboards(user.id, resolveDisplayName(user));
    res.json({ sideboards });
  }));

  /**
   * POST /api/match/:matchId/draw
   * Draw the next card from the main deck.
   */
  app.post("/api/match/:matchId/draw", withAuth(async (req, res, user) => {
    try {
      const match = coordinator.draw(param(req, "matchId"), user.id);
      await settleCompletedMatch(match);
      hub.broadcast(match);
      res.json({ match: safeSerialize(match) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }));

  /**
   * POST /api/match/:matchId/stand
   * Stand on the current total.
   */
  app.post("/api/match/:matchId/stand", withAuth(async (req, res, user) => {
    try {
      const match = coordinator.stand(param(req, "matchId"), user.id);
      await settleCompletedMatch(match);
      hub.broadcast(match);
      res.json({ match: safeSerialize(match) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }));

  /**
   * POST /api/match/:matchId/endturn
   * End the turn without standing.
   */
  app.post("/api/match/:matchId/endturn", withAuth(async (req, res, user) => {
    try {
      const match = coordinator.endTurn(param(req, "matchId"), user.id);
      await settleCompletedMatch(match);
      hub.broadcast(match);
      res.json({ match: safeSerialize(match) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }));

  /**
   * POST /api/match/:matchId/play
   * Play a side card from the hand.
   * Body: { cardId: string; appliedValue: number }
   */
  app.post("/api/match/:matchId/play", withAuth(async (req, res, user) => {
    const { cardId, appliedValue } = req.body as { cardId?: string; appliedValue?: number };

    if (typeof cardId !== "string" || typeof appliedValue !== "number") {
      res.status(422).json({ error: "Body must include cardId (string) and appliedValue (number)." });
      return;
    }

    try {
      const match = coordinator.playSideCard(param(req, "matchId"), user.id, cardId, appliedValue);
      await settleCompletedMatch(match);
      hub.broadcast(match);
      res.json({ match: safeSerialize(match) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }));

  /**
   * POST /api/match/:matchId/forfeit
   * Forfeit the match.
   */
  const forfeitHandler = withAuth(async (req, res, user) => {
    try {
      const match = coordinator.forfeit(param(req, "matchId"), user.id);
      await settleCompletedMatch(match);
      hub.broadcast(match);
      res.json({ match: safeSerialize(match) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/match/:matchId/forfeit", forfeitHandler);
  app.post("/api/match/:matchId/concede", forfeitHandler);

  /**
   * GET /api/match/:matchId/chat
   * Fetch chat message history for a match.
   */
  app.get("/api/match/:matchId/chat", withAuth((req, res) => {
    const matchId = param(req, "matchId");
    res.json({ messages: hub.getChatHistory(matchId) });
  }));

  /**
   * POST /api/match/:matchId/chat
   * Send a chat message to all match participants.
   */
  app.post("/api/match/:matchId/chat", withAuth((req, res, user) => {
    const matchId = param(req, "matchId");
    const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, 300) : "";
    if (!text) {
      res.status(422).json({ error: "Message text is required." });
      return;
    }
    const msg: ChatMessage = {
      id: randomUUID(),
      matchId,
      userId: user.id,
      displayName: resolveDisplayName(user),
      text,
      at: Date.now(),
    };
    hub.broadcastChatMessage(matchId, msg);
    res.status(201).json({ message: msg });
  }));

  // Catch-all 404.
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found." });
  });

  const server = http.createServer(app);
  const hub = new WsHub(server);
  let backgroundInterval: NodeJS.Timeout | undefined;

  server.on("close", () => {
    if (backgroundInterval) {
      clearInterval(backgroundInterval);
      backgroundInterval = undefined;
    }
  });

  return {
    server,
    hub,
    listen: () => {
      server.listen(opts.port, () => {
        console.info(`[pazaak-api] Listening on http://localhost:${opts.port}`);
      });

      if (!backgroundInterval) {
        const tickMs = Math.max(250, opts.matchmakingTickMs ?? 5_000);
        backgroundInterval = setInterval(() => {
          void runBackgroundTick();
        }, tickMs);
      }
    },
  };
}
