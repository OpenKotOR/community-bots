/**
 * Build CLI-shaped research answers from golden-queries.json fixtures (primary + companion).
 */
import { getGoldenQuery } from "@openkotor/trask-config";

const HOST_LABELS = {
  "github.com": "github.com",
  "deadlystream.com": "Deadly Stream",
};

/** @param {string} host */
const sourceLabel = (host) => HOST_LABELS[host] ?? host;

/** @param {string} markdown */
const markdownTitle = (markdown) => {
  const match = markdown.match(/^#\s*(.+)/);
  return match ? match[1].trim() : "Source";
};

/** @param {string} markdown */
const firstParagraph = (markdown) =>
  markdown
    .replace(/^#[^\n]+\n+/i, "")
    .trim()
    .split(/\n\n/)[0]
    .replace(/\s+/g, " ")
    .trim();

/**
 * @param {string} goldenId
 * @param {{ question?: string }} [options]
 */
export function composeGoldenCliAnswer(goldenId, options = {}) {
  const entry = getGoldenQuery(goldenId);
  if (!entry?.fixture || !entry.companionFixture) {
    throw new Error(`composeGoldenCliAnswer: golden query "${goldenId}" missing fixture pair`);
  }

  const companion = entry.companionFixture;
  const primary = entry.fixture;
  const companionTitle = markdownTitle(companion.markdown);
  const line1 = `${companionTitle} ${firstParagraph(companion.markdown)} [1]`;
  const line2 = `${firstParagraph(primary.markdown)} [2]`;
  const answer = `${line1}\n${line2}\n\nSources\n1. ${sourceLabel(companion.host)} - ${companion.url}\n2. ${sourceLabel(primary.host)} - ${primary.url}`;

  return {
    question: options.question ?? entry.question,
    answer,
    approvedSources: [
      { name: sourceLabel(companion.host), homeUrl: companion.url },
      { name: sourceLabel(primary.host), homeUrl: primary.url },
    ],
  };
}

export const GOLDEN_IMPORT_SMOKE_IDS = ["tslpatcher", "mdlops"];

/** Discord CI import-smoke: expert verification wording + golden fixture bodies. */
export const DISCORD_IMPORT_SMOKE_SPECS = [
  { verificationId: "expert-tslpatcher-2da", goldenId: "tslpatcher", expectPattern: "TSLPatcher|2DA|TLK" },
  { verificationId: "expert-mdlops-blender", goldenId: "mdlops", expectPattern: "MDLOps|MDL" },
];
