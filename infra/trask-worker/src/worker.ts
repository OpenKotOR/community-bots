interface Env {
  TRASK_WEB_API_KEY?: string;
  TRASK_WEB_ALLOW_ANONYMOUS?: string;
  TRASK_RESEARCHWIZARD_BASE_URL?: string;
  TRASK_RESEARCHWIZARD_API_KEY?: string;
}

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers();
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
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

function normalizeBackendUrl(rawBaseUrl: string): string {
  return rawBaseUrl.replace(/\/+$/, "") + "/api/trask/ask";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === "/healthz" && request.method === "GET") {
      return jsonResponse(200, { ok: true }, origin);
    }

    if (url.pathname !== "/api/trask/ask" || request.method !== "POST") {
      return jsonResponse(404, { error: "Not found" }, origin);
    }

    const apiKey = (env.TRASK_WEB_API_KEY ?? "").trim();
    const allowAnonRaw = (env.TRASK_WEB_ALLOW_ANONYMOUS ?? "").trim().toLowerCase();
    const allowAnon = allowAnonRaw === "1" || allowAnonRaw === "true";

    if (apiKey && !hasValidClientAuth(request, apiKey)) {
      return jsonResponse(401, { error: "Invalid or missing API key." }, origin);
    }
    if (!apiKey && !allowAnon) {
      return jsonResponse(401, { error: "Set TRASK_WEB_API_KEY or TRASK_WEB_ALLOW_ANONYMOUS=1." }, origin);
    }

    const baseUrl = (env.TRASK_RESEARCHWIZARD_BASE_URL ?? "").trim();
    if (!baseUrl) {
      return jsonResponse(500, { error: "TRASK_RESEARCHWIZARD_BASE_URL is not configured." }, origin);
    }

    const targetUrl = normalizeBackendUrl(baseUrl);
    const upstreamHeaders = new Headers();
    upstreamHeaders.set("Content-Type", request.headers.get("content-type") ?? "application/json");
    const upstreamApiKey = (env.TRASK_RESEARCHWIZARD_API_KEY ?? "").trim();
    if (upstreamApiKey) {
      upstreamHeaders.set("Authorization", `Bearer ${upstreamApiKey}`);
    }

    const upstreamResponse = await fetch(targetUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: await request.text(),
    });

    const headers = corsHeaders(origin);
    headers.set("Content-Type", upstreamResponse.headers.get("content-type") ?? "application/json");
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    });
  },
};
