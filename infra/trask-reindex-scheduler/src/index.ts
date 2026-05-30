/**
 * Weekly cron scheduler for the Trask/Holocron cached corpus (REQ-A).
 *
 * The Cloudflare cron trigger fires the {@link scheduled} handler, which POSTs
 * `/reindex` to the persistent indexer origin. The indexer crawls the approved
 * catalog into Chroma in the background; this Worker only triggers and reports.
 * Chroma itself stays on the indexer host — a Worker/Durable Object cannot host a
 * vector index, so "in Cloudflare" means scheduling here, storage on the host.
 */

const trimTrailingSlashes = (value: string): string => value.replace(/\/+$/, "");

export interface Env {
  TRASK_INDEXER_REINDEX_URL: string;
  TRASK_REINDEX_TOKEN?: string;
  TRASK_REINDEX_LIMIT?: string;
}

export interface ReindexTriggerResult {
  ok: boolean;
  status: number;
  detail: string;
}

const parseLimit = (raw: string | undefined): number | null => {
  if (!raw) return null;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Pure, testable core: POST /reindex to the indexer with the shared bearer token. */
export const triggerReindex = async (
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<ReindexTriggerResult> => {
  const base = trimTrailingSlashes((env.TRASK_INDEXER_REINDEX_URL ?? "").trim());
  if (!base) {
    return { ok: false, status: 0, detail: "TRASK_INDEXER_REINDEX_URL is not configured" };
  }
  const token = (env.TRASK_REINDEX_TOKEN ?? "").trim();
  if (!token) {
    return { ok: false, status: 0, detail: "TRASK_REINDEX_TOKEN is not configured" };
  }
  const limit = parseLimit(env.TRASK_REINDEX_LIMIT);
  const endpoint = base.endsWith("/reindex") ? base : `${base}/reindex`;
  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(limit !== null ? { limit } : {}),
    });
    const detail = await res.text();
    return { ok: res.ok, status: res.status, detail };
  } catch (err) {
    return { ok: false, status: 0, detail: err instanceof Error ? err.message : String(err) };
  }
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      triggerReindex(env).then((result) => {
        console.log(
          `trask-reindex-scheduler weekly trigger ok=${result.ok} status=${result.status} detail=${result.detail.slice(0, 200)}`,
        );
      }),
    );
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return json(200, {
        ok: true,
        service: "trask-reindex-scheduler",
        indexer: env.TRASK_INDEXER_REINDEX_URL ? trimTrailingSlashes(env.TRASK_INDEXER_REINDEX_URL) : "",
        tokenConfigured: Boolean((env.TRASK_REINDEX_TOKEN ?? "").trim()),
      });
    }
    // Manual trigger for operators (same auth as the indexer enforces downstream).
    if (request.method === "POST" && url.pathname === "/trigger") {
      const result = await triggerReindex(env);
      return json(result.ok ? 202 : 502, result);
    }
    return json(404, { error: "not_found", path: url.pathname });
  },
};
