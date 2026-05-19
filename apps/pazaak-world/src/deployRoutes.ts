/** Strip trailing slash from Vite base URL (e.g. `/community-bots/` → `/community-bots`). */
export function viteBasePath(): string {
  return (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
}

export const GITHUB_PAGES_ORIGIN = "https://openkotor.github.io";
/** Legacy fallback root when build-time BASE is unavailable. */
export const GITHUB_PAGES_SITE_ROOT = `${GITHUB_PAGES_ORIGIN}/community-bots`;

function resolvePagesSiteRootFromBasePath(): string {
  const b = viteBasePath();
  if (b && b !== "/") {
    return `${GITHUB_PAGES_ORIGIN}${b}`;
  }
  if (typeof window !== "undefined") {
    // Support root-mounted deployments where BASE_URL is '/'.
    return window.location.origin;
  }
  return GITHUB_PAGES_SITE_ROOT;
}

/** Operator dashboard lives at the SPA deploy root. */
export function operatorConsoleRoute(): string {
  const b = viteBasePath();
  return b || "/";
}

/** Discord invite hub (lightweight). */
export function discordHubRoute(): string {
  const b = viteBasePath();
  return b ? `${b}/discord` : "/discord";
}

/** PazaakWorld / Activity browser route. */
export function pazaakWorldRoute(): string {
  const b = viteBasePath();
  return b ? `${b}/pazaakworld` : "/pazaakworld";
}

/** Holocron / Trask QA SPA (nested static export). */
export function qaWebUiRoute(): string {
  const b = viteBasePath();
  return b ? `${b}/qa-webui/` : "/qa-webui/";
}

export function pazaakWorldPublicUrl(): string {
  if (import.meta.env.PROD) {
    return `${resolvePagesSiteRootFromBasePath()}/pazaakworld`;
  }
  if (typeof window !== "undefined") {
    return `${window.location.origin}${pazaakWorldRoute()}`;
  }
  return `${GITHUB_PAGES_SITE_ROOT}/pazaakworld`;
}

export function qaWebUiPublicUrl(): string {
  if (import.meta.env.PROD) {
    return `${resolvePagesSiteRootFromBasePath()}/qa-webui/`;
  }
  if (typeof window !== "undefined") {
    return `${window.location.origin}${qaWebUiRoute()}`;
  }
  return `${GITHUB_PAGES_SITE_ROOT}/qa-webui/`;
}
