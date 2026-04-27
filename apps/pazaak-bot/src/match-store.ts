/**
 * File-backed match snapshot persistence.
 * Each active match is stored as {dataDir}/matches/{matchId}.json.
 * Implements the MatchPersistence interface from pazaak.ts so the
 * coordinator can call it without a circular import.
 */

import { mkdir, readFile, writeFile, readdir, rename, unlink } from "node:fs/promises";
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

  private async saveAtomicJson(filePath: string, payload: unknown): Promise<void> {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
    await rename(tempPath, filePath);
  }

  private async quarantineCorruptFile(filePath: string): Promise<void> {
    const corruptPath = `${filePath}.corrupt.${Date.now()}`;
    await rename(filePath, corruptPath);
  }

  public async save(match: PazaakMatch): Promise<void> {
    await mkdir(this.matchesDir(), { recursive: true });
    const filePath = path.join(this.matchesDir(), `${match.id}.json`);
    await this.saveAtomicJson(filePath, serializeMatch(match));
  }

  public async loadActive(maxAgeMs: number): Promise<PazaakMatch[]> {
    const dir = this.matchesDir();
    const cutoff = Date.now() - maxAgeMs;
    const results: PazaakMatch[] = [];

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

    for (const file of files.filter((f) => f.endsWith(".json"))) {
      const filePath = path.join(dir, file);
      try {
        const raw = await readFile(filePath, "utf8");
        const data = JSON.parse(raw) as SerializedMatch;

        // Skip completed or expired matches (they shouldn't be resumed).
        if (data.phase === "completed") continue;
        if (data.createdAt < cutoff) continue;

        results.push(deserializeMatch(data));
      } catch {
        // Quarantine malformed or partially-written files to avoid repeated parse failures.
        await this.quarantineCorruptFile(filePath).catch(() => {
          // Ignore quarantine failures; best effort only.
        });
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
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: string }).code
        : undefined;
      if (code === "ENOENT") {
        return 0;
      }
      throw error;
    }

    for (const file of files.filter((f) => f.endsWith(".json"))) {
      const filePath = path.join(dir, file);
      try {
        const raw = await readFile(filePath, "utf8");
        const data = JSON.parse(raw) as SerializedMatch;

        if (data.phase === "completed" || data.createdAt < cutoff) {
          await unlink(filePath);
          removed += 1;
        }
      } catch {
        await this.quarantineCorruptFile(filePath).catch(() => {
          // Ignore quarantine failures; best effort only.
        });
      }
    }

    return removed;
  }
}
