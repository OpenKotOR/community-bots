# Holocron browser + Worker stack verification (expert queries)

Generated: 2026-05-19

## Stack

- Chroma QA seed: `bash scripts/trask_index_seed_for_qa.sh` (fixture URLs are live Deadly Stream / GitHub / Steam pages, not synthetic 404 paths)
- Retrieve path: Crawl4AI indexer `:8790` → `trask-retrieve-worker` `:8787` → `TRASK_INDEXER_BASE_URL`
- Holocron: `http://127.0.0.1:4010` with `TRASK_RESEARCH_COMPOSE_MODE=grounded`
- Citation policy: every `https://` citation is HEAD/GET verified (404s dropped) in Python + Node + e2e/browser gates

## Verification query set

Browser, Playwright, and Discord gates use `data/trask/eval/verification-queries.json` (expert phrasing). Golden literal questions remain indexer/CLI/faithfulness fixtures only.

## Browser MCP (Cursor) — expert queries

| # | Query | Result | Notes |
|---|--------|--------|-------|
| 1 | TSLPatcher 2DA/TLK automation | PASS | grounded, 2 citations, grammatical summary |
| 2 | MDLOps Blender → game-ready | PASS | grounded, 2 citations |
| 3 | Widescreen HUD / ini | PASS | grounded, 2 citations |
| 4 | KOTOR saves backup path | PARTIAL | 1 cited source in UI (`status partial`); second Steam companion URL needs `steamcommunity.com` allowlist (added in retrieval hosts) |
| 5 | reone runtime/scripting | PASS | grounded, 2 citations |

## Automated gates

| Gate | Result |
|------|--------|
| `pnpm holocron:e2e` (expert queries + URL reachability) | 6/6 pass |
| `pnpm verify:trask-discord` (expert, URL check) | 5/5 pass |

## Operator notes

After reseeding Chroma, restart indexer + Worker (`bash scripts/trask_live_stack.sh`) so `:8787/retrieve` serves new fixture URLs.
