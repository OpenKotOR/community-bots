# Trask research troubleshooting

## Empty or missing answers

- [REPO] **“Trask web research returned an empty report.”** — subprocess returned no `report` text. Verify `TRASK_WEB_RESEARCH_PYTHON` / `.venv-trask-research`, indexer reachability (`TRASK_INDEXER_BASE_URL`), and repo-root `.env` keys ([docs/trask.md](../../trask.md)).
- [SYNTH] **Python import errors in logs** — run `bash scripts/bootstrap_trask_research.sh` and ensure `ddgs` or local Chroma data exists under `data/trask-indexer`.

## Timeouts

- [REPO] Default `TRASK_RESEARCH_TIMEOUT_MS` is **900000** (15 minutes). Holocron e2e allows ~200s per query in Playwright; slow retrieval may still pass if the server completes.
- [SYNTH] Start `trask-indexer serve` before heavy Holocron sessions when you want indexed passages instead of DuckDuckGo-only fallback.

## Holocron shows failure banner

- [REPO] Check `trask-http-server` logs for research subprocess stderr.
- [REPO] Confirm `TRASK_WEB_ALLOW_ANONYMOUS=1` for local e2e on port 4010.
