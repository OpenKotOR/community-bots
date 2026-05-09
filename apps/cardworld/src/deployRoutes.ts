/** Strip trailing slash from Vite base URL (e.g. `/community-bots/` → `/community-bots`). */
export function viteBasePath(): string {
  return (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
}

/** Canonical GitHub Pages root for this repository (project site). */
export const GITHUB_PAGES_SITE_ROOT = "https://openkotor.github.io/community-bots";

/** Operator dashboard lives at the SPA deploy root. */
export function operatorConsoleRoute(): string {
  const b = viteBasePath();
  return b || "/";
}

/** Discord invite hub (lightweight). */
export function discordHubRoute(): string {
  const b = viteBasePath();
  return b ? `${b}/discord` : "/bots";
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
  const b = viteBasePath();
  if (import.meta.env.PROD && b) {
    return `${GITHUB_PAGES_SITE_ROOT}/pazaakworld`;
  }
  if (typeof window !== "undefined") {
    return `${window.location.origin}${pazaakWorldRoute()}`;
  }
  return `${GITHUB_PAGES_SITE_ROOT}/pazaakworld`;
}

export function qaWebUiPublicUrl(): string {
  const b = viteBasePath();
  if (import.meta.env.PROD && b) {
    return `${GITHUB_PAGES_SITE_ROOT}/qa-webui/`;
  }
  if (typeof window !== "undefined") {
    return `${window.location.origin}${qaWebUiRoute()}`;
  }
  return `${GITHUB_PAGES_SITE_ROOT}/qa-webui/`;
}
