import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { FileChunkStore } from "@openkotor/retrieval";

import { importDiscordExport } from "./discord-export-import.js";

const distDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.resolve(distDir, "../../../fixtures/discord-export-minimal");

test("importDiscordExport writes chunks from minimal fixture", async (t) => {
  const state = await mkdtemp(path.join(tmpdir(), "ingest-discord-import-"));
  t.after(async () => {
    await rm(state, { recursive: true, force: true });
  });

  const store = new FileChunkStore(state);
  const outcome = await importDiscordExport(fixtureRoot, { dryRun: false, chunkStore: store });

  assert.equal(outcome.containerCount, 1);
  assert.equal(outcome.chunkCount, 1);

  const idx = await store.loadSourceIndex("approved-discord-knowledge");
  assert.ok(idx);
  assert.equal(idx!.chunkCount, 1);

  const all = await store.loadAllChunks();
  assert.equal(all.length, 1);
  assert.ok(all[0]!.chunkText.includes("Holocron exports"));
  assert.ok(all[0]!.url.startsWith("discord://approved-channels/900000000000000001/"));
});

test("importDiscordExport stores HTTPS permalinks when guildId is provided", async (t) => {
  const state = await mkdtemp(path.join(tmpdir(), "ingest-discord-guild-"));
  t.after(async () => {
    await rm(state, { recursive: true, force: true });
  });

  const store = new FileChunkStore(state);
  await importDiscordExport(fixtureRoot, {
    dryRun: false,
    chunkStore: store,
    guildId: "100000000000000099",
  });

  const all = await store.loadAllChunks();
  assert.equal(all.length, 1);
  assert.equal(all[0]!.url, "https://discord.com/channels/100000000000000099/900000000000000001/1000000000000000001");
  assert.ok(all[0]!.tags.includes("guild:100000000000000099"));
});

test("importDiscordExport dry-run does not persist", async (t) => {
  const state = await mkdtemp(path.join(tmpdir(), "ingest-discord-dry-"));
  t.after(async () => {
    await rm(state, { recursive: true, force: true });
  });

  const store = new FileChunkStore(state);
  const outcome = await importDiscordExport(fixtureRoot, { dryRun: true, chunkStore: store });

  assert.equal(outcome.chunkCount, 1);
  const idx = await store.loadSourceIndex("approved-discord-knowledge");
  assert.equal(idx, undefined);
});
