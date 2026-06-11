/**
 * Shared Discord /ask embed description contract checks (verify script + Playwright harness).
 */
import { DISCORD_ASK_MAX_BODY_LINES, formatDiscordAskDisplay } from "@openkotor/trask";
import { degradedAnswerRegexes } from "@openkotor/trask-config";

export const MIN_INLINE_DISCORD_LINKS = 2;

const DEGRADED_RE = degradedAnswerRegexes()[0] ?? /could not complete live/i;

/** @param {string} display */
export const extractInlineHttpsUrls = (display) =>
  [...display.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map((m) => m[1]);

/**
 * @param {string} question
 * @param {string} answer
 * @param {Array<{ name?: string; homeUrl?: string; url?: string }>} approvedSources
 */
export function buildDiscordAskDisplay(question, answer, approvedSources) {
  return formatDiscordAskDisplay(answer, approvedSources, { query: question });
}

/**
 * @returns {{ display: string; lines: number; linked: number; urls: string[] } | string}
 */
export function auditDiscordAskDisplay(question, answer, approvedSources) {
  const display = buildDiscordAskDisplay(question, answer, approvedSources);
  const lines = display.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (DEGRADED_RE.test(display)) {
    return "degraded synthesis message";
  }
  if (/\nSources\s*\n/i.test(display) || /^\s*Sources\b/im.test(display)) {
    return "visible Sources block in embed description";
  }
  if (lines.length > DISCORD_ASK_MAX_BODY_LINES) {
    return `${lines.length} lines (max ${DISCORD_ASK_MAX_BODY_LINES})`;
  }
  if (/^Answer for:/im.test(display) || /\bAnswer for:/i.test(display)) {
    return "contains Answer for: prefix";
  }
  if (/^\s*-\s*#\s+/m.test(display) || /^\s*#\s+\w/m.test(display)) {
    return "contains markdown # topic headings";
  }
  if (/githubusercontent\.com/i.test(display)) {
    return "raw githubusercontent path in embed description";
  }
  const linked = [...display.matchAll(/\]\(https:\/\/[^)]+\)/g)];
  if (linked.length < MIN_INLINE_DISCORD_LINKS) {
    return `only ${linked.length} inline https link(s); need ≥${MIN_INLINE_DISCORD_LINKS}`;
  }
  if (approvedSources.length < MIN_INLINE_DISCORD_LINKS) {
    return `only ${approvedSources.length} approved source(s); need ≥${MIN_INLINE_DISCORD_LINKS}`;
  }
  return {
    display,
    lines: lines.length,
    linked: linked.length,
    urls: extractInlineHttpsUrls(display),
  };
}
