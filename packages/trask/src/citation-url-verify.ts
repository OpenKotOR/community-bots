import { isDiscordJumpUrl } from "./discord-citation-url.js";

const DEFAULT_TIMEOUT_MS = 8_000;

const skipVerify = (): boolean => {
  const raw = (process.env.TRASK_SKIP_CITATION_URL_VERIFY ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
};

const forceUrlVerify = (): boolean => {
  const raw = (process.env.TRASK_FORCE_URL_VERIFY ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
};

const timeoutMs = (): number => {
  const parsed = Number.parseInt(process.env.TRASK_CITATION_URL_VERIFY_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
};

export const citationUrlVerifyEnabled = (): boolean => !skipVerify();

export const isSkippableCitationUrl = (url: string): boolean => {
  const trimmed = url.trim();
  return (
    trimmed.startsWith("discord://")
    || isDiscordJumpUrl(trimmed)
    || !trimmed.startsWith("http")
  );
};

/** Returns true when the URL responds with 2xx/3xx to HEAD or GET (never treat 404 as reachable). */
export const isHttpsCitationReachable = async (url: string): Promise<boolean> => {
  if (isSkippableCitationUrl(url)) return true;
  if (!citationUrlVerifyEnabled()) return true;

  for (const method of ["HEAD", "GET"] as const) {
    try {
      const res = await fetch(url, {
        method,
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs()),
      });
      if (res.ok) return true;
    } catch {
      // try GET after HEAD failure
    }
  }
  return false;
};

export const filterReachableByUrl = async <T extends { url: string; verified?: boolean }>(
  rows: readonly T[],
): Promise<T[]> => {
  if (!citationUrlVerifyEnabled()) return [...rows];
  const kept: T[] = [];
  for (const row of rows) {
    if (row.verified === true && !forceUrlVerify()) {
      kept.push(row);
      continue;
    }
    const url = row.url.trim();
    if (await isHttpsCitationReachable(url)) {
      kept.push(row);
    }
  }
  return kept;
};
