/** GitHub blob/wiki permalinks with line anchors for shallow repo-root citations. */

type ClaimLike = {
  url: string;
  citationUrl: string;
  quote: string;
  claim: string;
  sourceIndex: number;
  authority: "web" | "local" | "discord";
};

const GITHUB_HOST = "github.com";

export type GitHubRepoRef = {
  owner: string;
  repo: string;
};

const stripTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
};

export const isGitHubHost = (url: string): boolean => {
  try {
    return new URL(url).hostname.replace(/^www\./iu, "") === GITHUB_HOST;
  } catch {
    return false;
  }
};

/** Repo root like `https://github.com/owner/repo` (no /blob, /tree, /wiki segment). */
export const parseShallowGitHubRepoUrl = (url: string): GitHubRepoRef | null => {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.replace(/^www\./iu, "") !== GITHUB_HOST) return null;
    const segments = parsed.pathname.replace(/^\/+|\/+$/gu, "").split("/").filter(Boolean);
    if (segments.length !== 2) return null;
    const [owner, repoRaw] = segments;
    if (!owner || !repoRaw) return null;
    const repo = repoRaw.replace(/\.git$/iu, "");
    if (!repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
};

export const isShallowGitHubRepoUrl = (url: string): boolean => parseShallowGitHubRepoUrl(url) !== null;

const hasDeepGitHubPath = (url: string): boolean => {
  try {
    const path = new URL(url).pathname;
    return /\/(blob|tree|wiki|commit)\//iu.test(path);
  } catch {
    return false;
  }
};

const normalizeForSearch = (value: string): string =>
  value.replace(/\s+/gu, " ").trim().toLowerCase();

const REPO_FILE_EXTENSION_RE =
  /\.(?:md|markdown|txt|cpp|c|h|hpp|cc|cxx|py|rs|js|ts|tsx|json|yml|yaml|cmake|ini|nss|ncs)$/iu;

const INVALID_REPO_PATH_MARKERS = [
  "githubusercontent",
  "raw.githubusercontent",
  ".com/",
  "://",
] as const;

export const isPlausibleRepoRelativePath = (filePath: string): boolean => {
  const normalized = filePath.replace(/^\/+/u, "").trim();
  if (!normalized || normalized.length > 260) return false;
  const lower = normalized.toLowerCase();
  for (const marker of INVALID_REPO_PATH_MARKERS) {
    if (lower.includes(marker)) return false;
  }
  if (!REPO_FILE_EXTENSION_RE.test(normalized)) return false;
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) return false;
  for (const segment of segments) {
    if (/^www\./iu.test(segment) || segment.includes(".com")) return false;
  }
  return true;
};

const passageTextWithoutHttpUrls = (passageText: string): string =>
  passageText.replace(/https?:\/\/\S+/giu, " ");

export const inferGitHubFilePath = (pageUrl: string, passageText: string): string => {
  if (/\/wiki(\/|$)/iu.test(pageUrl)) {
    try {
      const segments = new URL(pageUrl).pathname.split("/").filter(Boolean);
      const wikiIdx = segments.findIndex((segment) => segment.toLowerCase() === "wiki");
      const page = wikiIdx >= 0 ? segments.slice(wikiIdx + 1).join("/") : "";
      return page ? decodeURIComponent(page) : "Home";
    } catch {
      return "Home";
    }
  }

  const haystack = passageTextWithoutHttpUrls(passageText);
  const explicitPath = haystack.match(
    /\b((?:[\w.-]+\/)+[\w.-]+\.(?:md|markdown|txt|cpp|c|h|hpp|cc|cxx|py|rs|js|ts|tsx|json|yml|yaml|cmake|ini|nss|ncs))\b/iu,
  );
  if (explicitPath?.[1]) {
    const candidate = explicitPath[1].replace(/^\/+/u, "");
    if (isPlausibleRepoRelativePath(candidate)) return candidate;
  }

  if (/\bREADME(?:\.md)?\b/iu.test(haystack) || /^#\s+/m.test(haystack)) {
    return "README.md";
  }

  return "README.md";
};

export const sanitizeGitHubBlobFilePath = (filePath: string): string => {
  const normalized = filePath.replace(/^\/+/u, "").trim();
  if (isPlausibleRepoRelativePath(normalized)) return normalized;
  return "README.md";
};

export const formatGitHubBlobDisplayPath = (filePath: string): string => {
  const safe = sanitizeGitHubBlobFilePath(filePath);
  const segments = safe.split("/").filter(Boolean);
  if (segments.length <= 2) return safe;
  return segments.slice(-2).join("/");
};

export const lineAnchorForQuote = (passageText: string, quote: string): string => {
  const trimmedQuote = quote.trim();
  if (trimmedQuote.length < 8) return "";

  const needles = [
    trimmedQuote.slice(0, Math.min(120, trimmedQuote.length)),
    trimmedQuote.slice(0, Math.min(60, trimmedQuote.length)),
  ].filter((needle, index, list) => needle.length >= 8 && list.indexOf(needle) === index);

  for (const needle of needles) {
    let idx = passageText.indexOf(needle);
    if (idx < 0) {
      const normalizedHaystack = normalizeForSearch(passageText);
      const normalizedNeedle = normalizeForSearch(needle);
      idx = normalizedHaystack.indexOf(normalizedNeedle);
      if (idx >= 0) {
        // Approximate line mapping on normalized text is good enough for anchors.
        const before = normalizedHaystack.slice(0, idx);
        const startLine = before.split("\n").length;
        const endLine = startLine + Math.max(0, normalizedNeedle.split("\n").length - 1);
        return startLine === endLine ? `#L${startLine}` : `#L${startLine}-L${endLine}`;
      }
      continue;
    }

    const startLine = passageText.slice(0, idx).split("\n").length;
    const endLine = passageText.slice(0, idx + needle.length).split("\n").length;
    return startLine === endLine ? `#L${startLine}` : `#L${startLine}-L${endLine}`;
  }

  return "";
};

export const buildGitHubBlobUrl = (
  owner: string,
  repo: string,
  ref: string,
  filePath: string,
  lineAnchor = "",
): string => {
  const path = sanitizeGitHubBlobFilePath(filePath);
  const base = `https://github.com/${owner}/${repo}/blob/${ref}/${path}`;
  return lineAnchor ? `${base}${lineAnchor.startsWith("#") ? lineAnchor : `#${lineAnchor}`}` : base;
};

export const webCitationDisplayLabel = (url: string, fallbackName = ""): string => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./iu, "");
    if (host !== GITHUB_HOST) {
      return fallbackName.trim() || host;
    }

    const path = decodeURIComponent(parsed.pathname);
    const hash = parsed.hash && /^#L\d+/iu.test(parsed.hash) ? parsed.hash : "";

    const blobMatch = path.match(/\/blob\/[^/]+\/(.+)$/iu);
    if (blobMatch?.[1]) {
      const filePath = blobMatch[1].replace(/\/+$/u, "");
      const shortPath = formatGitHubBlobDisplayPath(filePath);
      return `${shortPath}${hash}`;
    }

    const wikiMatch = path.match(/\/wiki\/(.+)$/iu);
    if (wikiMatch?.[1]) {
      const page = wikiMatch[1].replace(/\/+$/u, "");
      return `wiki: ${page.split("/").pop() ?? page}${hash}`;
    }

    const repo = parseShallowGitHubRepoUrl(url);
    if (repo) {
      return `${repo.repo}${hash}`;
    }

    return fallbackName.trim() || host;
  } catch {
    return fallbackName.trim() || url;
  }
};

export const resolveGitHubCitationUrlSync = (
  pageUrl: string,
  passageText: string,
  quote: string,
  defaultRef = "main",
): string => {
  if (!isGitHubHost(pageUrl)) return pageUrl;

  if (hasDeepGitHubPath(pageUrl)) {
    const anchor = lineAnchorForQuote(passageText, quote);
    if (!anchor) return pageUrl;
    const withoutHash = pageUrl.replace(/#.*$/u, "");
    if (pageUrl.includes(anchor)) return pageUrl;
    return `${withoutHash}${anchor}`;
  }

  const repo = parseShallowGitHubRepoUrl(pageUrl);
  if (!repo) return pageUrl;

  if (/\/wiki(\/|$)/iu.test(pageUrl)) {
    const anchor = lineAnchorForQuote(passageText, quote);
    return anchor ? `${stripTrailingSlashes(pageUrl)}${anchor}` : pageUrl;
  }

  const filePath = inferGitHubFilePath(pageUrl, passageText);
  const anchor = lineAnchorForQuote(passageText, quote);
  return buildGitHubBlobUrl(repo.owner, repo.repo, defaultRef, filePath, anchor);
};

type GitHubRefCache = Map<string, string>;

const cacheKey = (owner: string, repo: string, filePath: string): string =>
  `${owner}/${repo}:${filePath}`;

const fetchJson = async (url: string, timeoutMs: number): Promise<unknown | null> => {
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "openkotor-trask-citation",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const resolveLatestCommitSha = async (
  owner: string,
  repo: string,
  filePath: string,
  cache: GitHubRefCache,
  timeoutMs: number,
): Promise<string | null> => {
  const key = cacheKey(owner, repo, filePath);
  const cached = cache.get(key);
  if (cached) return cached;

  const repoMeta = (await fetchJson(`https://api.github.com/repos/${owner}/${repo}`, timeoutMs)) as
    | { default_branch?: string }
    | null;
  const defaultBranch = repoMeta?.default_branch?.trim() || "main";

  const commits = (await fetchJson(
    `https://api.github.com/repos/${owner}/${repo}/commits?path=${encodeURIComponent(filePath)}&per_page=1`,
    timeoutMs,
  )) as Array<{ sha?: string }> | null;

  const sha = commits?.[0]?.sha?.trim();
  const ref = sha || defaultBranch;
  cache.set(key, ref);
  return ref;
};

export const resolveGitHubCitationUrlAsync = async (
  pageUrl: string,
  passageText: string,
  quote: string,
  cache: GitHubRefCache = new Map(),
  timeoutMs = 2500,
): Promise<string> => {
  const syncResolved = resolveGitHubCitationUrlSync(pageUrl, passageText, quote);
  if (!isGitHubHost(pageUrl)) return syncResolved;

  const repo = parseShallowGitHubRepoUrl(pageUrl);
  if (!repo || /\/wiki(\/|$)/iu.test(pageUrl)) {
    return syncResolved;
  }

  const filePath = inferGitHubFilePath(pageUrl, passageText);
  const anchor = lineAnchorForQuote(passageText, quote);
  const ref = await resolveLatestCommitSha(repo.owner, repo.repo, filePath, cache, timeoutMs);
  if (!ref) return syncResolved;
  return buildGitHubBlobUrl(repo.owner, repo.repo, ref, filePath, anchor);
};

export const enhanceWebCitationUrl = (
  url: string,
  passageText: string,
  quote: string,
): string => resolveGitHubCitationUrlSync(url, passageText, quote);

export const enrichClaimsWithGitHubPermalinks = async <T extends ClaimLike>(
  claims: readonly T[],
  timeoutMs = 2500,
): Promise<T[]> => {
  const cache: GitHubRefCache = new Map();
  const out: T[] = [];

  for (const claim of claims) {
    const passageText = claim.quote || claim.claim;
    const baseUrl = claim.url || claim.citationUrl;
    let citationUrl = claim.citationUrl;

    if (isGitHubHost(baseUrl) && (isShallowGitHubRepoUrl(baseUrl) || isShallowGitHubRepoUrl(citationUrl))) {
      citationUrl = await resolveGitHubCitationUrlAsync(baseUrl, passageText, claim.quote, cache, timeoutMs);
    } else if (isGitHubHost(citationUrl)) {
      citationUrl = resolveGitHubCitationUrlSync(citationUrl, passageText, claim.quote);
    }

    out.push({ ...claim, citationUrl });
  }

  return out;
};
