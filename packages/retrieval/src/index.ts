import { mkdir, open, readFile, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  classifyQueryIntent as classifyQueryIntentFromConfig,
  intentScoreDelta as intentScoreDeltaFromConfig,
  type QueryIntent,
} from "@openkotor/trask-config";

export type SourceKind = "website" | "github" | "discord";

export type SourceIntentBias = QueryIntent;

export interface SourceDescriptor {
  id: string;
  name: string;
  kind: SourceKind;
  homeUrl: string;
  description: string;
  freshnessPolicy: string;
  approvalScope: string;
  tags: readonly string[];
  /** Optional ranking hint for query-intent routing (see data/trask/linguistics.json). */
  intentBias?: SourceIntentBias;
  /** Optional host authority override (0–10); catalog default used when unset. */
  authorityWeight?: number;
}

const normalizeHost = (host: string): string => host.trim().toLowerCase().replace(/^www\./, "");

const hostMatchesBase = (host: string, baseHost: string): boolean => {
  const normalizedHost = normalizeHost(host);
  const normalizedBase = normalizeHost(baseHost);
  return normalizedHost === normalizedBase || normalizedHost.endsWith(`.${normalizedBase}`);
};

const normalizeUrlPrefix = (value: string): string => value.trim().replace(/\/+$/, "");

const urlStartsWithPrefix = (url: string, prefix: string): boolean => {
  const candidate = normalizeUrlPrefix(url);
  const normalizedPrefix = normalizeUrlPrefix(prefix);
  return candidate === normalizedPrefix || candidate.startsWith(`${normalizedPrefix}/`);
};

export interface SearchHit {
  sourceId: string;
  sourceName: string;
  kind: SourceKind;
  title: string;
  snippet: string;
  url: string;
  score: number;
  tags: readonly string[];
}

export interface SearchProvider {
  listSources(): Promise<readonly SourceDescriptor[]>;
  search(query: string, limit?: number): Promise<readonly SearchHit[]>;
  queueReindex(sourceIds?: readonly string[]): Promise<{ queuedSourceIds: readonly string[]; mode: "file-queue" }>;
}

interface ReindexQueueState {
  version: 1;
  queuedSourceIds: string[];
}

const emptyReindexQueueState = (): ReindexQueueState => ({
  version: 1,
  queuedSourceIds: [],
});

export class FileReindexQueueStore {
  private static readonly LOCK_TIMEOUT_MS = 5_000;
  private static readonly LOCK_RETRY_MS = 50;
  private static readonly LOCK_STALE_MS = 5 * 60_000;
  private static readonly LOCK_HEARTBEAT_MS = 30_000;

  public constructor(private readonly stateDir: string) {}

  private queueFilePath(): string {
    return path.join(this.stateDir, "reindex-queue.json");
  }

  private queueLockPath(): string {
    return path.join(this.stateDir, "reindex-queue.lock");
  }

  private async withQueueLock<T>(work: () => Promise<T>): Promise<T> {
    await mkdir(this.stateDir, { recursive: true });
    const lockPath = this.queueLockPath();
    const deadline = Date.now() + FileReindexQueueStore.LOCK_TIMEOUT_MS;

    for (;;) {
      try {
        const lockHandle = await open(lockPath, "wx");
        const heartbeat = setInterval(() => {
          const now = new Date();
          void utimes(lockPath, now, now).catch(() => {
            // Ignore heartbeat failures; lock release/timeout handling remains authoritative.
          });
        }, FileReindexQueueStore.LOCK_HEARTBEAT_MS);
        heartbeat.unref?.();

        try {
          return await work();
        } finally {
          clearInterval(heartbeat);
          await lockHandle.close();
          await rm(lockPath, { force: true });
        }
      } catch (error) {
        const isLockContention =
          typeof error === "object"
          && error !== null
          && "code" in error
          && (error as { code?: string }).code === "EEXIST";

        if (!isLockContention) {
          throw error;
        }

        try {
          const lockStats = await stat(lockPath);
          const lockAgeMs = Date.now() - lockStats.mtimeMs;
          if (lockAgeMs >= FileReindexQueueStore.LOCK_STALE_MS) {
            await rm(lockPath, { force: true });
            continue;
          }
        } catch {
          // Lock disappeared between contention and inspection; just retry.
        }

        if (Date.now() >= deadline) {
          throw new Error("Timed out waiting for reindex queue lock.");
        }

        await new Promise((resolve) => setTimeout(resolve, FileReindexQueueStore.LOCK_RETRY_MS));
      }
    }
  }

  private async loadState(): Promise<ReindexQueueState> {
    const queuePath = this.queueFilePath();
    let raw: string;

    try {
      raw = await readFile(queuePath, "utf8");
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: string }).code
        : undefined;
      if (code === "ENOENT") {
        return emptyReindexQueueState();
      }
      throw error;
    }

    let parsed: Partial<ReindexQueueState>;
    try {
      parsed = JSON.parse(raw) as Partial<ReindexQueueState>;
    } catch {
      const quarantinePath = `${queuePath}.corrupt.${Date.now()}`;
      await rename(queuePath, quarantinePath);
      return emptyReindexQueueState();
    }

    if (parsed.version !== 1 || !Array.isArray(parsed.queuedSourceIds)) {
      const quarantinePath = `${queuePath}.corrupt.${Date.now()}`;
      await rename(queuePath, quarantinePath);
      return emptyReindexQueueState();
    }

    return {
      version: 1,
      queuedSourceIds: parsed.queuedSourceIds
        .map((entry) => String(entry).trim())
        .filter((entry) => entry.length > 0),
    };
  }

  private async saveState(state: ReindexQueueState): Promise<void> {
    await mkdir(this.stateDir, { recursive: true });
    const queuePath = this.queueFilePath();
    const tempPath = `${queuePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
    await rename(tempPath, queuePath);
  }

  public async enqueue(sourceIds: readonly string[]): Promise<readonly string[]> {
    const normalizedIds = [...new Set(sourceIds.map((sourceId) => sourceId.trim()).filter((sourceId) => sourceId.length > 0))];
    await this.withQueueLock(async () => {
      const state = await this.loadState();
      const queued = [...state.queuedSourceIds];
      const queuedSet = new Set(queued);

      for (const sourceId of normalizedIds) {
        if (!queuedSet.has(sourceId)) {
          queued.push(sourceId);
          queuedSet.add(sourceId);
        }
      }

      await this.saveState({
        version: 1,
        queuedSourceIds: queued,
      });
    });

    return normalizedIds;
  }

  public async dequeueAll(): Promise<readonly string[]> {
    return this.withQueueLock(async () => {
      const state = await this.loadState();
      const queued = [...state.queuedSourceIds];

      await this.saveState(emptyReindexQueueState());
      return queued;
    });
  }
}

const RETRIEVAL_STOPWORDS = new Set([
  "what",
  "where",
  "when",
  "which",
  "who",
  "how",
  "does",
  "used",
  "about",
  "with",
  "from",
  "into",
  "game",
  "games",
  "star",
  "wars",
  "knights",
  "republic",
  "kotor",
  "kotor1",
  "kotor2",
  "pc",
]);

type RetrievalQueryIntent = QueryIntent;

const normalizeToken = (token: string): string => {
  const lowered = token.toLowerCase();
  if (lowered.length <= 6) return lowered;
  return lowered.slice(0, 6);
};

const tokenize = (value: string): string[] => {
  return [...new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9.+-]+/)
      .filter((token) => token.length >= 4 && !RETRIEVAL_STOPWORDS.has(token))
      .map(normalizeToken),
  )];
};

const classifyQueryIntent = (query: string): RetrievalQueryIntent => classifyQueryIntentFromConfig(query);

const intentScoreDelta = (intent: RetrievalQueryIntent, tags: readonly string[]): number =>
  intentScoreDeltaFromConfig(intent, tags);

export const loreSourceIdsFromCatalog = (sources: readonly SourceDescriptor[]): readonly string[] => {
  const fromCatalog = sources.filter((source) => source.intentBias === "lore").map((source) => source.id);
  return fromCatalog.length > 0 ? fromCatalog : [];
};

export const defaultSourceCatalog: readonly SourceDescriptor[] = [
  {
    id: "deadlystream",
    name: "Deadly Stream",
    kind: "website",
    homeUrl: "https://deadlystream.com",
    description: "Primary KOTOR modding hub for releases, forum threads, and troubleshooting context.",
    freshnessPolicy: "daily metadata sync plus on-demand scrape for cited pages",
    approvalScope: "public modding resources",
    tags: ["mods", "forum", "support", "tslrcm"],
  },
  {
    id: "lucasforums-archive",
    name: "LucasForums Archive",
    kind: "website",
    homeUrl: "https://lucasforumsarchive.org",
    description: "Archived historical forum discussions from the original KOTOR community.",
    freshnessPolicy: "static archive snapshot with selective recrawl",
    approvalScope: "public archived discussions",
    tags: ["archive", "history", "modding", "forums"],
  },
  {
    id: "pcgamingwiki-kotor",
    name: "PCGamingWiki",
    kind: "website",
    homeUrl: "https://www.pcgamingwiki.com",
    description: "Technical compatibility notes, fixes, and platform troubleshooting for KOTOR and TSL. Note: Cloudflare-protected — serves as reference display only; live scraping will fail.",
    freshnessPolicy: "manual reference only — site requires JavaScript to scrape",
    approvalScope: "public technical reference",
    tags: ["troubleshooting", "pc", "compatibility", "fixes"],
  },
  {
    id: "kotor-neocities",
    name: "KOTOR Neocities",
    kind: "website",
    homeUrl: "https://kotor.neocities.org",
    description: "Community-maintained technical notes and compact guides for KOTOR tooling and formats.",
    freshnessPolicy: "weekly crawl with manual pinning for key pages",
    approvalScope: "public documentation",
    tags: ["reference", "formats", "guides", "tooling"],
  },
  {
    id: "pykotor-wiki",
    name: "PyKotor Wiki",
    kind: "website",
    homeUrl: "https://github.com/NickHugi/PyKotor/wiki",
    description: "PyKotor-specific reference material for scripting, formats, and automation workflows.",
    freshnessPolicy: "pull wiki pages on demand when cited",
    approvalScope: "public project wiki",
    tags: ["pykotor", "python", "formats", "automation"],
  },
  {
    id: "reone-repo",
    name: "reone",
    kind: "github",
    homeUrl: "https://github.com/reone/reone",
    description: "Open-source engine reimplementation relevant to modern KOTOR runtime behavior discussions.",
    freshnessPolicy: "index tagged releases and main branch snapshots",
    approvalScope: "public source code",
    tags: ["engine", "reimplementation", "reone", "c++"],
  },
  {
    id: "northernlights-repo",
    name: "Northern Lights",
    kind: "github",
    homeUrl: "https://github.com/NickHugi/NorthernLights",
    description: "Engine and tooling work related to KOTOR data and rendering behavior.",
    freshnessPolicy: "main branch snapshots plus release tags",
    approvalScope: "public source code",
    tags: ["engine", "rendering", "northernlights", "tooling"],
  },
  {
    id: "mdlops-repo",
    name: "MDLOps",
    kind: "github",
    homeUrl: "https://github.com/bead-v/mdlops",
    description: "Model conversion and asset pipeline tooling for KOTOR models.",
    freshnessPolicy: "weekly source sync",
    approvalScope: "public source code",
    tags: ["mdlops", "models", "assets", "conversion"],
  },
  {
    id: "pykotor-repo",
    name: "PyKotor",
    kind: "github",
    homeUrl: "https://github.com/NickHugi/PyKotor",
    description: "Python library for KOTOR formats and automation, useful for scripts and data extraction.",
    freshnessPolicy: "main branch sync with issue-linked refreshes",
    approvalScope: "public source code",
    tags: ["pykotor", "python", "library", "formats"],
  },
  {
    id: "kotorjs-repo",
    name: "kotor.js",
    kind: "github",
    homeUrl: "https://github.com/KobaltBlu/KotOR.js",
    description: "JavaScript tooling and runtime work for KOTOR-oriented browser and Node workflows.",
    freshnessPolicy: "main branch sync with manual source pinning",
    approvalScope: "public source code",
    tags: ["kotor.js", "javascript", "web", "tooling"],
  },
  {
    id: "xoreos-repo",
    name: "xoreos",
    kind: "github",
    homeUrl: "https://github.com/xoreos/xoreos",
    description: "Open-source BioWare Odyssey/Aurora engine work relevant to KOTOR runtime and file behavior.",
    freshnessPolicy: "main branch sync with release snapshots",
    approvalScope: "public source code",
    tags: ["engine", "reimplementation", "xoreos", "c++"],
  },
  {
    id: "xoreos-tools-repo",
    name: "xoreos-tools",
    kind: "github",
    homeUrl: "https://github.com/xoreos/xoreos-tools",
    description: "Command-line tools for Odyssey/Aurora formats used in KOTOR reverse-engineering workflows.",
    freshnessPolicy: "main branch sync with release snapshots",
    approvalScope: "public source code",
    tags: ["formats", "tooling", "xoreos", "reverse-engineering"],
  },
  {
    id: "kotorblender-repo",
    name: "KotORBlender",
    kind: "github",
    homeUrl: "https://github.com/ndixUR/kotorblender",
    description: "Blender import/export tooling for KOTOR model and asset workflows.",
    freshnessPolicy: "weekly source sync",
    approvalScope: "public source code",
    tags: ["blender", "models", "assets", "tooling"],
  },
  {
    id: "kotormax-repo",
    name: "KOTORMax",
    kind: "github",
    homeUrl: "https://github.com/bead-v/kotormax",
    description: "3ds Max tooling for KOTOR model authoring and conversion workflows.",
    freshnessPolicy: "weekly source sync",
    approvalScope: "public source code",
    tags: ["3ds-max", "models", "assets", "tooling"],
  },
  {
    id: "mdledit-repo",
    name: "MDLEdit",
    kind: "github",
    homeUrl: "https://github.com/bead-v/mdledit",
    description: "KOTOR model editor and conversion tooling used alongside MDLOps workflows.",
    freshnessPolicy: "weekly source sync",
    approvalScope: "public source code",
    tags: ["models", "assets", "conversion", "tooling"],
  },
  {
    id: "tga2tpc-repo",
    name: "TGA2TPC",
    kind: "github",
    homeUrl: "https://github.com/ndixUR/tga2tpc",
    description: "Texture conversion utility for KOTOR TGA/TPC asset pipelines.",
    freshnessPolicy: "weekly source sync",
    approvalScope: "public source code",
    tags: ["textures", "tpc", "assets", "conversion"],
  },
  {
    id: "wikipedia-kotor",
    name: "Wikipedia — Star Wars KOTOR",
    kind: "website",
    homeUrl: "https://en.wikipedia.org/wiki/Star_Wars:_Knights_of_the_Old_Republic",
    description: "Wikipedia coverage of the KOTOR game series, characters, storylines, and development history — openly scrapable lore reference.",
    freshnessPolicy: "on-demand scrape for cited articles; weekly refresh of KOTOR-era pages",
    approvalScope: "public encyclopedia articles",
    tags: ["lore", "characters", "story", "wiki", "history"],
    intentBias: "lore",
  },
  {
    id: "strategywiki-kotor",
    name: "StrategyWiki KOTOR",
    kind: "website",
    homeUrl: "https://strategywiki.org/wiki/Star_Wars:_Knights_of_the_Old_Republic",
    description: "Community-authored KOTOR walkthrough, gameplay strategy, builds, and secrets guides for KotOR I and II.",
    freshnessPolicy: "weekly crawl for walkthrough and strategy pages",
    approvalScope: "public wiki articles",
    tags: ["walkthrough", "gameplay", "strategy", "guides", "companions", "quests"],
    intentBias: "lore",
  },
  {
    id: "approved-discord-knowledge",
    name: "Approved Discord Knowledge",
    kind: "discord",
    homeUrl: "discord://approved-channels",
    description: "Opt-in channel archive for project discussion, troubleshooting, and staff-approved historical answers.",
    freshnessPolicy: "live incremental indexing plus backfill per approved channel",
    approvalScope: "approved guild channels only",
    tags: ["discord", "history", "qa", "community"],
  },
];

export const traskApprovedResearchSources: readonly SourceDescriptor[] = defaultSourceCatalog.filter(
  (source) => source.kind !== "discord",
);

export const traskApprovedResearchSourceUrls: readonly string[] = traskApprovedResearchSources.map(
  (source) => source.homeUrl,
);

export const traskApprovedResearchBaseHosts: readonly string[] = [
  "lucasforumsarchive.org",
  "deadlystream.com",
  "github.com",
  "kotor.neocities.org",
  "steamcommunity.com",
  // pcgamingwiki.com excluded: Cloudflare-protected, returns JS challenge on automated requests.
  "en.wikipedia.org",
  "strategywiki.org",
];

export const traskApprovedResearchUrlPrefixes: readonly string[] = traskApprovedResearchSources.map(
  (source) => source.homeUrl,
);

export const sourceUrlMatchesDescriptor = (url: string, source: SourceDescriptor): boolean => {
  try {
    const candidate = new URL(url);
    const home = new URL(source.homeUrl);
    if (!hostMatchesBase(candidate.hostname, home.hostname) || !hostMatchesBase(home.hostname, candidate.hostname)) {
      return false;
    }
    const candidatePath = candidate.pathname.replace(/\/+$/, "");
    const homePath = home.pathname.replace(/\/+$/, "");
    return homePath === "" || candidatePath === homePath || candidatePath.startsWith(`${homePath}/`);
  } catch {
    // Fall back to simple string matching for nonstandard URLs.
  }
  return urlStartsWithPrefix(url, source.homeUrl);
};

export const isTraskApprovedBaseUrl = (url: string): boolean => {
  try {
    const { hostname } = new URL(url);
    return traskApprovedResearchBaseHosts.some((baseHost) => hostMatchesBase(hostname, baseHost));
  } catch {
    return false;
  }
};

export const isTraskApprovedResearchUrl = (
  url: string,
  sources: readonly SourceDescriptor[] = traskApprovedResearchSources,
): boolean => {
  if (!isTraskApprovedBaseUrl(url)) return false;
  return sources.some((source) => sourceUrlMatchesDescriptor(url, source));
};

export class StaticCatalogSearchProvider implements SearchProvider {
  public constructor(
    private readonly sources: readonly SourceDescriptor[] = defaultSourceCatalog,
    private readonly reindexQueue: FileReindexQueueStore,
  ) {}

  public async listSources(): Promise<readonly SourceDescriptor[]> {
    return this.sources;
  }

  public async search(query: string, limit = 5): Promise<readonly SearchHit[]> {
    const tokens = tokenize(query);
    const intent = classifyQueryIntent(query);

    if (tokens.length === 0) {
      return [];
    }

    const hits = this.sources
      .map((source) => {
        const titleTokens = tokenize(source.name);
        const descriptionTokens = tokenize(source.description);
        const tagTokens = source.tags.flatMap((tag) => tokenize(tag));

        let score = 0;

        for (const token of tokens) {
          if (titleTokens.includes(token)) {
            score += 5;
          }

          if (descriptionTokens.includes(token)) {
            score += 2;
          }

          if (tagTokens.includes(token)) {
            score += 3;
          }

          if (source.homeUrl.toLowerCase().includes(token)) {
            score += 1;
          }
        }

        score += intentScoreDelta(intent, source.tags);

        const hit: SearchHit = {
          sourceId: source.id,
          sourceName: source.name,
          kind: source.kind,
          title: `${source.name} (${source.kind})`,
          snippet: source.description,
          url: source.homeUrl,
          score,
          tags: source.tags,
        };

        return hit;
      })
      .filter((hit) => hit.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    return hits;
  }

  public async queueReindex(sourceIds?: readonly string[]): Promise<{ queuedSourceIds: readonly string[]; mode: "file-queue" }> {
    const knownSourceIds = new Set(this.sources.map((source) => source.id));
    const requestedIds = sourceIds?.length
      ? sourceIds
      : this.sources.map((source) => source.id);
    const queuedSourceIds = [...new Set(requestedIds)].filter((sourceId) => knownSourceIds.has(sourceId));

    const persistedQueueIds = await this.reindexQueue.enqueue(queuedSourceIds);
    return {
      queuedSourceIds: persistedQueueIds,
      mode: "file-queue",
    };
  }
}

export const createDefaultSearchProvider = (options?: {
  stateDir?: string;
  sources?: readonly SourceDescriptor[];
}): SearchProvider => {
  const sources = options?.sources ?? defaultSourceCatalog;
  const reindexQueue = new FileReindexQueueStore(options?.stateDir ?? "data/ingest-worker");
  return new StaticCatalogSearchProvider(sources, reindexQueue);
};

// ---------------------------------------------------------------------------
// Chunk-based search — persisted text chunks from indexed sources
// ---------------------------------------------------------------------------

export interface ChunkRecord {
  id: string;
  sourceId: string;
  sourceName: string;
  kind: SourceKind;
  url: string;
  title: string;
  chunkText: string;
  fetchedAt: number;
  chunkIndex: number;
  tags: readonly string[];
}

export interface SourceIndexRecord {
  sourceId: string;
  sourceName: string;
  kind: SourceKind;
  url: string;
  chunkCount: number;
  lastFetchedAt: number;
  tags: readonly string[];
}

const isNonWebChunkUrl = (url: string): boolean =>
  url.startsWith("local://") || url.startsWith("discord://");

type SerializableValue = object | string | number | boolean | null;

export class FileChunkStore {
  public constructor(private readonly stateDir: string) {}

  private chunksDir(): string {
    return path.join(this.stateDir, "chunks");
  }

  private sourceDir(sourceId: string): string {
    return path.join(this.chunksDir(), sourceId);
  }

  private sourceIndexPath(sourceId: string): string {
    return path.join(this.sourceDir(sourceId), "_index.json");
  }

  private async writeJsonAtomic(filePath: string, payload: SerializableValue): Promise<void> {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
    await rename(tempPath, filePath);
  }

  private async quarantineCorruptFile(filePath: string): Promise<void> {
    const quarantinePath = `${filePath}.corrupt.${Date.now()}`;
    await rename(filePath, quarantinePath);
  }

  public async saveChunk(chunk: ChunkRecord): Promise<void> {
    await mkdir(this.sourceDir(chunk.sourceId), { recursive: true });
    const filePath = path.join(this.sourceDir(chunk.sourceId), `${chunk.id}.json`);
    await this.writeJsonAtomic(filePath, chunk);
  }

  /** Persist a source-level index manifest after all chunks for that source are written. */
  public async saveSourceIndex(record: SourceIndexRecord): Promise<void> {
    await mkdir(this.sourceDir(record.sourceId), { recursive: true });
    await this.writeJsonAtomic(this.sourceIndexPath(record.sourceId), record);
  }

  /** Load the index manifest for a single source, or undefined if not present. */
  public async loadSourceIndex(sourceId: string): Promise<SourceIndexRecord | undefined> {
    const indexPath = this.sourceIndexPath(sourceId);
    let raw: string;

    try {
      raw = await readFile(indexPath, "utf8");
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: string }).code
        : undefined;
      if (code === "ENOENT") {
        return undefined;
      }
      throw error;
    }

    try {
      return JSON.parse(raw) as SourceIndexRecord;
    } catch {
      await this.quarantineCorruptFile(indexPath).catch(() => {
        // Ignore quarantine failures; best effort only.
      });
      return undefined;
    }
  }

  /** Load all source index manifests that exist on disk. */
  public async loadAllSourceIndexes(): Promise<SourceIndexRecord[]> {
    const results: SourceIndexRecord[] = [];

    let sourceDirs: string[];
    try {
      sourceDirs = await readdir(this.chunksDir());
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: string }).code
        : undefined;
      if (code === "ENOENT") {
        return [];
      }
      throw error;
    }

    for (const sourceId of sourceDirs) {
      const record = await this.loadSourceIndex(sourceId);
      if (record) results.push(record);
    }

    return results;
  }

  public async loadAllChunks(): Promise<ChunkRecord[]> {
    const results: ChunkRecord[] = [];

    let sourceDirs: string[];
    try {
      sourceDirs = await readdir(this.chunksDir());
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: string }).code
        : undefined;
      if (code === "ENOENT") {
        return [];
      }
      throw error;
    }

    for (const sourceId of sourceDirs) {
      results.push(...(await this.loadChunksForSource(sourceId)));
    }

    return results;
  }

  public async loadChunksForSource(sourceId: string): Promise<ChunkRecord[]> {
    const dir = this.sourceDir(sourceId);
    const results: ChunkRecord[] = [];

    let files: string[];
    try {
      files = await readdir(dir);
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: string }).code
        : undefined;
      if (code === "ENOENT") {
        return [];
      }
      throw error;
    }

    for (const file of files.filter((f) => f.endsWith(".json") && !f.startsWith("_"))) {
      const filePath = path.join(dir, file);
      try {
        const raw = await readFile(filePath, "utf8");
        results.push(JSON.parse(raw) as ChunkRecord);
      } catch {
        await this.quarantineCorruptFile(filePath).catch(() => {
          // Ignore quarantine failures; best effort only.
        });
      }
    }

    return results;
  }

  public async listIndexedSourceIds(): Promise<string[]> {
    try {
      return await readdir(this.chunksDir());
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: string }).code
        : undefined;
      if (code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }
}

export class ChunkSearchProvider implements SearchProvider {
  public constructor(
    private readonly chunkStore: FileChunkStore,
    private readonly catalog: StaticCatalogSearchProvider,
  ) {}

  public async listSources(): Promise<readonly SourceDescriptor[]> {
    return this.catalog.listSources();
  }

  public async search(query: string, limit = 5): Promise<readonly SearchHit[]> {
    const tokens = tokenize(query);
    const intent = classifyQueryIntent(query);
    if (tokens.length === 0) return [];

    const [catalogHits, allChunks] = await Promise.all([
      this.catalog.search(query, limit),
      this.chunkStore.loadAllChunks(),
    ]);
    const searchableChunks = allChunks.filter((chunk) => !isNonWebChunkUrl(chunk.url));

    const chunkHits: SearchHit[] = searchableChunks
      .map((chunk) => {
        const textTokens = tokenize(chunk.chunkText);
        const titleTokens = tokenize(chunk.title);
        const tagTokens = chunk.tags.flatMap((t) => tokenize(t));
        let score = 0;

        for (const token of tokens) {
          score += titleTokens.filter((t) => t === token).length * 5;
          score += tagTokens.filter((t) => t === token).length * 3;
          score += textTokens.filter((t) => t === token).length;
        }
        score += intentScoreDelta(intent, chunk.tags);

        return {
          sourceId: chunk.sourceId,
          sourceName: chunk.sourceName,
          kind: chunk.kind,
          title: chunk.title,
          snippet: chunk.chunkText.slice(0, 800).trim() + (chunk.chunkText.length > 800 ? "\u2026" : ""),
          url: chunk.url,
          score,
          tags: chunk.tags,
        } satisfies SearchHit;
      })
      .filter((h) => h.score > 0);

    // Merge chunk hits (more specific) before catalog hits, dedup by url.
    const seen = new Set<string>();
    const merged: SearchHit[] = [];

    for (const hit of [...chunkHits, ...catalogHits].sort((a, b) => b.score - a.score)) {
      if (!seen.has(hit.url)) {
        seen.add(hit.url);
        merged.push(hit);
      }
      if (merged.length >= limit) break;
    }

    return merged;
  }

  public async queueReindex(sourceIds?: readonly string[]): Promise<{ queuedSourceIds: readonly string[]; mode: "file-queue" }> {
    return this.catalog.queueReindex(sourceIds);
  }
}

export const createChunkSearchProvider = (stateDir: string): ChunkSearchProvider => {
  return new ChunkSearchProvider(
    new FileChunkStore(stateDir),
    new StaticCatalogSearchProvider(defaultSourceCatalog, new FileReindexQueueStore(stateDir)),
  );
};