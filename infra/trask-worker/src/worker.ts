import { Agent, callable, routeAgentRequest } from "agents";

import {
  capabilitiesBody,
  commandToRequest,
  readJsonObject,
  stringValue,
} from "./agent-surface.js";
import { handleBuiltinRequest } from "./builtin-trask-api.js";

const DEFAULT_TRASK_RETRIEVE_BASE_URL = "https://trask-retrieve.bocloud.workers.dev";
const DEFAULT_TRASK_RESEARCHWIZARD_BASE_URL = "https://openkotor-holocron-trask-http.hf.space";
const UPSTREAM_FETCH_TIMEOUT_MS = 12_000;
const UPSTREAM_HEALTH_TIMEOUT_MS = 6_000;

interface Env {
  TraskAgent?: unknown;
  TRASK_WEB_API_KEY?: string;
  TRASK_WEB_ALLOW_ANONYMOUS?: string;
  TRASK_RESEARCHWIZARD_BASE_URL?: string;
  TRASK_RESEARCHWIZARD_API_KEY?: string;
  TRASK_RETRIEVE_BASE_URL?: string;
  TRASK_REINDEX_TOKEN?: string;
  TRASK_BUILTIN_API?: string;
  TRASK_BUILTIN_FALLBACK?: string;
  TRASK_DISCORD_APP_ID?: string;
  TRASK_DISCORD_INVITE_PERMISSIONS?: string;
  TRASK_INVITE_ALLOWED_GUILD_IDS?: string;
  TRASK_INVITE_ADMIN_TOKEN?: string;
}

interface TraskAgentState {
  totalCommands: number;
  lastCommand?: string;
  lastQuery?: string;
  lastStatus?: number;
  lastUpdatedAt?: string;
  inviteAllowedGuildIds?: string[];
  inviteDiscordAppId?: string;
  invitePermissions?: string;
  inviteAdminToken?: string;
}

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers();
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Trask-Api-Key");
  headers.set("Vary", "Origin");
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
  } else {
    headers.set("Access-Control-Allow-Origin", "*");
  }
  return headers;
}

function jsonResponse(status: number, body: unknown, origin: string | null): Response {
  const headers = corsHeaders(origin);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers });
}

function htmlResponse(status: number, title: string, body: string, origin: string | null): Response {
  const headers = corsHeaders(origin);
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${title}</title><main style="font:16px system-ui,sans-serif;max-width:680px;margin:48px auto;line-height:1.45"><h1>${title}</h1><p>${body}</p></main>`,
    { status, headers },
  );
}

function hasValidClientAuth(request: Request, apiKey: string): boolean {
  const auth = request.headers.get("authorization") ?? request.headers.get("x-trask-api-key");
  if (!auth) {
    return false;
  }
  return auth === apiKey || auth === `Bearer ${apiKey}`;
}

function normalizeBackendBaseUrl(rawBaseUrl: string): string {
  let end = rawBaseUrl.length;
  while (end > 0 && rawBaseUrl[end - 1] === "/") end -= 1;
  return rawBaseUrl.slice(0, end);
}

function readCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isTraskApiPath(pathname: string): boolean {
  return pathname === "/api/trask" || pathname.startsWith("/api/trask/");
}

function isTraskAgentPath(pathname: string): boolean {
  return pathname === "/api/agent" || pathname.startsWith("/api/agent/") || pathname.startsWith("/agents/");
}

function isBuiltinSurface(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/healthz" ||
    pathname === "/reference" ||
    pathname.startsWith("/reference/") ||
    isTraskApiPath(pathname) ||
    isTraskAgentPath(pathname)
  );
}

function envFlag(value: string | undefined, defaultWhenUnset: boolean): boolean {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) {
    return defaultWhenUnset;
  }
  return raw === "1" || raw === "true" || raw === "yes";
}

function upstreamBaseUrl(env: Env): string {
  return (env.TRASK_RESEARCHWIZARD_BASE_URL ?? DEFAULT_TRASK_RESEARCHWIZARD_BASE_URL).trim();
}

function isPlaceholderUpstream(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "example.com" || host.endsWith(".example.com");
  } catch {
    return true;
  }
}

function hasRealUpstream(env: Env): boolean {
  const baseUrl = upstreamBaseUrl(env);
  return Boolean(baseUrl) && !isPlaceholderUpstream(baseUrl);
}

/** Serve bundled references only (no live Trask HTTP upstream). */
function useBuiltinApi(env: Env): boolean {
  const builtinRaw = (env.TRASK_BUILTIN_API ?? "").trim().toLowerCase();
  if (builtinRaw === "0" || builtinRaw === "false") {
    return false;
  }
  if (builtinRaw === "1" || builtinRaw === "true") {
    return true;
  }
  return !hasRealUpstream(env);
}

function useBuiltinFallback(env: Env): boolean {
  return envFlag(env.TRASK_BUILTIN_FALLBACK, true);
}

function shouldFallbackToBuiltin(response: Response): boolean {
  return response.status >= 500 || response.status === 408 || response.status === 429;
}

function buildUpstreamHeaders(request: Request, upstreamApiKey: string): Headers {
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  const accept = request.headers.get("accept");
  const auth = request.headers.get("authorization");
  const apiKeyHeader = request.headers.get("x-trask-api-key");

  if (contentType) {
    headers.set("Content-Type", contentType);
  }
  if (accept) {
    headers.set("Accept", accept);
  }
  if (upstreamApiKey) {
    headers.set("Authorization", `Bearer ${upstreamApiKey}`);
  } else {
    if (auth) {
      headers.set("Authorization", auth);
    }
    if (apiKeyHeader) {
      headers.set("X-Trask-Api-Key", apiKeyHeader);
    }
  }
  return headers;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("Trask upstream timeout"), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function proxyToUpstream(
  request: Request,
  targetUrl: string,
  origin: string | null,
  upstreamApiKey: string,
  bodyText?: string,
): Promise<Response> {
  const upstreamResponse = await fetchWithTimeout(targetUrl, {
    method: request.method,
    headers: buildUpstreamHeaders(request, upstreamApiKey),
    body: request.method === "GET" || request.method === "HEAD" ? undefined : bodyText,
    redirect: "manual",
  }, UPSTREAM_FETCH_TIMEOUT_MS);

  const headers = corsHeaders(origin);
  for (const [name, value] of upstreamResponse.headers) {
    if (name.toLowerCase().startsWith("access-control-")) {
      continue;
    }
    headers.set(name, value);
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers,
  });
}

async function serveBuiltin(request: Request, origin: string | null): Promise<Response> {
  const builtin = await handleBuiltinRequest(request);
  if (builtin) {
    return builtin;
  }
  return jsonResponse(404, { error: "Not found" }, origin);
}

async function probeUpstreamHealth(baseUrl: string, upstreamApiKey: string): Promise<{
  reachable: boolean;
  status?: number;
  detail?: string;
}> {
  const healthUrl = `${normalizeBackendBaseUrl(baseUrl)}/healthz`;
  try {
    const headers = new Headers({ Accept: "application/json" });
    if (upstreamApiKey) {
      headers.set("Authorization", `Bearer ${upstreamApiKey}`);
    }
    const res = await fetchWithTimeout(healthUrl, { method: "GET", headers, redirect: "manual" }, UPSTREAM_HEALTH_TIMEOUT_MS);
    const detail = (await res.text()).slice(0, 300);
    return { reachable: res.ok, status: res.status, detail: detail || undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { reachable: false, detail: message };
  }
}

async function enrichUpstreamFailure(
  upstreamResponse: Response,
  baseUrl: string,
  origin: string | null,
): Promise<Response> {
  const upstreamStatus = upstreamResponse.status;
  const upstreamDetail = (await upstreamResponse.text()).slice(0, 500);
  return jsonResponse(
    upstreamStatus >= 500 ? upstreamStatus : 502,
    {
      error: `Trask HTTP upstream unavailable (${upstreamStatus}).`,
      upstream: normalizeBackendBaseUrl(baseUrl),
      upstreamStatus,
      upstreamDetail: upstreamDetail || undefined,
      hint:
        "Restore the Hugging Face Space OpenKotOR/holocron-trask-http or point TRASK_RESEARCHWIZARD_BASE_URL at a healthy trask-http-server.",
    },
    origin,
  );
}

async function serveUpstreamOrFallback(
  request: Request,
  env: Env,
  origin: string | null,
  url: URL,
  bodyText?: string,
): Promise<Response> {
  const baseUrl = upstreamBaseUrl(env);
  if (!hasRealUpstream(env)) {
    return jsonResponse(500, { error: "TRASK_RESEARCHWIZARD_BASE_URL is not configured." }, origin);
  }

  const targetUrl = `${normalizeBackendBaseUrl(baseUrl)}${url.pathname}${url.search}`;
  const upstreamApiKey = (env.TRASK_RESEARCHWIZARD_API_KEY ?? "").trim();

  try {
    const upstreamResponse = await proxyToUpstream(request, targetUrl, origin, upstreamApiKey, bodyText);
    if (upstreamResponse.ok) {
      return upstreamResponse;
    }
    if (useBuiltinFallback(env) && shouldFallbackToBuiltin(upstreamResponse)) {
      const replayed =
        bodyText !== undefined
          ? new Request(request.url, { method: request.method, headers: request.headers, body: bodyText })
          : request;
      const builtin = await serveBuiltin(replayed, origin);
      if (builtin && builtin.status < 500) {
        return builtin;
      }
    }
    return enrichUpstreamFailure(upstreamResponse, baseUrl, origin);
  } catch {
    if (useBuiltinFallback(env)) {
      const replayed =
        bodyText !== undefined
          ? new Request(request.url, { method: request.method, headers: request.headers, body: bodyText })
          : request;
      const builtin = await serveBuiltin(replayed, origin);
      if (builtin && builtin.status < 500) {
        return builtin;
      }
    }
    return jsonResponse(
      502,
      {
        error: "Upstream Trask HTTP origin is unreachable.",
        upstream: normalizeBackendBaseUrl(baseUrl),
        hint: "Fix Trask HTTP upstream or TRASK_RESEARCHWIZARD_BASE_URL.",
      },
      origin,
    );
  }
}

async function serveWorkerRoute(
  request: Request,
  env: Env,
  origin: string | null,
  url: URL,
  bodyText?: string,
): Promise<Response> {
  if (url.pathname === "/healthz" && request.method === "GET") {
    if (useBuiltinApi(env)) {
      const builtin = await handleBuiltinRequest(request);
      if (builtin) {
        return builtin;
      }
    }
    const baseUrl = upstreamBaseUrl(env);
    const upstreamApiKey = (env.TRASK_RESEARCHWIZARD_API_KEY ?? "").trim();
    const upstreamProbe = hasRealUpstream(env)
      ? await probeUpstreamHealth(baseUrl, upstreamApiKey)
      : { reachable: false as const };
    const upstreamHealthy = hasRealUpstream(env) ? upstreamProbe.reachable : false;
    const fallbackAvailable = useBuiltinApi(env) || useBuiltinFallback(env);
    const ok = upstreamHealthy || fallbackAvailable;
    return jsonResponse(
      ok ? 200 : 503,
      {
        ok,
        mode: upstreamHealthy ? "proxy" : fallbackAvailable ? "degraded-builtin" : "unavailable",
        upstream: hasRealUpstream(env) ? normalizeBackendBaseUrl(baseUrl) : undefined,
        upstreamReachable: upstreamProbe.reachable,
        upstreamStatus: upstreamProbe.status,
        upstreamDetail: upstreamProbe.detail,
        builtinFallback: useBuiltinFallback(env),
        agentsSdk: true,
        agentRoute: "/agents/trask-agent/default",
      },
      origin,
    );
  }

  if (
    !isTraskApiPath(url.pathname) &&
    !url.pathname.startsWith("/reference/") &&
    url.pathname !== "/reference" &&
    url.pathname !== "/"
  ) {
    return jsonResponse(404, { error: "Not found" }, origin);
  }

  const apiKey = (env.TRASK_WEB_API_KEY ?? "").trim();
  const allowAnon = envFlag(env.TRASK_WEB_ALLOW_ANONYMOUS, true);

  if (apiKey && !hasValidClientAuth(request, apiKey)) {
    return jsonResponse(401, { error: "Invalid or missing API key." }, origin);
  }
  if (!apiKey && !allowAnon) {
    return jsonResponse(401, { error: "Set TRASK_WEB_API_KEY or TRASK_WEB_ALLOW_ANONYMOUS=1." }, origin);
  }

  if (useBuiltinApi(env)) {
    if (bodyText !== undefined) {
      const replayed = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: bodyText,
      });
      return serveBuiltin(replayed, origin);
    }
    return serveBuiltin(request, origin);
  }

  if (bodyText !== undefined) {
    const replayed = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: bodyText,
    });
    return serveUpstreamOrFallback(replayed, env, origin, url, bodyText);
  }
  return serveUpstreamOrFallback(request, env, origin, url);
}

function retrieveBaseUrl(env: Env): string {
  return normalizeBackendBaseUrl((env.TRASK_RETRIEVE_BASE_URL ?? DEFAULT_TRASK_RETRIEVE_BASE_URL).trim());
}

function positiveIntegerArg(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function jsonHeaders(extra?: Record<string, string>): Headers {
  return new Headers({ "Content-Type": "application/json", Accept: "application/json", ...(extra ?? {}) });
}

async function fetchJsonCommand(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  const text = await response.text();
  const headers = new Headers();
  headers.set("Content-Type", response.headers.get("Content-Type") ?? "application/json");
  return new Response(text, { status: response.status, statusText: response.statusText, headers });
}

async function executeRetrieveCommand(command: string, args: Record<string, unknown>, env: Env): Promise<Response> {
  const normalized = command.trim().toLowerCase();
  const baseUrl = retrieveBaseUrl(env);
  if (!baseUrl) {
    return new Response(JSON.stringify({ error: "TRASK_RETRIEVE_BASE_URL is not configured." }), {
      status: 503,
      headers: jsonHeaders(),
    });
  }

  if (normalized === "evidence") {
    const query = stringValue(args.query || args.question || args.prompt);
    if (!query) {
      return new Response(JSON.stringify({ error: "Evidence command requires query." }), {
        status: 422,
        headers: jsonHeaders(),
      });
    }
    return fetchJsonCommand(`${baseUrl}/retrieve`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ query, limit: positiveIntegerArg(args.limit, 8) }),
    });
  }

  if (normalized === "refresh-dry-run") {
    const token = (env.TRASK_REINDEX_TOKEN ?? "").trim();
    if (!token) {
      return new Response(
        JSON.stringify({
          ok: false,
          dryRun: true,
          skippedReason: "TRASK_REINDEX_TOKEN is not set; dry-run request not sent.",
          request: { url: `${baseUrl}/reindex`, body: { dryRun: true, limit: positiveIntegerArg(args.limit, 5) } },
        }),
        { status: 424, headers: jsonHeaders() },
      );
    }
    return fetchJsonCommand(`${baseUrl}/reindex`, {
      method: "POST",
      headers: jsonHeaders({ Authorization: `Bearer ${token}` }),
      body: JSON.stringify({ dryRun: true, limit: positiveIntegerArg(args.limit, 5) }),
    });
  }

  throw Object.assign(new Error(`Unknown retrieve command: ${command}`), { status: 422 });
}

function isRetrieveCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  return normalized === "evidence" || normalized === "refresh-dry-run";
}

function purgeDiscordDryRunResponse(args: Record<string, unknown>): Response {
  const channelId = stringValue(args.channelId || args.channel_id);
  const messageId = stringValue(args.messageId || args.message_id);
  const guildId = stringValue(args.guildId || args.guild_id);
  if (!channelId || !messageId) {
    return new Response(JSON.stringify({ error: "purge-discord-message requires channelId and messageId." }), {
      status: 422,
      headers: jsonHeaders(),
    });
  }
  return new Response(
    JSON.stringify({
      ok: true,
      dryRun: true,
      mutates: true,
      command: "purge-discord-message",
      note: "Cloudflare Worker prepares purge requests only. Execute repository purge tooling with explicit operator approval.",
      request: {
        channelId,
        messageId,
        ...(guildId ? { guildId } : {}),
      },
    }),
    { status: 200, headers: jsonHeaders() },
  );
}

function discordInvitePermissions(env: Env): string {
  return (env.TRASK_DISCORD_INVITE_PERMISSIONS ?? "84992").trim() || "84992";
}

function discordInviteAppId(env: Env): string {
  return (env.TRASK_DISCORD_APP_ID ?? "").trim();
}

function buildDiscordInviteUrl(appId: string, guildId: string, permissions: string): string {
  const url = new URL("https://discord.com/api/oauth2/authorize");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("permissions", permissions);
  url.searchParams.set("scope", "bot applications.commands");
  url.searchParams.set("guild_id", guildId);
  url.searchParams.set("disable_guild_select", "true");
  return url.toString();
}

function isValidDiscordSnowflake(value: string): boolean {
  return /^\d{15,25}$/u.test(value);
}

function withCors(response: Response, origin: string | null): Response {
  const headers = corsHeaders(origin);
  for (const [name, value] of response.headers) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export class TraskAgent extends Agent<Env, TraskAgentState> {
  initialState = { totalCommands: 0 };

  @callable()
  capabilities() {
    return capabilitiesBody();
  }

  @callable()
  status() {
    return {
      ok: true,
      state: this.state,
      capabilities: capabilitiesBody(),
    };
  }

  @callable()
  async query(input: { query?: string; question?: string; modelId?: string; sourcePreference?: string }) {
    return this.command("ask", input);
  }

  @callable()
  async ask(input: Record<string, unknown> = {}) {
    return this.command("ask", input);
  }

  @callable()
  async research(input: Record<string, unknown> = {}) {
    return this.command("research", input);
  }

  @callable()
  async models() {
    return this.command("models");
  }

  @callable()
  async thread(input: Record<string, unknown> = {}) {
    return this.command("thread", input);
  }

  @callable()
  async cancel(input: Record<string, unknown> = {}) {
    return this.command("cancel", input);
  }

  @callable()
  async history(input: Record<string, unknown> = {}) {
    return this.command("history", input);
  }

  @callable()
  async sources() {
    return this.command("sources");
  }

  @callable()
  async session() {
    return this.command("session");
  }

  @callable()
  async health() {
    return this.command("health");
  }

  @callable()
  async evidence(input: Record<string, unknown> = {}) {
    return this.command("evidence", input);
  }

  @callable()
  async refreshDryRun(input: Record<string, unknown> = {}) {
    return this.command("refresh-dry-run", input);
  }

  @callable()
  async purgeDiscordMessage(input: Record<string, unknown> = {}) {
    return this.command("purge-discord-message", input);
  }

  @callable()
  invitePolicy() {
    return this.invitePolicyBody();
  }

  @callable()
  async allowInviteGuild(input: Record<string, unknown> = {}) {
    return this.updateInviteGuild(input, true, true);
  }

  @callable()
  async revokeInviteGuild(input: Record<string, unknown> = {}) {
    return this.updateInviteGuild(input, false, true);
  }

  @callable()
  async configureInvite(input: Record<string, unknown> = {}) {
    return this.configureInvitePolicy(input, this.invitePolicyConfigured());
  }

  private inviteAllowedGuildIds(): string[] {
    return [
      ...new Set([
        ...readCsv(this.env.TRASK_INVITE_ALLOWED_GUILD_IDS),
        ...(this.state.inviteAllowedGuildIds ?? []),
      ]),
    ].filter(isValidDiscordSnowflake);
  }

  private inviteAppId(): string {
    return (this.state.inviteDiscordAppId ?? "").trim() || discordInviteAppId(this.env);
  }

  private invitePermissions(): string {
    return (this.state.invitePermissions ?? "").trim() || discordInvitePermissions(this.env);
  }

  private inviteAdminToken(): string {
    return (this.state.inviteAdminToken ?? "").trim()
      || (this.env.TRASK_INVITE_ADMIN_TOKEN ?? "").trim()
      || (this.env.TRASK_WEB_API_KEY ?? "").trim();
  }

  private inviteAdminAuthorized(request: Request): boolean {
    const token = this.inviteAdminToken();
    return Boolean(token) && hasValidClientAuth(request, token);
  }

  private inviteInputAuthorized(input: Record<string, unknown>): boolean {
    const token = this.inviteAdminToken();
    const provided = stringValue(input.adminToken || input.token || input.apiKey);
    return Boolean(token) && provided === token;
  }

  private invitePolicyConfigured(): boolean {
    return Boolean(this.inviteAppId() || this.inviteAllowedGuildIds().length > 0 || this.inviteAdminToken());
  }

  private invitePolicyBody() {
    return {
      ok: true,
      appConfigured: Boolean(this.inviteAppId()),
      appIdSource: this.state.inviteDiscordAppId ? "persistent" : discordInviteAppId(this.env) ? "env" : "unset",
      permissions: this.invitePermissions(),
      permissionsSource: this.state.invitePermissions ? "persistent" : "env-or-default",
      adminConfigured: Boolean(this.inviteAdminToken()),
      adminTokenSource: this.state.inviteAdminToken
        ? "persistent"
        : (this.env.TRASK_INVITE_ADMIN_TOKEN ?? this.env.TRASK_WEB_API_KEY) ? "env" : "unset",
      allowedGuildIds: this.inviteAllowedGuildIds(),
      envAllowedGuildCount: readCsv(this.env.TRASK_INVITE_ALLOWED_GUILD_IDS).length,
      persistentAllowedGuildCount: this.state.inviteAllowedGuildIds?.length ?? 0,
      inviteUrl: "/api/trask/invite?guild_id=<discord-guild-id>",
      note: "Trask invite links require an allowlisted guild id. App id, permissions, and guild entries can all be updated through this Worker without restarting Trask.",
    };
  }

  private async configureInvitePolicy(input: Record<string, unknown>, requireAuth = false) {
    if (requireAuth && !this.inviteInputAuthorized(input)) {
      return { ok: false, status: 401, body: { error: "Invite policy configuration requires the persistent admin token." } };
    }
    const appId = stringValue(input.appId || input.clientId || input.discordAppId);
    const permissions = stringValue(input.permissions || input.permissionInteger);
    const adminToken = stringValue(input.adminToken || input.token || input.apiKey);
    const patch: Pick<TraskAgentState, "inviteDiscordAppId" | "invitePermissions" | "inviteAdminToken"> = {};
    if (appId) {
      if (!isValidDiscordSnowflake(appId)) {
        return { ok: false, status: 422, body: { error: "appId must be a Discord snowflake." } };
      }
      patch.inviteDiscordAppId = appId;
    }
    if (permissions) {
      if (!/^\d+$/u.test(permissions)) {
        return { ok: false, status: 422, body: { error: "permissions must be a Discord permission integer." } };
      }
      patch.invitePermissions = permissions;
    }
    if (adminToken) {
      if (adminToken.length < 12) {
        return { ok: false, status: 422, body: { error: "adminToken must be at least 12 characters." } };
      }
      patch.inviteAdminToken = adminToken;
    }
    if (!patch.inviteDiscordAppId && !patch.invitePermissions && !patch.inviteAdminToken) {
      return { ok: false, status: 422, body: { error: "Provide appId, permissions, and/or adminToken." } };
    }
    this.setState({
      ...this.state,
      ...patch,
      totalCommands: this.state.totalCommands + 1,
      lastCommand: "configure-invite",
      lastStatus: 200,
      lastUpdatedAt: new Date().toISOString(),
    });
    return { ok: true, status: 200, body: this.invitePolicyBody() };
  }

  private async updateInviteGuild(input: Record<string, unknown>, allowed: boolean, requireAuth = false) {
    if (requireAuth && !this.inviteInputAuthorized(input)) {
      return { ok: false, status: 401, body: { error: "Invite guild updates require the persistent admin token." } };
    }
    const guildId = stringValue(input.guildId || input.guild_id || input.id);
    if (!isValidDiscordSnowflake(guildId)) {
      return { ok: false, status: 422, body: { error: "A valid Discord guildId is required." } };
    }
    const current = new Set(this.state.inviteAllowedGuildIds ?? []);
    if (allowed) {
      current.add(guildId);
    } else {
      current.delete(guildId);
    }
    const inviteAllowedGuildIds = [...current].sort();
    this.setState({
      ...this.state,
      inviteAllowedGuildIds,
      totalCommands: this.state.totalCommands + 1,
      lastCommand: allowed ? "allow-invite-guild" : "revoke-invite-guild",
      lastStatus: 200,
      lastUpdatedAt: new Date().toISOString(),
    });
    return { ok: true, status: 200, body: this.invitePolicyBody() };
  }

  private async handleInviteRequest(request: Request, origin: string | null): Promise<Response> {
    const url = new URL(request.url);
    const guildId = (url.searchParams.get("guild_id") ?? url.searchParams.get("guildId") ?? "").trim();
    const appId = this.inviteAppId();
    if (!appId) {
      return htmlResponse(
        503,
        "Trask Invite Not Configured",
        "The public invite broker is live, but TRASK_DISCORD_APP_ID is not configured on the Worker.",
        origin,
      );
    }
    if (!isValidDiscordSnowflake(guildId)) {
      return htmlResponse(
        400,
        "Guild Approval Required",
        "Trask does not publish open-ended Discord install links. Ask an OpenKotOR operator to approve your Discord guild id, then use /api/trask/invite?guild_id=<id>.",
        origin,
      );
    }
    if (!this.inviteAllowedGuildIds().includes(guildId)) {
      return htmlResponse(
        403,
        "Guild Not Approved",
        "This Discord guild is not approved for Trask installation. The bot will not be invited until an operator adds the guild to the persistent allowlist.",
        origin,
      );
    }
    return Response.redirect(buildDiscordInviteUrl(appId, guildId, this.invitePermissions()), 302);
  }

  @callable()
  async command(command: string, args: Record<string, unknown> = {}) {
    const commandArgs = readJsonObject(args);
    if (command.trim().toLowerCase() === "capabilities") {
      this.setState({
        ...this.state,
        totalCommands: this.state.totalCommands + 1,
        lastCommand: command,
        lastStatus: 200,
        lastUpdatedAt: new Date().toISOString(),
      });
      return { ok: true, status: 200, body: capabilitiesBody() };
    }
    if (isRetrieveCommand(command)) {
      const response = await executeRetrieveCommand(command, commandArgs, this.env);
      this.setState({
        ...this.state,
        totalCommands: this.state.totalCommands + 1,
        lastCommand: command,
        lastQuery: typeof commandArgs.query === "string" ? commandArgs.query : this.state.lastQuery,
        lastStatus: response.status,
        lastUpdatedAt: new Date().toISOString(),
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        return { ok: response.ok, status: response.status, body: await response.json() };
      }
      return { ok: response.ok, status: response.status, body: { text: await response.text() } };
    }
    if (command.trim().toLowerCase() === "purge-discord-message") {
      const response = purgeDiscordDryRunResponse(commandArgs);
      this.setState({
        ...this.state,
        totalCommands: this.state.totalCommands + 1,
        lastCommand: command,
        lastStatus: response.status,
        lastUpdatedAt: new Date().toISOString(),
      });
      return { ok: response.ok, status: response.status, body: await response.json() };
    }
    if (command.trim().toLowerCase() === "invite-policy") {
      return { ok: true, status: 200, body: this.invitePolicyBody() };
    }
    if (command.trim().toLowerCase() === "allow-invite-guild") {
      return this.updateInviteGuild(commandArgs, true, true);
    }
    if (command.trim().toLowerCase() === "revoke-invite-guild") {
      return this.updateInviteGuild(commandArgs, false, true);
    }
    if (command.trim().toLowerCase() === "configure-invite") {
      return this.configureInvitePolicy(commandArgs, this.invitePolicyConfigured());
    }

    const request = commandToRequest(command, commandArgs, "https://trask-agent.local/");
    const url = new URL(request.url);
    const bodyText = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
    const replayed =
      bodyText === undefined
        ? request
        : new Request(request.url, { method: request.method, headers: request.headers, body: bodyText });
    const response = await serveWorkerRoute(replayed, this.env, null, url, bodyText);
    this.setState({
      ...this.state,
      totalCommands: this.state.totalCommands + 1,
      lastCommand: command,
      lastQuery: typeof commandArgs.query === "string" ? commandArgs.query : this.state.lastQuery,
      lastStatus: response.status,
      lastUpdatedAt: new Date().toISOString(),
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return { ok: response.ok, status: response.status, body: await response.json() };
    }
    return { ok: response.ok, status: response.status, body: { text: await response.text() } };
  }

  async onRequest(request: Request): Promise<Response> {
    const origin = request.headers.get("Origin");
    const url = new URL(request.url);
    const subpath = url.pathname.replace(/^\/agents\/trask-agent\/[^/]+/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method === "GET" && (subpath === "/" || subpath === "/capabilities")) {
      return jsonResponse(200, capabilitiesBody(), origin);
    }
    if (request.method === "GET" && subpath === "/status") {
      return jsonResponse(200, { ok: true, state: this.state, capabilities: capabilitiesBody() }, origin);
    }
    if (request.method === "GET" && subpath === "/state") {
      return jsonResponse(200, { state: this.state }, origin);
    }
    if (request.method === "GET" && subpath === "/invite") {
      return this.handleInviteRequest(request, origin);
    }
    if (request.method === "GET" && subpath === "/install-policy") {
      return jsonResponse(200, this.invitePolicyBody(), origin);
    }
    if (
      request.method === "POST"
      && (subpath === "/install-policy/allow"
        || subpath === "/install-policy/revoke"
        || subpath === "/install-policy/configure")
    ) {
      const isBootstrapConfigure = subpath.endsWith("/configure") && !this.invitePolicyConfigured();
      if (!isBootstrapConfigure && !this.inviteAdminAuthorized(request)) {
        return jsonResponse(
          401,
          {
            error:
              "Invite policy update denied. Use the persistent admin token configured on /api/trask/install-policy/configure, or an optional bootstrap env token.",
          },
          origin,
        );
      }
      const body = readJsonObject(await request.json().catch(() => ({})));
      const result = subpath.endsWith("/configure")
        ? await this.configureInvitePolicy(body)
        : await this.updateInviteGuild(body, subpath.endsWith("/allow"));
      return jsonResponse(result.status, result.body, origin);
    }
    if (request.method === "POST" && subpath === "/query") {
      const body = readJsonObject(await request.json().catch(() => ({})));
      const result = await this.command("ask", body);
      return jsonResponse(typeof result.status === "number" ? result.status : 200, result, origin);
    }
    if (request.method === "POST" && subpath === "/command") {
      const body = readJsonObject(await request.json().catch(() => ({})));
      const command = stringValue(body.command);
      const args = readJsonObject(body.args);
      if (!command) {
        return jsonResponse(422, { error: "Body must include command." }, origin);
      }
      try {
        const result = await this.command(command, args);
        return jsonResponse(typeof result.status === "number" ? result.status : 200, result, origin);
      } catch (err) {
        const status = typeof err === "object" && err !== null && Reflect.get(err, "status") === 422 ? 422 : 500;
        const message = err instanceof Error ? err.message : String(err);
        return jsonResponse(status, { error: message }, origin);
      }
    }
    return jsonResponse(404, { error: "Agent route not found." }, origin);
  }
}

function rewriteToDefaultTraskAgent(request: Request, suffix: string): Request {
  const url = new URL(request.url);
  url.pathname = `/agents/trask-agent/default${suffix}`;
  return new Request(url, request);
}

function rewriteTraskInstallRouteToAgent(request: Request, suffix: string): Request {
  const url = new URL(request.url);
  url.pathname = `/agents/trask-agent/default${suffix}`;
  return new Request(url, request);
}

async function routeConvenienceAgentRequest(request: Request, env: Env): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname === "/api/agent" || url.pathname === "/api/agent/capabilities") {
    return routeAgentRequest(rewriteToDefaultTraskAgent(request, "/capabilities"), env);
  }
  if (url.pathname === "/api/agent/status") {
    return routeAgentRequest(rewriteToDefaultTraskAgent(request, "/status"), env);
  }
  if (url.pathname === "/api/agent/state") {
    return routeAgentRequest(rewriteToDefaultTraskAgent(request, "/state"), env);
  }
  if (url.pathname === "/api/agent/query") {
    return routeAgentRequest(rewriteToDefaultTraskAgent(request, "/query"), env);
  }
  if (url.pathname === "/api/agent/command") {
    return routeAgentRequest(rewriteToDefaultTraskAgent(request, "/command"), env);
  }
  return undefined;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      if (isBuiltinSurface(url.pathname)) {
        if (useBuiltinApi(env)) {
          const builtin = await handleBuiltinRequest(request);
          if (builtin) {
            return builtin;
          }
        }
        if (hasRealUpstream(env)) {
          return new Response(null, { status: 204, headers: corsHeaders(origin) });
        }
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const apiKey = (env.TRASK_WEB_API_KEY ?? "").trim();
    const allowAnon = envFlag(env.TRASK_WEB_ALLOW_ANONYMOUS, true);

    if (url.pathname === "/api/trask/invite") {
      const agentResponse = await routeAgentRequest(rewriteTraskInstallRouteToAgent(request, "/invite"), env);
      return agentResponse ? withCors(agentResponse, origin) : jsonResponse(404, { error: "Invite route not found." }, origin);
    }

    if (
      url.pathname === "/api/trask/install-policy"
      || url.pathname === "/api/trask/install-policy/allow"
      || url.pathname === "/api/trask/install-policy/revoke"
      || url.pathname === "/api/trask/install-policy/configure"
    ) {
      const suffix = url.pathname.replace(/^\/api\/trask/u, "");
      const agentResponse = await routeAgentRequest(rewriteTraskInstallRouteToAgent(request, suffix), env);
      return agentResponse ? withCors(agentResponse, origin) : jsonResponse(404, { error: "Install policy route not found." }, origin);
    }

    if (isTraskAgentPath(url.pathname)) {
      if (apiKey && !hasValidClientAuth(request, apiKey)) {
        return jsonResponse(401, { error: "Invalid or missing API key." }, origin);
      }
      if (!apiKey && !allowAnon) {
        return jsonResponse(401, { error: "Set TRASK_WEB_API_KEY or TRASK_WEB_ALLOW_ANONYMOUS=1." }, origin);
      }
      const agentResponse = url.pathname === "/api/agent" || url.pathname.startsWith("/api/agent/")
        ? await routeConvenienceAgentRequest(request, env)
        : await routeAgentRequest(request, env);
      if (agentResponse) {
        return withCors(agentResponse, origin);
      }
      return jsonResponse(404, { error: "Agent route not found." }, origin);
    }

    const bodyText =
      request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
    return serveWorkerRoute(request, env, origin, url, bodyText);
  },
};
