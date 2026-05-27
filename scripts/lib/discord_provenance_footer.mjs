/**
 * Shared Discord /ask provenance footer checks for verify + trask:gate smoke.
 */
import { formatDiscordProvenanceFooter } from "@openkotor/trask";

const PROVENANCE_FOOTER_RE = /^\d+ passages? · indexer /u;

export const defaultIndexerUrlForSmoke = () =>
  process.env.TRASK_INDEXER_BASE_URL?.trim() || "http://127.0.0.1:8787";

/** @returns {{ footer: string } | string} error message when invalid */
export const assertProvenanceFooter = (provenance) => {
  if (!provenance || typeof provenance !== "object") {
    return "missing provenance on brief answer";
  }
  const passagesCount = Number(provenance.passagesCount);
  const indexerUrl = String(provenance.indexerUrl ?? "").trim();
  if (!Number.isFinite(passagesCount) || passagesCount < 1) {
    return `provenance.passagesCount must be ≥1 (got ${provenance.passagesCount})`;
  }
  if (!indexerUrl.startsWith("http")) {
    return `provenance.indexerUrl must be http(s) (got ${indexerUrl || "(empty)"})`;
  }
  const footer = formatDiscordProvenanceFooter({ passagesCount, indexerUrl });
  if (!PROVENANCE_FOOTER_RE.test(footer)) {
    return `invalid provenance footer: ${footer}`;
  }
  return { footer };
};
