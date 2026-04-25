/**
 * File-backed match snapshot persistence.
 * Each active match is stored as {dataDir}/matches/{matchId}.json.
 * Implements the MatchPersistence interface from pazaak.ts so the
 * coordinator can call it without a circular import.
 */

import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";

import type { MatchPersistence, MatchPlayerState, PazaakMatch, SerializedMatch } from "@openkotor/pazaak-engine";
import { serializeMatch, deserializeMatch } from "@openkotor/pazaak-engine";

// ---------------------------------------------------------------------------
// MatchStore
// ---------------------------------------------------------------------------

export class MatchStore implements MatchPersistence {
  public constructor(private readonly dataDir: string) {}

  private matchesDir(): string {
    return path.join(this.dataDir, "matches");
  }

  public async save(match: PazaakMatch): Promise<void> {
    await mkdir(this.matchesDir(), { recursive: true });
    const filePath = path.join(this.matchesDir(), `${match.id}.json`);
    await writeFile(filePath, JSON.stringify(serializeMatch(match), null, 2), "utf8");
  }

  public async loadActive(maxAgeMs: number): Promise<PazaakMatch[]> {
    const dir = this.matchesDir();
    const cutoff = Date.now() - maxAgeMs;
    const results: PazaakMatch[] = [];

    let files: string[];

    try {
      files = await readdir(dir);
    } catch {
      return [];
    }

    for (const file of files.filter((f) => f.endsWith(".json"))) {
      try {
        const raw = await readFile(path.join(dir, file), "utf8");
        const data = JSON.parse(raw) as SerializedMatch;

        // Skip completed or expired matches (they shouldn't be resumed).
        if (data.phase === "completed") continue;
        if (data.createdAt < cutoff) continue;

        results.push(deserializeMatch(data));
      } catch {
        // Skip malformed or partially-written files.
      }
    }

    return results;
  }

  /** Remove stale/completed match files from disk. */
  public async prune(): Promise<number> {
    const dir = this.matchesDir();
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let removed = 0;

    let files: string[];

    try {
      files = await readdir(dir);
    } catch {
      return 0;
    }

    for (const file of files.filter((f) => f.endsWith(".json"))) {
      try {
        const raw = await readFile(path.join(dir, file), "utf8");
        const data = JSON.parse(raw) as SerializedMatch;

        if (data.phase === "completed" || data.createdAt < cutoff) {
          await unlink(path.join(dir, file));
          removed += 1;
        }
      } catch {
        // Ignore
      }
    }

    return removed;
  }
}
