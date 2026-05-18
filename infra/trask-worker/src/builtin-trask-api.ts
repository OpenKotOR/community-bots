/**
 * Deprecated bundled Q&A surface. Holocron/Trask require live GPTR web research on approved hosts.
 * This handler only answers health checks; all /api/trask research routes return 503.
 */

export function externalOrigin(request: Request, url: URL): string {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "";
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? "";
  const host = forwardedHost || request.headers.get("host") || url.host;
  const proto =
    forwardedProto ||
    (host.includes("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

function normalizeCorsOrigin(origin: string | null): string {
  return origin?.trim() ? origin.trim() : "*";
}

function jsonResponse(
  status: number,
  body: unknown,
  origin: string | null,
): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": normalizeCorsOrigin(origin),
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Trask-Api-Key",
    Vary: "Origin",
  });
  return new Response(JSON.stringify(body), { status, headers });
}

const LIVE_RESEARCH_REQUIRED = {
  error:
    "Bundled reference answers are disabled. Configure TRASK_RESEARCHWIZARD_BASE_URL to a live trask-http-server (GPTR) and set TRASK_BUILTIN_API=0 on the worker.",
};

export async function handleBuiltinRequest(request: Request): Promise<Response | null> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": normalizeCorsOrigin(origin),
        "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Trask-Api-Key",
        Vary: "Origin",
      },
    });
  }

  if (url.pathname === "/" && request.method === "GET") {
    return new Response("OpenKotOR Trask worker (live GPTR upstream required).\n", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (url.pathname === "/healthz" && request.method === "GET") {
    return jsonResponse(
      200,
      { ok: true, mode: "live-gptr-required", bundledReferenceApi: false },
      origin,
    );
  }

  if (url.pathname.startsWith("/reference")) {
    return jsonResponse(410, { error: "Bundled /reference pages were removed." }, origin);
  }

  if (!url.pathname.startsWith("/api/trask")) {
    return null;
  }

  if (url.pathname === "/api/trask/session" && request.method === "GET") {
    return jsonResponse(200, { loggedIn: false, oauthAvailable: false }, origin);
  }

  return jsonResponse(503, LIVE_RESEARCH_REQUIRED, origin);
}
