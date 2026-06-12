import { Agent, callable, routeAgentRequest } from "agents";

import { handleBuiltinRequest } from "./builtin-trask-api.js";

interface Env {
  TraskAgent?: unknown;
  TRASK_WEB_API_KEY?: string;
  TRASK_WEB_ALLOW_ANONYMOUS?: string;
  TRASK_RESEARCHWIZARD_BASE_URL?: string;
  TRASK_RESEARCHWIZARD_API_KEY?: string;
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

interface TraskAgentCommand {
  name: string;
  description: string;
  method: "GET" | "POST";
  path: string;
  body?: Record<string, string>;
}

const TRASK_AGENT_COMMANDS: readonly TraskAgentCommand[] = [
  {
    name: "ask",
    description: "Submit a Trask research query through the configured live Trask HTTP upstream.",
    method: "POST",
    path: "/api/trask/ask",
    body: { query: "string", modelId: "optional string", sourcePreference: "optional string" },
  },
  {
    name: "thread",
    description: "Fetch a persisted Trask query/thread by id after an async ask response.",
    method: "GET",
    path: "/api/trask/thread/:id",
  },
  {
    name: "history",
    description: "List persisted Trask query history for the configured web user.",
    method: "GET",
    path: "/api/trask/history",
  },
  {
    name: "sources",
    description: "List approved Trask source records surfaced by the HTTP runtime.",
    method: "GET",
    path: "/api/trask/sources",
  },
  {
    name: "session",
    description: "Inspect the public Holocron/Trask session capability state.",
    method: "GET",
    path: "/api/trask/session",
  },
  {
    name: "health",
    description: "Probe the Worker and configured Trask HTTP upstream.",
    method: "GET",
    path: "/healthz",
  },
  {
    name: "capabilities",
    description: "Return this agent command registry.",
    method: "GET",
    path: "/api/agent/capabilities",
  },
];

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

function capabilitiesBody() {
  return {
    agent: "TraskAgent",
    agentRoute: "/agents/trask-agent/default",
    convenienceRoutes: {
      capabilities: "/api/agent/capabilities",
      status: "/api/agent/status",
      state: "/api/agent/state",
      query: "/api/agent/query",
      command: "/api/agent/command",
    },
    commands: TRASK_AGENT_COMMANDS.map((command) => ({ ...command })),
    notes: [
      "Trask research commands proxy to the configured live Trask HTTP upstream.",
      "State is persisted by the Agents SDK Durable Object instance.",
      "Use TRASK_WEB_API_KEY to protect public agent routes, or TRASK_WEB_ALLOW_ANONYMOUS=1 for public Holocron.",
    ],
  };
}

function readJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function commandToRequest(command: string, args: Record<string, unknown>, baseUrl: string): Request {
  const url = new URL(baseUrl);
  const normalized = command.trim().toLowerCase();

  if (normalized === "ask" || normalized === "query" || normalized === "research") {
    url.pathname = "/api/trask/ask";
    return new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: stringValue(args.query || args.question || args.prompt),
        ...(stringValue(args.modelId) ? { modelId: stringValue(args.modelId) } : {}),
        ...(stringValue(args.sourcePreference) ? { sourcePreference: stringValue(args.sourcePreference) } : {}),
      }),
    });
  }

  if (normalized === "thread") {
    const id = stringValue(args.id || args.threadId || args.queryId);
    url.pathname = `/api/trask/thread/${encodeURIComponent(id)}`;
    return new Request(url, { method: "GET" });
  }

  if (normalized === "history") {
    url.pathname = "/api/trask/history";
    const limit = stringValue(args.limit);
    if (limit) url.searchParams.set("limit", limit);
    return new Request(url, { method: "GET" });
  }

  if (normalized === "sources") {
    url.pathname = "/api/trask/sources";
    return new Request(url, { method: "GET" });
  }

  if (normalized === "session") {
    url.pathname = "/api/trask/session";
    return new Request(url, { method: "GET" });
  }

  if (normalized === "health") {
    url.pathname = "/healthz";
    return new Request(url, { method: "GET" });
  }

  throw Object.assign(new Error(`Unknown Trask agent command: ${command}`), { status: 422 });
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
    const request = commandToRequest(command, readJsonObject(args), "https://trask-agent.local/");
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
      lastQuery: typeof args.query === "string" ? args.query : this.state.lastQuery,
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
      const agentResponse = url.pathname.startsWith("/api/agent/")
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
