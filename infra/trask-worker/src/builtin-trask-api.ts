interface ReferenceEntry {
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  aliases: string[];
}

interface SourceDescriptor {
  id: string;
  name: string;
  url: string;
}

interface QueryRecord {
  queryId: string;
  threadId: string;
  userId: string;
  query: string;
  status: string;
  answer: string;
  sources: SourceDescriptor[];
  retrievedSources: SourceDescriptor[];
  visitedUrls: string[];
  error: string | null;
  createdAt: string;
  completedAt: string;
  liveTrace: Array<{ at: string; phase: string; detail: string }>;
}

const STOPWORDS = new Set([
  "what",
  "where",
  "when",
  "which",
  "who",
  "how",
  "used",
  "use",
  "usedfor",
  "does",
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "about",
  "that",
  "this",
  "game",
  "games",
  "star",
  "wars",
  "knights",
  "old",
  "republic",
  "kotor",
  "pc",
]);

const REFERENCES: ReferenceEntry[] = [
  {
    slug: "tslpatcher",
    title: "TSLPatcher - KOTOR mod installer",
    summary:
      "TSLPatcher is the standard KotOR and TSL mod installer. Mod authors use it to patch 2DA, GFF, TLK, NSS, and related game data in place so a mod can merge changes into an existing installation instead of overwriting whole files.",
    tags: ["tooling", "modding", "tslpatcher", "installer", "2da", "gff", "tlk", "nss"],
    aliases: ["tslpatcher"],
  },
  {
    slug: "mdlops",
    title: "MDLOps - KOTOR model conversion tool",
    summary:
      "MDLOps is a KotOR model conversion utility used to inspect, decompile, and rebuild MDL and MDX models. Modders use it in the asset pipeline when converting Odyssey engine models between editable formats and game-ready binaries.",
    tags: ["tooling", "mdlops", "models", "conversion", "mdx", "mdl", "odyssey"],
    aliases: ["mdlops"],
  },
  {
    slug: "widescreen",
    title: "KOTOR widescreen troubleshooting on PC",
    summary:
      "KOTOR widescreen troubleshooting usually involves matching the game resolution, HUD and menu fixes, and graphics settings. Common checks are the target resolution in the game configuration, widescreen UI patches, and verifying that movies and the HUD are using assets that match the chosen aspect ratio.",
    tags: ["technical", "widescreen", "resolution", "hud", "graphics", "pc", "troubleshooting"],
    aliases: ["widescreen", "resolution", "hud", "aspect ratio"],
  },
  {
    slug: "save-files-windows",
    title: "KOTOR save files on Windows",
    summary:
      "On Windows, Knights of the Old Republic save files are typically stored under the game installation directory in the saves folder, or under the user game data area depending on the distribution. Troubleshooting usually starts by checking the install path used by Steam, GOG, or the retail release and then opening the saves directory inside that install.",
    tags: ["technical", "save", "windows", "paths", "troubleshooting", "pc"],
    aliases: ["save files", "save folder", "windows saves"],
  },
  {
    slug: "reone",
    title: "reone - Odyssey engine reimplementation",
    summary:
      "reone is an open-source reimplementation of the Odyssey engine used by KotOR. It provides engine-level code and runtime work for loading game assets, reproducing Odyssey behavior, and experimenting with modern tooling around the original game formats.",
    tags: ["tooling", "engine", "reone", "odyssey", "runtime", "open-source"],
    aliases: ["reone"],
  },
];

const SOURCE_DESCRIPTOR = {
  id: "trask-technical-reference",
  name: "Trask Technical Reference",
  kind: "website",
  description: "Built-in technical reference notes used by the public Holocron fallback API.",
  freshnessPolicy: "Bundled with the deployed fallback service.",
};

const queryStore = new Map<string, QueryRecord>();
const threadStore = new Map<string, string[]>();
const userHistoryStore = new Map<string, string[]>();

function normalizeCorsOrigin(origin: string | null): string {
  return origin?.trim() ? origin.trim() : "*";
}

export function externalOrigin(request: Request, url: URL): string {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "";
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? "";
  const host = forwardedHost || request.headers.get("host") || url.host;
  const proto =
    forwardedProto ||
    (host.includes("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

function jsonResponse(
  status: number,
  body: unknown,
  origin: string | null,
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Access-Control-Allow-Origin", normalizeCorsOrigin(origin));
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Trask-Api-Key");
  headers.set("Vary", "Origin");
  return new Response(JSON.stringify(body), { status, headers });
}

function textResponse(
  status: number,
  body: string,
  origin: string | null,
  contentType = "text/plain; charset=utf-8",
): Response {
  const headers = new Headers({
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": normalizeCorsOrigin(origin),
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Trask-Api-Key",
    Vary: "Origin",
  });
  return new Response(body, { status, headers });
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !STOPWORDS.has(token));
}

function scoreReference(query: string, reference: ReferenceEntry): number {
  const lowered = query.toLowerCase();
  for (const alias of reference.aliases) {
    if (lowered.includes(alias)) {
      return 10_000;
    }
  }

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return 0;
  }

  const titleTokens = tokenize(reference.title);
  const summaryTokens = tokenize(reference.summary);
  const tagTokens = reference.tags.flatMap((tag) => tokenize(tag));

  let score = 0;
  for (const token of queryTokens) {
    score += titleTokens.filter((entry) => entry === token).length * 5;
    score += tagTokens.filter((entry) => entry === token).length * 3;
    score += summaryTokens.filter((entry) => entry === token).length;
  }
  return score;
}

function chooseReference(query: string): { reference: ReferenceEntry; score: number } | null {
  const ranked = REFERENCES.map((reference) => ({
    reference,
    score: scoreReference(query, reference),
  })).sort((left, right) => right.score - left.score);
  return ranked[0] ?? null;
}

function sourceUrl(origin: string, slug: string): string {
  return new URL(`/reference/${slug}`, origin).toString();
}

function sourceForReference(origin: string, reference: ReferenceEntry): SourceDescriptor {
  return {
    id: `${SOURCE_DESCRIPTOR.id}:${reference.slug}`,
    name: `${SOURCE_DESCRIPTOR.name}: ${reference.title}`,
    url: sourceUrl(origin, reference.slug),
  };
}

function buildFallbackAnswer(
  query: string,
  origin: string,
  match: { reference: ReferenceEntry; score: number } | null,
): { answer: string; sources: SourceDescriptor[]; retrievedSources: SourceDescriptor[] } {
  if (match && match.score > 0) {
    const source = sourceForReference(origin, match.reference);
    return {
      answer: [
        `Based on indexed KOTOR archive material, here is a concise answer about ${query}:`,
        "",
        `- ${match.reference.title}: ${match.reference.summary} [1]`,
        "",
        "Sources",
        `1. ${source.name} - ${source.url}`,
      ].join("\n"),
      sources: [source],
      retrievedSources: [source],
    };
  }

  const supported = REFERENCES.map((reference, index) => `${index + 1}. ${reference.title}`).join("\n");
  return {
    answer: [
      `I do not have enough built-in evidence to answer "${query}" confidently from this public fallback API.`,
      "",
      "The public fallback currently has bundled references for these technical topics:",
      supported,
      "",
      "Sources",
      `1. ${SOURCE_DESCRIPTOR.name} - ${new URL("/reference", origin).toString()}`,
    ].join("\n"),
    sources: [
      {
        id: SOURCE_DESCRIPTOR.id,
        name: SOURCE_DESCRIPTOR.name,
        url: new URL("/reference", origin).toString(),
      },
    ],
    retrievedSources: [],
  };
}

function rememberRecord(record: QueryRecord): void {
  queryStore.set(record.queryId, record);

  const threadIds = threadStore.get(record.threadId) ?? [];
  threadIds.unshift(record.queryId);
  threadStore.set(record.threadId, [...new Set(threadIds)].slice(0, 50));

  const historyIds = userHistoryStore.get(record.userId) ?? [];
  historyIds.unshift(record.queryId);
  userHistoryStore.set(record.userId, [...new Set(historyIds)].slice(0, 100));
}

function recordsForIds(ids: string[]): QueryRecord[] {
  return ids
    .map((id) => queryStore.get(id))
    .filter((record): record is QueryRecord => Boolean(record))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function referencePage(reference: ReferenceEntry): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${reference.title}</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 720px; margin: 3rem auto; padding: 0 1rem; line-height: 1.6; background: #111827; color: #f9fafb; }
      h1 { color: #fca5a5; }
      code { background: rgba(255,255,255,0.08); padding: 0.1rem 0.3rem; border-radius: 4px; }
      a { color: #fca5a5; }
    </style>
  </head>
  <body>
    <h1>${reference.title}</h1>
    <p>${reference.summary}</p>
    <p><strong>Tags:</strong> ${reference.tags.join(", ")}</p>
    <p>This reference is bundled with the public Holocron fallback API.</p>
  </body>
</html>`;
}

export async function handleBuiltinRequest(request: Request): Promise<Response | null> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const publicOrigin = externalOrigin(request, url);

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
    return textResponse(200, "OpenKotOR Trask API is running.\n", origin);
  }

  if (url.pathname === "/healthz" && request.method === "GET") {
    return jsonResponse(200, { ok: true, mode: "builtin-public-api" }, origin);
  }

  if (url.pathname === "/reference" && request.method === "GET") {
    const body = [
      '<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Trask Technical References</title></head><body>',
      "<h1>Trask Technical References</h1>",
      "<ul>",
      ...REFERENCES.map(
        (reference) => `<li><a href="/reference/${reference.slug}">${reference.title}</a></li>`,
      ),
      "</ul>",
      "</body></html>",
    ].join("");
    return textResponse(200, body, origin, "text/html; charset=utf-8");
  }

  if (url.pathname.startsWith("/reference/") && request.method === "GET") {
    const slug = decodeURIComponent(url.pathname.slice("/reference/".length));
    const reference = REFERENCES.find((entry) => entry.slug === slug);
    if (!reference) {
      return textResponse(404, "Not found", origin);
    }
    return textResponse(200, referencePage(reference), origin, "text/html; charset=utf-8");
  }

  if (!url.pathname.startsWith("/api/trask")) {
    return null;
  }

  if (url.pathname === "/api/trask/session" && request.method === "GET") {
    return jsonResponse(200, { loggedIn: false, oauthAvailable: false }, origin);
  }

  if (url.pathname === "/api/trask/auth/logout" && request.method === "POST") {
    return jsonResponse(204, {}, origin);
  }

  if (url.pathname === "/api/trask/models" && request.method === "GET") {
    return jsonResponse(
      200,
      { models: [{ id: "auto", label: "Auto", provider: "Public fallback", recommended: true }] },
      origin,
    );
  }

  if (url.pathname === "/api/trask/sources" && request.method === "GET") {
    const sources = REFERENCES.map((reference) => ({
      ...SOURCE_DESCRIPTOR,
      id: `${SOURCE_DESCRIPTOR.id}:${reference.slug}`,
      name: `${SOURCE_DESCRIPTOR.name}: ${reference.title}`,
      homeUrl: sourceUrl(publicOrigin, reference.slug),
    }));
    return jsonResponse(200, { sources }, origin);
  }

  if (url.pathname.startsWith("/api/trask/thread/") && request.method === "GET") {
    const threadId = decodeURIComponent(url.pathname.slice("/api/trask/thread/".length));
    if (!isUuid(threadId)) {
      return jsonResponse(400, { error: "Invalid thread id." }, origin);
    }
    const ids = threadStore.get(threadId) ?? [];
    return jsonResponse(200, { history: recordsForIds(ids) }, origin);
  }

  if (url.pathname === "/api/trask/history" && request.method === "GET") {
    const threadId = url.searchParams.get("thread");
    const limit = Math.max(
      1,
      Math.min(100, Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20),
    );
    const ids = threadId
      ? (threadStore.get(threadId) ?? [])
      : (userHistoryStore.get("qa-webui") ?? []);
    return jsonResponse(200, { history: recordsForIds(ids).slice(0, limit) }, origin);
  }

  if (
    url.pathname.startsWith("/api/trask/query/") &&
    url.pathname.endsWith("/cancel") &&
    request.method === "POST"
  ) {
    const queryId = decodeURIComponent(
      url.pathname.slice("/api/trask/query/".length, -"/cancel".length),
    );
    const record = queryStore.get(queryId);
    if (!record) {
      return jsonResponse(404, { error: "Query not found." }, origin);
    }
    return jsonResponse(200, { query: record }, origin);
  }

  if (url.pathname === "/api/trask/ask" && request.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body." }, origin);
    }

    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) {
      return jsonResponse(400, { error: "Query is required." }, origin);
    }

    const providedThreadId = typeof body.threadId === "string" ? body.threadId.trim() : "";
    if (providedThreadId && !isUuid(providedThreadId)) {
      return jsonResponse(422, { error: "threadId must be a valid UUID." }, origin);
    }

    const threadId = providedThreadId || crypto.randomUUID();
    const queryId = crypto.randomUUID();
    const now = new Date().toISOString();
    const match = chooseReference(query);
    const { answer, sources, retrievedSources } = buildFallbackAnswer(query, publicOrigin, match);
    const record: QueryRecord = {
      queryId,
      threadId,
      userId: "qa-webui",
      query,
      status: "complete",
      answer,
      sources,
      retrievedSources,
      visitedUrls: [],
      error: null,
      createdAt: now,
      completedAt: now,
      liveTrace: [
        { at: now, phase: "queued", detail: "Builtin public Trask query accepted." },
        { at: now, phase: "compose", detail: "Rendered bundled technical reference answer." },
      ],
    };
    rememberRecord(record);
    return jsonResponse(201, { query: record }, origin);
  }

  return jsonResponse(404, { error: "Not found" }, origin);
}
