# Discord multi-source citations + research logging

Generated: 2026-05-19

## Plan

`docs/plans/2026-05-19-004-fix-trask-discord-multi-source-rag-logging-plan.md`

## Code changes (summary)

- Discord brief compose selects **two** distinct public citation URLs (`BRIEF_MAX_CLAIM_LINES = 2`).
- `discord://` passages resolve to `https://discord.com/channels/{guild}/{channel}/{message}` when indexer metadata is present.
- `scripts/trask_web_research.py` uses structured `logging`, URL verification, and passes `guildId` / `channelId` / `firstMessageId` on passages.
- Node subprocess forwards stderr via `setTraskResearchLogSink`; `trask-bot` logs `research_start` / `research_done` per `/ask`.
- `scripts/verify_trask_discord_live.mjs` always requires ≥2 inline links; optional HEAD checks (skip with `--skip-url-check`).

## Unit tests

```bash
pnpm --filter @openkotor/trask build
pnpm exec node --test packages/trask/dist/grounded-evidence.test.js packages/trask/dist/discord-citation-url.test.js packages/trask/dist/discord-reply-format.test.js
```

## Live gate

```bash
pnpm verify:trask-discord
# offline / air-gapped only:
pnpm build && node --import tsx/esm scripts/verify_trask_discord_live.mjs --skip-url-check
```

## Sample research log (INFO)

When `TRASK_RESEARCH_LOG_LEVEL=INFO`, stderr includes phase lines such as:

```
research_start query='What is TSLPatcher...' domains=... limit=12 indexer=http://127.0.0.1:8790
retrieve_http passages=8 elapsed_ms=42
url_verify summary kept=6 rejected=2
research_done passages=6 urls=6 index_miss=False rejected=2
```

Set `TRASK_RESEARCH_LOG_LEVEL=DEBUG` (or pass `-v` to the Python script) for per-passage detail.
