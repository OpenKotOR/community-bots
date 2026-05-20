/**
 * Shared citation URL reachability checks for verify scripts and e2e helpers.
 * Never treats HTTP 404 as reachable.
 */

const DEFAULT_TIMEOUT_MS = 8_000;

export const citationUrlVerifyEnabled = () => {
  const raw = (process.env.TRASK_SKIP_CITATION_URL_VERIFY ?? "").trim().toLowerCase();
  return raw !== "1" && raw !== "true" && raw !== "yes" && raw !== "on";
};

const timeoutMs = () => {
  const parsed = Number.parseInt(process.env.TRASK_CITATION_URL_VERIFY_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
};

export const isDiscordJumpUrl = (url) => /^https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+/i.test(url);

export const isSkippableCitationUrl = (url) => {
  const trimmed = url.trim();
  return trimmed.startsWith("discord://") || isDiscordJumpUrl(trimmed) || !trimmed.startsWith("http");
};

export const isHttpsCitationReachable = async (url) => {
  if (isSkippableCitationUrl(url)) return true;
  if (!citationUrlVerifyEnabled()) return true;

  for (const method of ["HEAD", "GET"]) {
    try {
      const res = await fetch(url, {
        method,
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs()),
      });
      if (res.ok) return true;
    } catch {
      // try next method
    }
  }
  return false;
};

export const assertAllUrlsReachable = async (urls, label = "citation") => {
  const unreachable = [];
  for (const url of urls) {
    const ok = await isHttpsCitationReachable(url);
    if (!ok) unreachable.push(url);
  }
  if (unreachable.length > 0) {
    throw new Error(`${label} URL(s) not reachable (404 or network error): ${unreachable.join(", ")}`);
  }
};
