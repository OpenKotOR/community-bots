import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { JsonTraskQueryRepository } from "@openkotor/persistence";
import type { SourceDescriptor } from "@openkotor/retrieval";
import type {
  ResearchWizardAnswer,
  ResearchWizardProgressEvent,
  ResearchWizardQueryHandler,
  ResearchWizardQueryOptions,
} from "@openkotor/trask";
import express from "express";
import request from "supertest";

import { createTraskHttpRouter } from "./router.js";

const mockSource: SourceDescriptor = {
  id: "test-src",
  name: "Test Source",
  kind: "website",
  homeUrl: "https://example.com",
  description: "",
  freshnessPolicy: "manual",
  approvalScope: "test",
  tags: [],
};

const mockWizard: ResearchWizardQueryHandler = {
  async answerQuestion(
    _query: string,
    onProgress?: (event: ResearchWizardProgressEvent) => void,
  ): Promise<ResearchWizardAnswer> {
    onProgress?.({ phase: "gather", detail: "test" });
    return {
      answer: "Stub answer.\n\nSources\n1. Test Source - https://example.com",
      approvedSources: [mockSource],
      retrievedSources: [mockSource],
      visitedUrls: ["https://example.com"],
    };
  },
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let tmpDir: string;

test.before(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "trask-http-test-"));
});

test.after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

test("GET /session returns anonymous payload by default", async () => {
  const queryRepository = new JsonTraskQueryRepository(path.join(tmpDir, `qs-${Math.random()}.json`));
  const searchProvider = {
    async listSources() {
      return [];
    },
    async search() {
      return [];
    },
    async queueReindex() {
      return { queuedSourceIds: [] as string[], mode: "file-queue" as const };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    "/api/trask",
    createTraskHttpRouter({
      runtime: {
        searchProvider,
        webResearch: mockWizard,
        queryRepository,
      },
      auth: {
        requireAuth: (handler) => async (req, res) => handler(req, res, { id: "user-1" }),
      },
    }),
  );

  const res = await request(app).get("/api/trask/session");
  assert.equal(res.status, 200);
  assert.equal(res.body.loggedIn, false);
  assert.equal(res.body.oauthAvailable, false);
});

test("GET /session uses getSession override", async () => {
  const queryRepository = new JsonTraskQueryRepository(path.join(tmpDir, `qs2-${Math.random()}.json`));
  const searchProvider = {
    async listSources() {
      return [];
    },
    async search() {
      return [];
    },
    async queueReindex() {
      return { queuedSourceIds: [] as string[], mode: "file-queue" as const };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    "/api/trask",
    createTraskHttpRouter({
      runtime: {
        searchProvider,
        webResearch: mockWizard,
        queryRepository,
      },
      auth: {
        requireAuth: (handler) => async (req, res) => handler(req, res, { id: "user-1" }),
      },
      getSession: () => ({
        loggedIn: true,
        oauthAvailable: true,
        discord: { id: "d1", username: "u", displayName: "U" },
      }),
    }),
  );

  const res = await request(app).get("/api/trask/session");
  assert.equal(res.status, 200);
  assert.equal(res.body.loggedIn, true);
  assert.equal(res.body.discord?.id, "d1");
});

test("POST /auth/logout returns 204 by default", async () => {
  const queryRepository = new JsonTraskQueryRepository(path.join(tmpDir, `ql-${Math.random()}.json`));
  const searchProvider = {
    async listSources() {
      return [];
    },
    async search() {
      return [];
    },
    async queueReindex() {
      return { queuedSourceIds: [] as string[], mode: "file-queue" as const };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    "/api/trask",
    createTraskHttpRouter({
      runtime: {
        searchProvider,
        webResearch: mockWizard,
        queryRepository,
      },
      auth: {
        requireAuth: (handler) => async (req, res) => handler(req, res, { id: "user-1" }),
      },
    }),
  );

  const res = await request(app).post("/api/trask/auth/logout");
  assert.equal(res.status, 204);
});

test("GET /sources returns JSON when authenticated", async () => {
  const queryRepository = new JsonTraskQueryRepository(path.join(tmpDir, `q-${Math.random()}.json`));
  const searchProvider = {
    async listSources() {
      return [mockSource] as const;
    },
    async search() {
      return [];
    },
    async queueReindex() {
      return { queuedSourceIds: [] as string[], mode: "file-queue" as const };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    "/api/trask",
    createTraskHttpRouter({
      runtime: {
        searchProvider,
        webResearch: mockWizard,
        queryRepository,
      },
      auth: {
        requireAuth: (handler) => async (req, res) => handler(req, res, { id: "user-1" }),
      },
    }),
  );

  const res = await request(app).get("/api/trask/sources");
  assert.equal(res.status, 200);
  assert.equal(res.body.sources?.length, 1);
  assert.equal(res.body.sources[0].id, "test-src");
});

test("GET /models defaults to Auto only when the wizard has no live model list", async () => {
  const queryRepository = new JsonTraskQueryRepository(path.join(tmpDir, `qm-${Math.random()}.json`));
  const searchProvider = {
    async listSources() {
      return [];
    },
    async search() {
      return [];
    },
    async queueReindex() {
      return { queuedSourceIds: [] as string[], mode: "file-queue" as const };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    "/api/trask",
    createTraskHttpRouter({
      runtime: {
        searchProvider,
        webResearch: mockWizard,
        queryRepository,
      },
      auth: {
        requireAuth: (handler) => async (req, res) => handler(req, res, { id: "user-1" }),
      },
    }),
  );

  const res = await request(app).get("/api/trask/models");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.models, [
    { id: "auto", label: "Auto", provider: "Trask web research", recommended: true },
  ]);
});

test("GET /models filters out non-free model ids", async () => {
  const queryRepository = new JsonTraskQueryRepository(path.join(tmpDir, `qmf-${Math.random()}.json`));
  const searchProvider = {
    async listSources() {
      return [];
    },
    async search() {
      return [];
    },
    async queueReindex() {
      return { queuedSourceIds: [] as string[], mode: "file-queue" as const };
    },
  };

  const webResearch = {
    ...mockWizard,
    async listModels() {
      return [
        { id: "openrouter:openrouter/free", label: "Free", provider: "OpenRouter" },
        { id: "litellm:foo/bar", label: "Paid-ish", provider: "Trask web research" },
        { id: "vendor/model:free", label: "Free tag", provider: "Vendor" },
      ];
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    "/api/trask",
    createTraskHttpRouter({
      runtime: {
        searchProvider,
        webResearch,
        queryRepository,
      },
      auth: {
        requireAuth: (handler) => async (req, res) => handler(req, res, { id: "user-1" }),
      },
    }),
  );

  const res = await request(app).get("/api/trask/models");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.models, [
    { id: "auto", label: "Auto", provider: "Trask web research", recommended: true },
    { id: "openrouter:openrouter/free", label: "Free", provider: "OpenRouter" },
    { id: "vendor/model:free", label: "Free tag", provider: "Vendor" },
  ]);
});

test("POST /ask rejects model ids outside the current web research model list", async () => {
  const queryRepository = new JsonTraskQueryRepository(path.join(tmpDir, `qmr-${Math.random()}.json`));
  const searchProvider = {
    async listSources() {
      return [];
    },
    async search() {
      return [];
    },
    async queueReindex() {
      return { queuedSourceIds: [] as string[], mode: "file-queue" as const };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    "/api/trask",
    createTraskHttpRouter({
      runtime: {
        searchProvider,
        webResearch: mockWizard,
        queryRepository,
      },
      auth: {
        requireAuth: (handler) => async (req, res) => handler(req, res, { id: "user-1" }),
      },
    }),
  );

  const res = await request(app)
    .post("/api/trask/ask")
    .send({ query: "What is KOTOR?", model: "openrouter:anthropic/claude-opus-4.1" });

  assert.equal(res.status, 422);
  assert.match(res.body.error, /model is not available/i);
});

test("POST /ask persists, returns 202, completes asynchronously", async () => {
  const queryRepository = new JsonTraskQueryRepository(path.join(tmpDir, `q2-${Math.random()}.json`));
  const searchProvider = {
    async listSources() {
      return [];
    },
    async search() {
      return [];
    },
    async queueReindex() {
      return { queuedSourceIds: [] as string[], mode: "file-queue" as const };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    "/api/trask",
    createTraskHttpRouter({
      runtime: {
        searchProvider,
        webResearch: mockWizard,
        queryRepository,
      },
      auth: {
        requireAuth: (handler) => async (req, res) => handler(req, res, { id: "user-1" }),
      },
    }),
  );

  const res = await request(app).post("/api/trask/ask").send({ query: "What is KOTOR?" });
  assert.equal(res.status, 202);
  assert.equal(res.body.query?.status, "pending");
  assert.equal(res.body.query?.answer, null);
  assert.ok(typeof res.body.query?.threadId === "string" && res.body.query.threadId.length > 0);

  let row: { status?: string; answer?: string | null } | undefined;
  for (let i = 0; i < 40; i++) {
    const hist = await request(app).get("/api/trask/history?limit=5");
    assert.equal(hist.status, 200);
    row = hist.body.history?.[0];
    if (row?.status === "complete") break;
    await sleep(25);
  }
  assert.equal(row?.status, "complete");
  assert.ok(String(row?.answer).includes("Stub answer"));
});

test("POST /ask accumulates liveTrace with diag through async progress", async () => {
  const queryRepository = new JsonTraskQueryRepository(path.join(tmpDir, `q-trace-${Math.random()}.json`));
  const searchProvider = {
    async listSources() {
      return [];
    },
    async search() {
      return [];
    },
    async queueReindex() {
      return { queuedSourceIds: [] as string[], mode: "file-queue" as const };
    },
  };

  const traceWizard: ResearchWizardQueryHandler = {
    async answerQuestion(_query, onProgress) {
      await onProgress?.({
        phase: "gather",
        detail: "POST /retrieve → 9 passage(s)",
        diag: { passages: 9, indexer: "http://127.0.0.1:8787" },
        urls: ["https://example.com/a"],
      });
      await onProgress?.({
        phase: "compose",
        detail: "Done · grounded",
        diag: { grounding_status: "grounded", cited_sources: 2 },
      });
      return {
        answer: "Trace answer.\n\nSources\n1. Test Source - https://example.com",
        approvedSources: [mockSource],
        retrievedSources: [mockSource],
        visitedUrls: ["https://example.com"],
        groundingStatus: "grounded",
      };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    "/api/trask",
    createTraskHttpRouter({
      runtime: {
        searchProvider,
        webResearch: traceWizard,
        queryRepository,
      },
      auth: {
        requireAuth: (handler) => async (req, res) => handler(req, res, { id: "user-1" }),
      },
    }),
  );

  const created = await request(app).post("/api/trask/ask").send({ query: "Trace test?" });
  assert.equal(created.status, 202);
  const threadId = created.body.query?.threadId as string;
  const queryId = created.body.query?.queryId as string;

  type TraceRow = {
    status?: string;
    groundingStatus?: string;
    liveTrace?: Array<{ phase?: string; detail?: string; diag?: Record<string, unknown> }>;
  };
  let completed: TraceRow | undefined;
  for (let i = 0; i < 40; i++) {
    const pub = await request(app).get(`/api/trask/thread/${threadId}`);
    assert.equal(pub.status, 200);
    completed = pub.body.history?.find((row: { queryId?: string }) => row.queryId === queryId) as TraceRow | undefined;
    if (completed?.status === "complete") break;
    await sleep(25);
  }

  assert.equal(completed?.status, "complete");
  assert.equal(completed?.groundingStatus, "grounded");
  const trace = completed?.liveTrace ?? [];
  assert.ok(trace.length >= 3, `expected multiple liveTrace steps, got ${trace.length}`);
  assert.ok(
    trace.some((step) => step.diag && typeof step.diag.indexer === "string"),
    "liveTrace should persist indexer diag",
  );
  assert.ok(
    trace.some((step) => step.phase === "compose" && String(step.detail).includes("Done")),
    "liveTrace should include final compose step",
  );
});

test("POST /ask grows liveTrace while query is still pending", async () => {
  const queryRepository = new JsonTraskQueryRepository(path.join(tmpDir, `q-pending-trace-${Math.random()}.json`));
  const searchProvider = {
    async listSources() {
      return [];
    },
    async search() {
      return [];
    },
    async queueReindex() {
      return { queuedSourceIds: [] as string[], mode: "file-queue" as const };
    },
  };

  let releaseGather!: () => void;
  const gatherGate = new Promise<void>((resolve) => {
    releaseGather = resolve;
  });

  const gatedWizard: ResearchWizardQueryHandler = {
    async answerQuestion(_query, onProgress) {
      await onProgress?.({ phase: "gather", detail: "mid-gather checkpoint" });
      await gatherGate;
      await onProgress?.({ phase: "compose", detail: "Done · grounded" });
      return {
        answer: "Gated answer.\n\nSources\n1. Test Source - https://example.com",
        approvedSources: [mockSource],
        retrievedSources: [mockSource],
        visitedUrls: ["https://example.com"],
        groundingStatus: "grounded",
      };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    "/api/trask",
    createTraskHttpRouter({
      runtime: {
        searchProvider,
        webResearch: gatedWizard,
        queryRepository,
      },
      auth: {
        requireAuth: (handler) => async (req, res) => handler(req, res, { id: "user-1" }),
      },
    }),
  );

  const created = await request(app).post("/api/trask/ask").send({ query: "Pending trace?" });
  assert.equal(created.status, 202);
  const threadId = created.body.query?.threadId as string;
  const queryId = created.body.query?.queryId as string;

  type TraceRow = {
    status?: string;
    liveTrace?: Array<{ phase?: string }>;
  };
  let sawPendingTrace = false;
  for (let i = 0; i < 40; i++) {
    const pub = await request(app).get(`/api/trask/thread/${threadId}`);
    const row = pub.body.history?.find((entry: { queryId?: string }) => entry.queryId === queryId) as
      | TraceRow
      | undefined;
    if (row?.status === "pending" && (row.liveTrace?.length ?? 0) >= 2) {
      sawPendingTrace = true;
      break;
    }
    await sleep(25);
  }
  assert.equal(sawPendingTrace, true, "expected liveTrace to grow before completion");

  releaseGather();

  let completed: TraceRow | undefined;
  for (let i = 0; i < 40; i++) {
    const pub = await request(app).get(`/api/trask/thread/${threadId}`);
    completed = pub.body.history?.find((entry: { queryId?: string }) => entry.queryId === queryId) as
      | TraceRow
      | undefined;
    if (completed?.status === "complete") break;
    await sleep(25);
  }
  assert.equal(completed?.status, "complete");
  assert.ok((completed?.liveTrace?.length ?? 0) >= 3);
});

test("POST /ask forwards source weights to the research wizard", async () => {
  const queryRepository = new JsonTraskQueryRepository(path.join(tmpDir, `q-weights-${Math.random()}.json`));
  const searchProvider = {
    async listSources() {
      return [];
    },
    async search() {
      return [];
    },
    async queueReindex() {
      return { queuedSourceIds: [] as string[], mode: "file-queue" as const };
    },
  };
  let receivedOptions: ResearchWizardQueryOptions | undefined;
  const weightedWizard: ResearchWizardQueryHandler = {
    async answerQuestion(_query, _onProgress, options) {
      receivedOptions = options;
      return {
        answer: "Weighted answer.\n\nSources\n1. Test Source - https://example.com",
        approvedSources: [mockSource],
        retrievedSources: [mockSource],
        visitedUrls: ["https://example.com"],
      };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    "/api/trask",
    createTraskHttpRouter({
      runtime: {
        searchProvider,
        webResearch: weightedWizard,
        queryRepository,
      },
      auth: {
        requireAuth: (handler) => async (req, res) => handler(req, res, { id: "user-1", persistQueries: false }),
      },
    }),
  );

  const res = await request(app)
    .post("/api/trask/ask")
    .send({
      query: "What is KOTOR?",
      sourceWeights: [
        { name: "Deadly Stream", url: "https://deadlystream.com", weight: 1.8, enabled: true },
        { name: "GitHub KOTOR Projects", url: "https://github.com", weight: 0.4, enabled: false },
      ],
    });

  assert.equal(res.status, 201);
  assert.equal(receivedOptions?.sourcePreferences?.length, 2);
  assert.equal(receivedOptions?.sourcePreferences?.[0]?.url, "https://deadlystream.com");
  assert.equal(receivedOptions?.sourcePreferences?.[0]?.weight, 1.8);
  assert.equal(receivedOptions?.sourcePreferences?.[1]?.enabled, false);
});

test("GET /thread/:threadId returns persisted rows for the authenticated user", async () => {
  const queryRepository = new JsonTraskQueryRepository(path.join(tmpDir, `q3-${Math.random()}.json`));
  const searchProvider = {
    async listSources() {
      return [];
    },
    async search() {
      return [];
    },
    async queueReindex() {
      return { queuedSourceIds: [] as string[], mode: "file-queue" as const };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    "/api/trask",
    createTraskHttpRouter({
      runtime: {
        searchProvider,
        webResearch: mockWizard,
        queryRepository,
      },
      auth: {
        requireAuth: (handler) => async (req, res) => {
          const raw = req.headers["x-test-user"];
          const id = typeof raw === "string" && raw.trim() ? raw.trim() : "user-1";
          await handler(req, res, { id });
        },
      },
    }),
  );

  const created = await request(app).post("/api/trask/ask").set("X-Test-User", "alice").send({ query: "Threaded?" });
  assert.equal(created.status, 202);
  const threadId = created.body.query?.threadId as string;

  const alien = await request(app).get(`/api/trask/thread/${threadId}`).set("X-Test-User", "bob");
  assert.equal(alien.status, 200);
  assert.equal(alien.body.history?.length, 0);

  let pubRow: { query?: string; status?: string } | undefined;
  for (let i = 0; i < 40; i++) {
    const pub = await request(app).get(`/api/trask/thread/${threadId}`).set("X-Test-User", "alice");
    assert.equal(pub.status, 200);
    assert.equal(pub.body.history?.length, 1);
    pubRow = pub.body.history[0];
    if (pubRow?.status === "complete") break;
    await sleep(25);
  }
  assert.equal(pubRow?.query, "Threaded?");
  assert.equal(pubRow?.status, "complete");
});

test("GET /thread/:threadId requires authentication", async () => {
  const queryRepository = new JsonTraskQueryRepository(path.join(tmpDir, `q3b-${Math.random()}.json`));
  const searchProvider = {
    async listSources() {
      return [];
    },
    async search() {
      return [];
    },
    async queueReindex() {
      return { queuedSourceIds: [] as string[], mode: "file-queue" as const };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    "/api/trask",
    createTraskHttpRouter({
      runtime: {
        searchProvider,
        webResearch: mockWizard,
        queryRepository,
      },
      auth: {
        requireAuth: (handler) => async (req, res) => {
          if (req.headers.authorization !== "Bearer ok") {
            res.status(401).json({ error: "nope" });
            return;
          }
          await handler(req, res, { id: "user-1" });
        },
      },
    }),
  );

  const tid = "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee";
  const unauth = await request(app).get(`/api/trask/thread/${tid}`);
  assert.equal(unauth.status, 401);

  const auth = await request(app).get(`/api/trask/thread/${tid}`).set("Authorization", "Bearer ok");
  assert.equal(auth.status, 200);
});

test("anonymous persistQueries=false skips disk but still returns threadId", async () => {
  const queryRepository = new JsonTraskQueryRepository(path.join(tmpDir, `q4-${Math.random()}.json`));
  const searchProvider = {
    async listSources() {
      return [];
    },
    async search() {
      return [];
    },
    async queueReindex() {
      return { queuedSourceIds: [] as string[], mode: "file-queue" as const };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    "/api/trask",
    createTraskHttpRouter({
      runtime: {
        searchProvider,
        webResearch: mockWizard,
        queryRepository,
      },
      auth: {
        requireAuth: (handler) => async (req, res) => handler(req, res, { id: "anon", persistQueries: false }),
      },
    }),
  );

  const res = await request(app).post("/api/trask/ask").send({ query: "Ephemeral?" });
  assert.equal(res.status, 201);
  assert.ok(res.body.query?.threadId);

  const hist = await request(app).get("/api/trask/history?limit=5");
  assert.equal(hist.status, 200);
  assert.equal(hist.body.history?.length, 0);

  const threadId = res.body.query.threadId as string;
  const pub = await request(app).get(`/api/trask/thread/${threadId}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.history?.length, 0);
});
