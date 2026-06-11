#!/usr/bin/env node
/**
 * Static harness for Discord /ask Playwright e2e — golden compose, no LLM, no discord.com.
 */
import http from "node:http";

import { loadVerificationQueries } from "@openkotor/trask-config";

import { composeGoldenCliAnswer, DISCORD_IMPORT_SMOKE_SPECS } from "./lib/compose_golden_cli_answer.mjs";
import { buildDiscordAskDisplay } from "./lib/discord_ask_display_audit.mjs";

const PORT = Number(process.env.DISCORD_ASK_E2E_PORT ?? 4012);

const escapeHtml = (value) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const escapeAttr = (value) => escapeHtml(value).replace(/'/g, "&#39;");

function loadHarnessSpecs() {
  const byId = new Map(loadVerificationQueries().map((entry) => [entry.id, entry]));
  return DISCORD_IMPORT_SMOKE_SPECS.map((spec) => {
    const verification = byId.get(spec.verificationId);
    if (!verification) {
      throw new Error(`missing verification query ${spec.verificationId}`);
    }
    const { question, answer, approvedSources } = composeGoldenCliAnswer(spec.goldenId, {
      question: verification.question,
    });
    const display = buildDiscordAskDisplay(question, answer, approvedSources);
    return {
      id: spec.verificationId,
      question,
      display,
      expectPattern: spec.expectPattern,
    };
  });
}

function renderIndex(specs) {
  const articles = specs
    .map(
      (spec) => `
    <article
      data-spec-id="${escapeAttr(spec.id)}"
      data-expect-pattern="${escapeAttr(spec.expectPattern)}"
      aria-label="Discord embed ${escapeAttr(spec.id)}"
    >
      <h2>${escapeHtml(spec.question)}</h2>
      <pre class="embed-description">${escapeHtml(spec.display)}</pre>
    </article>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Trask Discord /ask Playwright harness</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 1.5rem; background: #1e1f22; color: #dbdee1; }
      article { border: 1px solid #3f4147; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; background: #2b2d31; }
      h2 { font-size: 0.95rem; margin: 0 0 0.75rem; color: #f2f3f5; }
      pre.embed-description { white-space: pre-wrap; margin: 0; font: 14px/1.45 ui-monospace, monospace; }
    </style>
  </head>
  <body>
    <h1>Discord /ask import-smoke harness</h1>
    <p>${specs.length} golden embed descriptions (offline).</p>
    ${articles}
  </body>
</html>`;
}

const specs = loadHarnessSpecs();

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, specs: specs.length }));
    return;
  }
  if (req.url === "/" || req.url?.startsWith("/?")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(renderIndex(specs));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Discord ask e2e harness http://127.0.0.1:${PORT} (${specs.length} specs)`);
});
