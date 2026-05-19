import { handleBuiltinRequest } from "./builtin-trask-api.js";

interface Env {
  TRASK_WEB_API_KEY?: string;
  TRASK_WEB_ALLOW_ANONYMOUS?: string;
  TRASK_RESEARCHWIZARD_BASE_URL?: string;
  TRASK_RESEARCHWIZARD_API_KEY?: string;
  TRASK_BUILTIN_API?: string;
  TRASK_BUILTIN_FALLBACK?: string;
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
  return rawBaseUrl.replace(/\/+$/, "");
}

function isTraskApiPath(pathname: string): boolean {
  return pathname === "/api/trask" || pathname.startsWith("/api/trask/");
}

function isBuiltinSurface(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/healthz" ||
    pathname === "/reference" ||
    pathname.startsWith("/reference/") ||
    isTraskApiPath(pathname)
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

function hasRealUpstream(env: Env): boolean {
  const baseUrl = upstreamBaseUrl(env);
  return Boolean(baseUrl) && !baseUrl.includes("example.com");
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
    return await proxyToUpstream(request, targetUrl, origin, upstreamApiKey, bodyText);
  } catch {
    return jsonResponse(
      502,
      {
        error: "Upstream Trask HTTP origin is unreachable.",
        detail: "Bundled reference fallback is disabled; fix Trask HTTP upstream or TRASK_RESEARCHWIZARD_BASE_URL.",
      },
      origin,
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const url = new URL(request.url);
    const bodyText =
      request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();

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

    if (url.pathname === "/healthz" && request.method === "GET") {
      if (useBuiltinApi(env)) {
        const builtin = await handleBuiltinRequest(request);
        if (builtin) {
          return builtin;
        }
      }
      return jsonResponse(
        200,
        {
          ok: true,
          mode: hasRealUpstream(env) ? "proxy" : "builtin-public-api",
          upstream: hasRealUpstream(env) ? normalizeBackendBaseUrl(upstreamBaseUrl(env)) : undefined,
          builtinFallback: useBuiltinFallback(env),
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
  },
};
