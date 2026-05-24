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

/** Rewrite the Sources block so numbered lines match approved source order (deep URLs). */
export const syncSourcesSectionToApproved = (
  rawAnswer: string,
  approvedSources: readonly ResearchAnswerSource[],
): string => {
  const { body } = splitResearchAnswer(rawAnswer);
  if (approvedSources.length === 0) {
    return body;
  }

  const lines = approvedSources.map((source, index) => {
    const label = source.name?.trim() || source.homeUrl;
    return `${index + 1}. ${label} - ${source.homeUrl}`;
  });

  return `${body}\n\nSources\n${lines.join("\n")}`;
};
