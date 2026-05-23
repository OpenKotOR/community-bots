import assert from "node:assert/strict";
import test from "node:test";

import {
  filterReachableByUrl,
  isHttpsCitationReachable,
  isSkippableCitationUrl,
} from "./citation-url-verify.js";

const restoreEnv = (keys: readonly string[], snapshot: Record<string, string | undefined>) => {
  for (const key of keys) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};

const snapshotEnv = (keys: readonly string[]): Record<string, string | undefined> => {
  const out: Record<string, string | undefined> = {};
  for (const key of keys) out[key] = process.env[key];
  return out;
};

const ENV_KEYS = [
  "TRASK_SKIP_CITATION_URL_VERIFY",
  "TRASK_FORCE_URL_VERIFY",
] as const;

test("filterReachableByUrl keeps verified passages without re-HEAD", async () => {
  const snap = snapshotEnv(ENV_KEYS);
  delete process.env.TRASK_SKIP_CITATION_URL_VERIFY;
  delete process.env.TRASK_FORCE_URL_VERIFY;

  let fetchCalls = 0;
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(null, { status: 500 });
  };

  try {
    const rows = await filterReachableByUrl([
      { url: "https://deadlystream.com/files/file/1982-tslpatcher/", verified: true },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = prevFetch;
    restoreEnv(ENV_KEYS, snap);
  }
});

test("filterReachableByUrl drops unreachable https URLs", async () => {
  const snap = snapshotEnv(ENV_KEYS);
  delete process.env.TRASK_SKIP_CITATION_URL_VERIFY;
  delete process.env.TRASK_FORCE_URL_VERIFY;

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 404 });

  try {
    const rows = await filterReachableByUrl([
      { url: "https://example.com/missing" },
    ]);
    assert.equal(rows.length, 0);
  } finally {
    globalThis.fetch = prevFetch;
    restoreEnv(ENV_KEYS, snap);
  }
});

test("isHttpsCitationReachable retries GET after HEAD failure", async () => {
  const snap = snapshotEnv(ENV_KEYS);
  delete process.env.TRASK_SKIP_CITATION_URL_VERIFY;

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "HEAD") return new Response(null, { status: 405 });
    return new Response("ok", { status: 200 });
  };

  try {
    const ok = await isHttpsCitationReachable("https://example.com/page");
    assert.equal(ok, true);
  } finally {
    globalThis.fetch = prevFetch;
    restoreEnv(ENV_KEYS, snap);
  }
});

test("isSkippableCitationUrl skips non-http and discord jump URLs", () => {
  assert.equal(isSkippableCitationUrl("discord://channel/1"), true);
  assert.equal(isSkippableCitationUrl("ftp://example.com/doc"), true);
  assert.equal(isSkippableCitationUrl("https://example.com"), false);
});

test("filterReachableByUrl honors TRASK_SKIP_CITATION_URL_VERIFY", async () => {
  const snap = snapshotEnv(ENV_KEYS);
  process.env.TRASK_SKIP_CITATION_URL_VERIFY = "1";

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch should not run when verify is skipped");
  };

  try {
    const rows = await filterReachableByUrl([
      { url: "https://example.com/any" },
    ]);
    assert.equal(rows.length, 1);
  } finally {
    globalThis.fetch = prevFetch;
    restoreEnv(ENV_KEYS, snap);
  }
});

test("filterReachableByUrl re-verifies when TRASK_FORCE_URL_VERIFY is set", async () => {
  const snap = snapshotEnv(ENV_KEYS);
  delete process.env.TRASK_SKIP_CITATION_URL_VERIFY;
  process.env.TRASK_FORCE_URL_VERIFY = "1";

  let fetchCalls = 0;
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(null, { status: 200 });
  };

  try {
    const rows = await filterReachableByUrl([
      { url: "https://example.com/forced", verified: true },
    ]);
    assert.equal(rows.length, 1);
    assert.ok(fetchCalls >= 1);
  } finally {
    globalThis.fetch = prevFetch;
    restoreEnv(ENV_KEYS, snap);
  }
});
