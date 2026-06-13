/**
 * Edge retrieve gateway for Trask RAG.
 * Proxies POST /retrieve to the Chroma indexer (local/VPS) until Vectorize replaces it.
 */

const trimTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
};

export interface Env {
  TRASK_INDEXER_BASE_URL: string;
  TRASK_RETRIEVE_UPSTREAM_TIMEOUT_MS?: string;
}

const corsHeaders = (): Headers => {
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return headers;
};

const json = (status: number, body: unknown): Response => {
  const headers = corsHeaders();
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers });
};

const parsePositiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

type UpstreamFetchResult =
  | { ok: true; response: Response }
  | { ok: false; status: 503 | 504; body: { error: string; timeoutMs?: number } };

const fetchUpstreamWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<UpstreamFetchResult> => {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const upstream = fetch(url, { ...init, signal: controller.signal })
    .then((response): UpstreamFetchResult => ({ ok: true, response }))
    .catch(
      (): UpstreamFetchResult => (
        controller.signal.aborted
          ? { ok: false, status: 504, body: { error: "upstream_timeout", timeoutMs } }
          : { ok: false, status: 503, body: { error: "upstream_unavailable" } }
      ),
    );

  const deadline = new Promise<UpstreamFetchResult>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, status: 504, body: { error: "upstream_timeout", timeoutMs } });
    }, timeoutMs);
  });

  const result = await Promise.race([upstream, deadline]);
  if (timeout) clearTimeout(timeout);
  return result;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return json(200, {
        ok: true,
        service: "trask-retrieve",
        indexer: env.TRASK_INDEXER_BASE_URL ? trimTrailingSlashes(env.TRASK_INDEXER_BASE_URL) : "",
      });
    }

    if (request.method !== "POST" || url.pathname !== "/retrieve") {
      return json(404, { error: "not_found", path: url.pathname });
    }

    const base = trimTrailingSlashes((env.TRASK_INDEXER_BASE_URL ?? "").trim());
    if (!base) {
      return json(503, { error: "TRASK_INDEXER_BASE_URL is not configured" });
    }

    const timeoutMs = parsePositiveInteger(env.TRASK_RETRIEVE_UPSTREAM_TIMEOUT_MS, 5_000);

    let body: string;
    try {
      body = await request.text();
    } catch {
      return json(400, { error: "invalid_body" });
    }

    const upstreamResult = await fetchUpstreamWithTimeout(
      `${base}/retrieve`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body,
      },
      timeoutMs,
    );

    if (!upstreamResult.ok) {
      return json(upstreamResult.status, upstreamResult.body);
    }

    const upstream = upstreamResult.response;

    const text = await upstream.text();
    const headers = corsHeaders();
    const contentType = upstream.headers.get("Content-Type");
    if (contentType) {
      headers.set("Content-Type", contentType);
    } else {
      headers.set("Content-Type", "application/json");
    }

    return new Response(text, { status: upstream.status, headers });
  },
};
