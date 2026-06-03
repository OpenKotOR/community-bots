/** Surface-neutral parsing for Trask answers: body text + Sources block. */

const collapseExcessiveNewlines = (value: string): string => {
  const lines = value.split("\n");
  const out: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    if (line.trim() === "") {
      blankRun += 1;
      if (blankRun <= 1) out.push("");
      continue;
    }
    blankRun = 0;
    out.push(line);
  }
  return out.join("\n").trim();
};

const normalizeWhitespace = (value: string): string => collapseExcessiveNewlines(value);

const isSourcesHeadingLine = (line: string): boolean => {
  let trimmed = line.trim();
  if (trimmed.startsWith("#")) {
    while (trimmed.startsWith("#")) trimmed = trimmed.slice(1);
    trimmed = trimmed.trimStart();
  }
  const lower = trimmed.toLowerCase();
  return lower === "sources" || lower === "references";
};

const findSourcesSectionIndex = (value: string): number | null => {
  const normalized = value.replace(/\r\n/g, "\n");
  let offset = 0;
  for (const line of normalized.split("\n")) {
    if (isSourcesHeadingLine(line)) {
      return offset;
    }
    offset += line.length + 1;
  }
  return null;
};

export type ResearchAnswerSource = {
  name?: string;
  homeUrl: string;
};

export const splitResearchAnswer = (value: string): { body: string; sourceLines: string[] } => {
  const sourcesAt = findSourcesSectionIndex(value);

  if (sourcesAt === null) {
    return {
      body: normalizeWhitespace(value),
      sourceLines: [],
    };
  }

  const normalized = value.replace(/\r\n/g, "\n");
  const headingLine = normalized.slice(sourcesAt).split("\n")[0] ?? "";
  const sectionStart = sourcesAt + headingLine.length + 1;

  const body = normalizeWhitespace(normalized.slice(0, sourcesAt));
  const sourceLines = normalized
    .slice(sectionStart)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return { body, sourceLines };
};

/** Numbered `Sources` lines → citation index to deep URL (when present). */
export const extractNumberedSourceUrls = (sourceLines: readonly string[]): Map<number, string> => {
  const map = new Map<number, string>();
  for (const line of sourceLines) {
    const numMatch = line.match(/^\s*(\d+)\./u);
    if (!numMatch) continue;
    const httpIndex = line.indexOf("http");
    if (httpIndex < 0) continue;
    const url = line.slice(httpIndex).trim().replace(/[.,;:!?)]+$/u, "");
    map.set(Number(numMatch[1]), url);
  }
  return map;
};

/** Rewrite the Sources block so numbered lines match approved source order (deep URLs). */
export const syncSourcesSectionToApproved = (
  rawAnswer: string,
  approvedSources: readonly ResearchAnswerSource[],
): string => {
  const { body, sourceLines } = splitResearchAnswer(rawAnswer);
  if (approvedSources.length === 0) {
    return body;
  }

  const existingUrls = extractNumberedSourceUrls(sourceLines);
  const preferExistingCitationUrl = (citationIndex: number, approvedUrl: string): string => {
    const existing = existingUrls.get(citationIndex);
    if (!existing) return approvedUrl;
    try {
      const existingParsed = new URL(existing);
      const approvedParsed = new URL(approvedUrl);
      const sameHost =
        existingParsed.hostname.replace(/^www\./iu, "")
        === approvedParsed.hostname.replace(/^www\./iu, "");
      const existingPath = existingParsed.pathname.replace(/\/+$/u, "");
      const approvedPath = approvedParsed.pathname.replace(/\/+$/u, "");
      if (sameHost && existingPath.length > approvedPath.length) {
        return existing;
      }
    } catch {
      /* use approved */
    }
    return approvedUrl;
  };

  const lines = approvedSources.map((source, index) => {
    const citationIndex = index + 1;
    const label = source.name?.trim() || source.homeUrl;
    const url = preferExistingCitationUrl(citationIndex, source.homeUrl);
    return `${citationIndex}. ${label} - ${url}`;
  });

  return `${body}\n\nSources\n${lines.join("\n")}`;
};
