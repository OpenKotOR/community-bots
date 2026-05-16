import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  FileReindexQueueStore,
  FileChunkStore,
  StaticCatalogSearchProvider,
  ChunkSearchProvider,
  defaultSourceCatalog,
  type ChunkRecord,
  type SourceIndexRecord,
} from "./index.js";

// ---------------------------------------------------------------------------
// Shared temp-dir lifecycle
// ---------------------------------------------------------------------------

let tmpDir: string;
test.before(async () => { tmpDir = await mkdtemp(path.join(tmpdir(), "retrieval-test-")); });
test.after(async () => { await rm(tmpDir, { recursive: true, force: true }); });

const sd = (name: string) => path.join(tmpDir, `${name}-${Math.random().toString(36).slice(2, 8)}`);

const makeChunk = (overrides: Partial<ChunkRecord> = {}): ChunkRecord => ({
  id: overrides.id ?? `chunk-${Math.random().toString(36).slice(2, 10)}`,
  sourceId: overrides.sourceId ?? "test-source",
  sourceName: overrides.sourceName ?? "Test Source",
  kind: overrides.kind ?? "website",
  url: overrides.url ?? "https://example.com/page",
  title: overrides.title ?? "Test Page",
  chunkText: overrides.chunkText ?? "Some text about KOTOR.",
  fetchedAt: overrides.fetchedAt ?? Date.now(),
  chunkIndex: overrides.chunkIndex ?? 0,
  tags: overrides.tags ?? ["test"],
});

const makeIndex = (overrides: Partial<SourceIndexRecord> = {}): SourceIndexRecord => ({
  sourceId: overrides.sourceId ?? "test-source",
  sourceName: overrides.sourceName ?? "Test Source",
  kind: overrides.kind ?? "website",
  url: overrides.url ?? "https://example.com",
  chunkCount: overrides.chunkCount ?? 1,
  lastFetchedAt: overrides.lastFetchedAt ?? Date.now(),
  tags: overrides.tags ?? ["test"],
});

// ---------------------------------------------------------------------------
// FileReindexQueueStore
// ---------------------------------------------------------------------------

test("enqueue stores sourceIds and dequeueAll returns them", async () => {
  const store = new FileReindexQueueStore(sd("queue"));
  await store.enqueue(["source-a", "source-b"]);
  const items = await store.dequeueAll();
  assert.deepEqual([...items].sort(), ["source-a", "source-b"]);
});

test("dequeueAll empties the queue", async () => {
  const store = new FileReindexQueueStore(sd("queue"));
  await store.enqueue(["source-x"]);
  await store.dequeueAll();
  const second = await store.dequeueAll();
  assert.equal(second.length, 0);
});

test("enqueue deduplicates within a single call", async () => {
  const store = new FileReindexQueueStore(sd("queue"));
  await store.enqueue(["source-dup", "source-dup", "source-dup"]);
  const items = await store.dequeueAll();
  assert.equal(items.length, 1);
  assert.equal(items[0], "source-dup");
});

test("enqueue deduplicates across multiple calls", async () => {
  const store = new FileReindexQueueStore(sd("queue"));
  await store.enqueue(["source-multi"]);
  await store.enqueue(["source-multi"]);  // should not add again
  const items = await store.dequeueAll();
  assert.equal(items.length, 1);
});

test("enqueue returns only the newly added ids", async () => {
  const store = new FileReindexQueueStore(sd("queue"));
  const first = await store.enqueue(["s1", "s2"]);
  assert.deepEqual([...first].sort(), ["s1", "s2"]);
});

test("dequeueAll on a fresh store returns empty array", async () => {
  const store = new FileReindexQueueStore(sd("queue-fresh"));
  const items = await store.dequeueAll();
  assert.deepEqual([...items], []);
});

test("corrupt queue file is quarantined and replaced with empty state", async () => {
  const stateDir = sd("queue-corrupt");
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(stateDir, { recursive: true });
  // Write a corrupt JSON file
  await writeFile(path.join(stateDir, "reindex-queue.json"), "{{bad json!!}", "utf8");

  const store = new FileReindexQueueStore(stateDir);
  const items = await store.dequeueAll();  // should not throw
  assert.deepEqual([...items], []);
});

// ---------------------------------------------------------------------------
// FileChunkStore
// ---------------------------------------------------------------------------

test("saveChunk and loadChunksForSource round-trip", async () => {
  const store = new FileChunkStore(sd("chunks"));
  const chunk = makeChunk({ sourceId: "src-a", id: "c-001" });
  await store.saveChunk(chunk);

  const loaded = await store.loadChunksForSource("src-a");
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]!.id, "c-001");
  assert.equal(loaded[0]!.chunkText, chunk.chunkText);
});

test("loadChunksForSource returns empty array for unknown source", async () => {
  const store = new FileChunkStore(sd("chunks"));
  const results = await store.loadChunksForSource("nonexistent");
  assert.deepEqual(results, []);
});

test("loadAllChunks returns chunks from multiple sources", async () => {
  const store = new FileChunkStore(sd("chunks"));
  await store.saveChunk(makeChunk({ sourceId: "src-1", id: "c1" }));
  await store.saveChunk(makeChunk({ sourceId: "src-2", id: "c2" }));

  const all = await store.loadAllChunks();
  assert.equal(all.length, 2);
  assert.ok(all.some((c) => c.id === "c1"));
  assert.ok(all.some((c) => c.id === "c2"));
});

test("loadAllChunks returns empty array on empty store", async () => {
  const store = new FileChunkStore(sd("chunks-empty"));
  const all = await store.loadAllChunks();
  assert.deepEqual(all, []);
});

test("saveSourceIndex and loadSourceIndex round-trip", async () => {
  const store = new FileChunkStore(sd("chunks"));
  const index = makeIndex({ sourceId: "src-idx", chunkCount: 7 });
  await store.saveSourceIndex(index);

  const loaded = await store.loadSourceIndex("src-idx");
  assert.ok(loaded);
  assert.equal(loaded!.chunkCount, 7);
  assert.equal(loaded!.sourceId, "src-idx");
});

test("loadSourceIndex returns undefined for missing source", async () => {
  const store = new FileChunkStore(sd("chunks"));
  const result = await store.loadSourceIndex("missing-source");
  assert.equal(result, undefined);
});

test("loadAllSourceIndexes aggregates multiple source indexes", async () => {
  const store = new FileChunkStore(sd("chunks"));
  await store.saveSourceIndex(makeIndex({ sourceId: "src-a", chunkCount: 3 }));
  await store.saveSourceIndex(makeIndex({ sourceId: "src-b", chunkCount: 5 }));

  const indexes = await store.loadAllSourceIndexes();
  assert.equal(indexes.length, 2);
  assert.ok(indexes.some((idx) => idx.sourceId === "src-a"));
  assert.ok(indexes.some((idx) => idx.sourceId === "src-b"));
});

test("listIndexedSourceIds returns directory names", async () => {
  const store = new FileChunkStore(sd("chunks"));
  await store.saveChunk(makeChunk({ sourceId: "list-src-1" }));
  await store.saveChunk(makeChunk({ sourceId: "list-src-2" }));

  const ids = await store.listIndexedSourceIds();
  assert.ok(ids.includes("list-src-1"));
  assert.ok(ids.includes("list-src-2"));
});

// ---------------------------------------------------------------------------
// StaticCatalogSearchProvider
// ---------------------------------------------------------------------------

test("search returns hits scored by token overlap with name/description/tags", async () => {
  const queue = new FileReindexQueueStore(sd("q"));
  const provider = new StaticCatalogSearchProvider(defaultSourceCatalog, queue);

  const hits = await provider.search("deadlystream modding", 5);
  assert.ok(hits.length > 0);
  const topHit = hits[0]!;
  assert.ok(topHit.sourceId === "deadlystream", `expected deadlystream, got ${topHit.sourceId}`);
});

test("search returns empty array for a query with no matching tokens", async () => {
  const queue = new FileReindexQueueStore(sd("q"));
  const provider = new StaticCatalogSearchProvider(defaultSourceCatalog, queue);

  const hits = await provider.search("xxxxxxxx-no-match-yyyy");
  assert.deepEqual([...hits], []);
});

test("search respects the limit parameter", async () => {
  const queue = new FileReindexQueueStore(sd("q"));
  const provider = new StaticCatalogSearchProvider(defaultSourceCatalog, queue);

  const hits = await provider.search("kotor modding", 2);
  assert.ok(hits.length <= 2);
});

test("listSources returns all default catalog entries", async () => {
  const queue = new FileReindexQueueStore(sd("q"));
  const provider = new StaticCatalogSearchProvider(defaultSourceCatalog, queue);

  const sources = await provider.listSources();
  assert.ok(sources.length >= 8);
  assert.ok(sources.some((s) => s.id === "deadlystream"));
});

test("queueReindex queues all sources when no ids given", async () => {
  const queue = new FileReindexQueueStore(sd("q"));
  const provider = new StaticCatalogSearchProvider(defaultSourceCatalog, queue);

  const result = await provider.queueReindex();
  assert.equal(result.mode, "file-queue");
  assert.ok(result.queuedSourceIds.length >= 8);
});

test("queueReindex silently drops unknown source ids", async () => {
  const queue = new FileReindexQueueStore(sd("q"));
  const provider = new StaticCatalogSearchProvider(defaultSourceCatalog, queue);

  const result = await provider.queueReindex(["definitely-not-a-source-12345"]);
  assert.equal(result.queuedSourceIds.length, 0);
});

// ---------------------------------------------------------------------------
// ChunkSearchProvider
// ---------------------------------------------------------------------------

test("ChunkSearch returns chunk hits ranked above catalog fallback hits", async () => {
  const stateDir = sd("chunk-search");
  const chunkStore = new FileChunkStore(stateDir);
  const queue = new FileReindexQueueStore(stateDir);
  const catalog = new StaticCatalogSearchProvider(defaultSourceCatalog, queue);
  const provider = new ChunkSearchProvider(chunkStore, catalog);

  // Save a chunk that specifically matches this query
  await chunkStore.saveChunk(makeChunk({
    id: "revan-chunk",
    sourceId: "kotor-wiki",
    sourceName: "KOTOR Wiki",
    url: "https://local/kotor-wiki/revan",
    title: "Revan the Jedi",
    chunkText: "Revan was a legendary Jedi who fell to the dark side and became a Sith Lord.",
    tags: ["revan", "jedi", "sith"],
  }));

  const hits = await provider.search("revan jedi sith lord", 5);
  assert.ok(hits.length > 0);
  assert.equal(hits[0]!.url, "https://local/kotor-wiki/revan");
});

test("ChunkSearch deduplicates results by url", async () => {
  const stateDir = sd("chunk-search-dedup");
  const chunkStore = new FileChunkStore(stateDir);
  const queue = new FileReindexQueueStore(stateDir);

  // Two chunks from same URL
  await chunkStore.saveChunk(makeChunk({ id: "c-1", url: "https://example.com/page", chunkText: "modding kotor", tags: [] }));
  await chunkStore.saveChunk(makeChunk({ id: "c-2", url: "https://example.com/page", chunkText: "modding kotor more", tags: [] }));

  const catalog = new StaticCatalogSearchProvider([], queue);
  const provider = new ChunkSearchProvider(chunkStore, catalog);
  const hits = await provider.search("modding kotor", 10);

  const urls = hits.map((h) => h.url);
  const uniqueUrls = new Set(urls);
  assert.equal(urls.length, uniqueUrls.size, "results should not have duplicate URLs");
});

test("ChunkSearch returns empty array for empty query tokens", async () => {
  const stateDir = sd("chunk-search-empty");
  const chunkStore = new FileChunkStore(stateDir);
  const queue = new FileReindexQueueStore(stateDir);
  const catalog = new StaticCatalogSearchProvider([], queue);
  const provider = new ChunkSearchProvider(chunkStore, catalog);

  const hits = await provider.search("   ");
  assert.deepEqual([...hits], []);
});

test("ChunkSearch listSources delegates to catalog", async () => {
  const stateDir = sd("chunk-search-sources");
  const chunkStore = new FileChunkStore(stateDir);
  const queue = new FileReindexQueueStore(stateDir);
  const catalog = new StaticCatalogSearchProvider(defaultSourceCatalog, queue);
  const provider = new ChunkSearchProvider(chunkStore, catalog);

  const sources = await provider.listSources();
  assert.ok(sources.length >= 8);
});
