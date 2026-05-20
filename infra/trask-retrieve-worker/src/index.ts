/**
 * Edge retrieve gateway for Trask RAG.
 * Proxies POST /retrieve to the Chroma indexer (local/VPS) until Vectorize replaces it.
 */

export interface Env {
  TRASK_INDEXER_BASE_URL: string;
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
        indexer: env.TRASK_INDEXER_BASE_URL?.replace(/\/+$/, "") ?? "",
      });
    }

    if (request.method !== "POST" || url.pathname !== "/retrieve") {
      return json(404, { error: "not_found", path: url.pathname });
    }

    const base = (env.TRASK_INDEXER_BASE_URL ?? "").trim().replace(/\/+$/, "");
    if (!base) {
      return json(503, { error: "TRASK_INDEXER_BASE_URL is not configured" });
    }

    let body: string;
    try {
      body = await request.text();
    } catch {
      return json(400, { error: "invalid_body" });
    }

    const upstream = await fetch(`${base}/retrieve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
    });

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
