# OpenKOTOR Discord Bots

[![CI](https://github.com/OpenKotOR/community-bots/actions/workflows/ci.yml/badge.svg)](https://github.com/OpenKotOR/community-bots/actions/workflows/ci.yml)

This repository contains the first implementation pass for a KOTOR-themed Discord bot suite:

- `Trask`: a source-backed KOTOR q&a assistant.
- `HK`: a curated self-role bot with HK-style responses.
- `Pazaak Bot`: a pazaak and fake-credit social game bot.
- `ingest-worker`: the shared ingestion and indexing entry point.

## Current State

**GitHub Pages hub:** the live static operator console and nested SPAs (PazaakWorld, Trask Holocron UI, HK hub) are served at `https://openkotor.github.io/community-bots/` (project site). A stable short bookmark is `https://openkotor.github.io/bots/` (org Pages repo) which forwards readers into the same deploy; use full `https://openkotor.github.io/community-bots/…` URLs in env vars, OAuth callbacks, and API bases.

This is the foundation phase. The monorepo includes:

- shared configuration, logging, UI, persona, retrieval, and persistence packages
- three runnable Discord bot apps with initial command sets
- a first pazaak vertical slice with in-memory active matches and file-backed wallets
- a Trask approved-source policy with a ResearchWizard sidecar integration path

## Bot Overview

### Trask

Purpose: answer KOTOR questions in a helpful, source-backed voice without exposing low-level retrieval details by default.

Administers:
- KOTOR troubleshooting answers
- project and tooling guidance
- citation-heavy research replies limited to approved sources

Implements its logic by:
- sending `/ask` queries to an `ai-researchwizard` sidecar
- constraining the request to the repo's hardcoded approved source list
- formatting the result into a Discord-friendly briefing with inline citations and a compact sources block

### HK

Purpose: manage curated self-assignable community roles.

Administers:
- project-follow roles
- community and event opt-ins
- timezone-sector discovery roles

Implements its logic by:
- reading the live guild role list on each interaction
- diffing the requested designations against the member's current roles
- applying Discord hierarchy-safe adds/removes with explicit error reporting

### Pazaak Bot

Purpose: run the server's pazaak table and fake-credit economy.

Administers:
- public challenges and rematches
- match state and turn flow
- wallets, daily bonuses, leaderboards, and rivalries

Implements its logic by:
- coordinating match state through a dedicated game engine
- persisting active matches and wallets to JSON storage
- exposing public board state plus private ephemeral hand controls

## Workspace Layout

```text
apps/
  trask-bot/
  trask-http-server/
  hk-bot/
  pazaak-bot/
  ingest-worker/
packages/
  config/
  core/
  discord-ui/
  persistence/
  personas/
  retrieval/
  trask/
  trask-http/
vendor/
  ai-researchwizard/
docs/
infra/
```

## Bot Web UIs (GitHub Pages)

- **Canonical hub URL:** [https://openkotor.github.io/bots/](https://openkotor.github.io/bots/) — stable bookmark that redirects into this repo’s Pages deploy (same content as [Discord hub](https://openkotor.github.io/community-bots/discord/)).
- **Deploy root:** [https://openkotor.github.io/community-bots/](https://openkotor.github.io/community-bots/) — operator console at `/`, Discord hub at [`/discord/`](https://openkotor.github.io/community-bots/discord/), [PazaakWorld](https://openkotor.github.io/community-bots/pazaakworld/), [Holocron / qa-webui](https://openkotor.github.io/community-bots/qa-webui/), [HK-86 hub](https://openkotor.github.io/community-bots/hk86/). The Pages workflow copies `index.html` into `discord/` and `pazaakworld/` so those routes return HTTP 200 (not only a 404-wrapped SPA shell).
- The `/bots/` entrypoint is served from the org Pages repo [`OpenKotOR/OpenKotOR.github.io`](https://github.com/OpenKotOR/OpenKotOR.github.io) (`bots/index.html`), because `OpenKotOR/bots` is a redirect alias to this repository and cannot host a separate project site at that path.

## Trask Worker Remote Deploy

- Cloudflare Worker source lives in `infra/trask-worker` and deploys from `.github/workflows/trask-worker.yml`.
- This deployment targets workers.dev (free tier) and is designed to keep Trask `/api/trask/ask` remote-only.
- Required secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- Required repository variable: `TRASK_RESEARCHWIZARD_BASE_URL`.
- Optional secrets: `TRASK_RESEARCHWIZARD_API_KEY`, `TRASK_WEB_API_KEY`.
- Optional variable: `TRASK_WEB_ALLOW_ANONYMOUS` (`1` default).
- Pages build for `qa-webui` reads `TRASK_API_BASE` (repo variable) and otherwise defaults to `https://trask-worker.workers.dev`.

## Getting Started

### Prerequisites

- Node.js ≥ 24, pnpm 10.11.0 (`corepack enable && corepack prepare pnpm@10.11.0 --activate`)
- Python ≥ 3.11 (for the Trask research venv — optional but improves answer quality)

### 1. Install and build

```bash
pnpm install
pnpm rebuild esbuild   # required once after clean install
pnpm build
```

### 2. Configure Discord credentials

Run the interactive wizard — it opens the Developer Portal in your browser and writes a `.env` file:

```bash
pnpm discord:setup
```

You'll need **App ID**, **Public Key**, and **Bot Token** for each bot (Trask, HK-86, Pazaak).
See [`docs/trask-ops.md`](docs/trask-ops.md) for the full step-by-step guide.

### 3. Bootstrap Trask's research venv (optional — improves Q&A quality)

```bash
node scripts/trask_ops.mjs setup-venv
```

Without a venv, Trask returns citation lists. With one (+ an LLM key), it returns synthesized answers.

### 4. Start the bots

```bash
pnpm dev:trask-http   # Trask Q&A REST server + Holocron web UI  (port 4010)
pnpm dev:trask        # Trask Discord bot
pnpm dev:hk           # HK-86 bot (react-for-role, designations)
pnpm dev:pazaak       # Pazaak card game bot
```

All bots read credentials from root `.env` (dotenv walks up from `process.cwd()`).
Guild-scoped command registration fires automatically when `DISCORD_TARGET_GUILD_ID` is set.

### HK-86 reaction roles

After starting the bot, configure `data/hk-bot/reaction-role-panels.json` with your channel and message IDs.
The template is at `apps/hk-bot/data-templates/reaction-role-panels.example.json`.
Run `/designations reactions help` in Discord for a pre-filled invite link and setup checklist.
See [`docs/trask-ops.md`](docs/trask-ops.md#hk-86-reaction-role-setup) for full instructions.

### Verify

```bash
pnpm verify:trask-web        # Playwright: 5 KOTOR queries → expects RICH responses
pnpm discord:smoke-bots      # Discord REST: confirm all slash commands are registered
pnpm test                    # 130 unit tests
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for build/test conventions and PR expectations.

## Discord Export

The repo includes a Python CLI for full Discord guild exports at [`scripts/export_discord_server.py`](scripts/export_discord_server.py).

Default behavior is intentionally non-interactive and broad: if `.env` contains a valid bot token plus `PAZAAK_DISCORD_GUILD_ID` or `DISCORD_TARGET_GUILD_ID`, running the script with no narrowing flags exports the full visible guild snapshot in one shot.

```bash
python -B scripts/export_discord_server.py --color
```

By default the exporter:

- fetches guild metadata
- fetches additional guild-level resources when available, including the community welcome screen, guild soundboard sounds, and the public guild widget payload when the server exposes it
- enumerates visible top-level channels and threads
- includes archived thread discovery unless explicitly disabled
- downloads message history for visible message-bearing containers
- expands reaction user lists for visible reactions
- downloads accessible message and guild asset media into a deduplicated asset store, including guild icons/banners, role icons, scheduled-event covers, guild soundboard audio when present, all public guild widget image styles plus widget member avatars when the widget is public, member profile avatars/banners, avatar decorations, clan badges when present, mentioned-user and reaction-user profile media and clan badges, emojis, stickers, and nested media inside referenced or forwarded message payloads; collectible nameplates and display-name styling metadata are also surfaced in normalized export refs when present in user payloads
- checkpoints progress and resumes the latest valid export directory automatically
- writes a manifest plus per-container JSON files under `exports/discord-server-<guild>-<id>-<timestamp>/`

Useful explicit overrides:

- `--metadata-only` to skip message history and export structure only
- `--include-channel` or `--exclude-channel` to narrow scope explicitly
- `--output-file` for a single aggregate JSON output instead of a directory tree
- `--exclude-archived-threads` to skip archived thread discovery
- `--no-reaction-users` to skip per-reaction user expansion explicitly
- `--no-assets` to skip asset downloads explicitly
- `--no-resume` to force a fresh export directory explicitly
- `--log-level`, `--verbose`, `--color`, or `--no-color` to control standardized stderr logging
- `--json-summary` for machine-readable completion output

The completion summary now includes downloaded asset totals and a split of `container_asset_ref_count`, `guild_asset_ref_count`, and `total_asset_ref_count` in both plain-text and `--json-summary` modes, alongside the persisted `guild_resource_summary` snapshot.

Deduplicated entries in `assets-manifest.json` now also retain merged provenance in `source_claims`, so reused assets can be traced back to every message, reaction-user profile, widget/member profile, or guild-level source that referenced them instead of only the first claimant.

Resume behavior is backfill-aware: if cached container JSON already exists, the exporter reuses saved message payloads and only performs missing enrichment work instead of refetching message history. Progress now checkpoints during message enrichment as well, so interrupted reaction-heavy containers can resume partway through rather than starting that container over. Reaction-user backfill resumes at the message level instead of replaying already-checkpointed messages, and asset enrichment completion is recorded per message so a container whose remaining media only failed remotely will still be recognized as complete and skipped on later resumes. Asset backfill now also revisits mentioned-user and reaction-user profile media, collectible nameplate and display-name-style metadata refs, plus nested referenced or forwarded message payloads when those embedded copies contain attachments, embeds, stickers, author avatars, avatar decorations, or clan badges that were not previously downloaded.

The verified live logger behavior is intentionally operator-friendly during long resumes:

- container logs use explicit `scope=... type=... id=... name=...` fields
- long reaction or asset backfills emit throttled progress markers instead of appearing stalled
- `manifest.json` and `assets-manifest.json` update during checkpoint writes, not only after a container finishes
- inaccessible third-party embed media is recorded as a failed asset and the run continues instead of aborting or silently dropping it
- long retry-after values on asset fetches are bounded, and repeated transient failures on external embed assets are cut short, so one bad remote host does not stall the whole export for many minutes
- the final stderr summary now includes a one-line guild resource status report covering welcome screen, soundboard count, vanity URL availability, widget JSON/settings availability, widget member count, and exported widget image style count

That same guild resource status snapshot is also persisted in `manifest.json` under `guild_resource_summary`, so both machine readers and operators see the same verified end-state without scraping colored terminal output.

Checkpoint persistence is also now interruption-safe: JSON manifests and downloaded assets are written through atomic temp-file replacement, unreadable cached JSON is quarantined to a `*.corrupt-<timestamp>.json` sibling instead of aborting the whole resume path, and disk-full write failures now stop the run immediately instead of being misreported as ordinary asset download warnings.

When a guild-level resource exists in the API but is not enabled or not exposed for the current bot permissions, the exporter records that in `optional_resource_errors` instead of aborting the run. This is how unavailable welcome-screen metadata is reported, for example.

Manifest accounting now splits asset references into `container_asset_ref_count` and `guild_asset_ref_count`, with `total_asset_ref_count` including both. This keeps guild-level exports such as member profile media, widget assets, soundboard sounds, and other non-message resources visible in the top-level totals instead of hiding them outside the per-container summaries.

The previous helper name [`scripts/export_discord_channel.py`](scripts/export_discord_channel.py) now acts as a compatibility wrapper over the new CLI.

Export output lands in `exports/discord-server-<guild>-<id>-<timestamp>/` with a `manifest.json`, per-container JSON files, and a deduplicated `assets/` store.

## Notes

- Trask is being moved to a sidecar-backed research flow. The approved source list stays hardcoded in this repo, while the answer synthesis path is delegated to `ai-researchwizard`.
- Pazaak Bot wallets are persisted to a JSON file so the game loop is usable before the Postgres layer is wired in.
- HK only manages a curated allowlist of opt-in roles and refuses to touch roles above the bot in the guild hierarchy.