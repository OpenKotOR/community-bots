# Trask bot production stack (VPS)

Always-on Discord bot with **continuous Discord→Chroma sync** for indexed `/ask` answers.

## Prerequisites

- Node.js ≥24, pnpm 10 (`corepack enable`)
- Python research venv: `bash scripts/bootstrap_trask_indexer.sh` (indexer host) and `.venv-trask-research` or `TRASK_WEB_RESEARCH_PYTHON`
- Running **Trask indexer** (port 8790) and preferably **retrieve Worker** (8787) — see [trask-indexed-stack-runbook.md](../../docs/knowledgebase/50-execution/trask-indexed-stack-runbook.md)

## Quick start

```bash
git clone https://github.com/OpenKotOR/community-bots.git /opt/community-bots
cd /opt/community-bots
cp infra/trask-bot-stack/.env.production.example .env
# Edit .env: TRASK_DISCORD_BOT_TOKEN, guild/channel IDs, TRASK_INDEXER_BASE_URL

pnpm install
pnpm build
bash scripts/trask_bot_start.sh
```

## Discord sync interval

Set in `.env`:

```bash
TRASK_DISCORD_SYNC_INTERVAL_MS=1800000   # 30 min (recommended production default)
```

- `0` — sync disabled (manual: `python scripts/trask_discord_sync.py`)
- `900000` — 15 min (busier communities)
- `3600000` — 60 min (lighter load)

The bot runs **one sync on startup** and then on the interval (`apps/trask-bot/src/discord-index-sync.ts`).

Monitor freshness on the indexer:

```bash
curl -s http://127.0.0.1:8790/health | jq '.discord_sync_stale, .discord_sync_age_hours, .last_discord_sync'
```

Stale threshold: `TRASK_DISCORD_SYNC_STALE_HOURS` (default 48h on indexer).

## systemd (recommended)

```bash
sudo cp infra/trask-bot-stack/trask-bot.service.example /etc/systemd/system/trask-bot.service
# Adjust User= and WorkingDirectory=
sudo systemctl daemon-reload
sudo systemctl enable --now trask-bot
journalctl -u trask-bot -f
```

## Related

- [discord-text-ingestion-runbook.md](../../docs/knowledgebase/50-execution/discord-text-ingestion-runbook.md)
- [trask-configuration-env-map.md](../../docs/knowledgebase/50-execution/trask-configuration-env-map.md)
