import { Agent, callable, routeAgentRequest } from "agents";

import {
  capabilitiesBody,
  commandToRequest,
  readJsonObject,
  stringValue,
} from "./agent-surface.js";
import { handleBuiltinRequest } from "./builtin-trask-api.js";

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
}

interface TraskAgentState {
  totalCommands: number;
  lastCommand?: string;
  lastQuery?: string;
  lastStatus?: number;
  lastUpdatedAt?: string;
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
  return (env.TRASK_RESEARCHWIZARD_BASE_URL ?? "").trim();
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
  return envFlag(env.TRASK_BUILTIN_FALLBACK, false);
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

async function proxyToUpstream(
  request: Request,
  targetUrl: string,
  origin: string | null,
  upstreamApiKey: string,
  bodyText?: string,
): Promise<Response> {
  const upstreamResponse = await fetch(targetUrl, {
    method: request.method,
    headers: buildUpstreamHeaders(request, upstreamApiKey),
    body: request.method === "GET" || request.method === "HEAD" ? undefined : bodyText,
    redirect: "manual",
  });

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
    const res = await fetch(healthUrl, { method: "GET", headers, redirect: "manual" });
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
    return jsonResponse(
      upstreamHealthy ? 200 : 503,
      {
        ok: upstreamHealthy,
        mode: hasRealUpstream(env) ? "proxy" : "builtin-public-api",
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
  return normalizeBackendBaseUrl((env.TRASK_RETRIEVE_BASE_URL ?? "").trim());
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
