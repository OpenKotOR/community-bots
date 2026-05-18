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
        researchWizard: mockWizard,
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
        researchWizard: mockWizard,
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
        researchWizard: mockWizard,
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
        researchWizard: mockWizard,
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
        researchWizard: mockWizard,
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
    { id: "auto", label: "Auto", provider: "ResearchWizard fallback", recommended: true },
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

  const researchWizard = {
    ...mockWizard,
    async listModels() {
      return [
        { id: "openrouter:openrouter/free", label: "Free", provider: "OpenRouter" },
        { id: "litellm:foo/bar", label: "Paid-ish", provider: "ResearchWizard" },
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
        researchWizard,
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
    { id: "auto", label: "Auto", provider: "ResearchWizard fallback", recommended: true },
    { id: "openrouter:openrouter/free", label: "Free", provider: "OpenRouter" },
    { id: "vendor/model:free", label: "Free tag", provider: "Vendor" },
  ]);
});

test("POST /ask rejects model ids outside the current ResearchWizard list", async () => {
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
        researchWizard: mockWizard,
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
        researchWizard: mockWizard,
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
        researchWizard: weightedWizard,
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
        researchWizard: mockWizard,
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
        researchWizard: mockWizard,
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
        researchWizard: mockWizard,
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
