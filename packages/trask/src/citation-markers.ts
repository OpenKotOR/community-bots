/** Non-global: safe for repeated `.test()` in filters. */
export const CITATION_MARKER_RE = /\[\d{1,3}\]/;

/** Global: use only with `matchAll` / `replace` (do not call `.test()` on this instance). */
export const CITATION_INDEX_CAPTURE_RE = /\[(\d{1,3})\]/g;

export const parseCitationIndex = (raw: string): number | null => {
  const index = Number(raw);
  return Number.isFinite(index) && index > 0 ? index : null;
};

/** Fresh global regex for one string (avoids `lastIndex` leaking across line-scoped scans). */
export const citationIndexCaptureRe = (): RegExp =>
  new RegExp(CITATION_INDEX_CAPTURE_RE.source, "g");

export const collectCitationIndicesInText = (text: string): Set<number> => {
  const indices = new Set<number>();
  for (const line of text.split("\n")) {
    for (const match of line.matchAll(citationIndexCaptureRe())) {
      const index = parseCitationIndex(match[1]!);
      if (index !== null) {
        indices.add(index);
      }
    }
  }
  return indices;
};
