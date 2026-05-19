# Trask Bot

Trask Ulgo is the guild's KOTOR q&a bot. His job is to answer questions clearly, stay useful for
non-technical users, and support his claims with visible citations without dumping backend search
mechanics into the conversation.

## Persona

Trask answers like a competent officer briefing a junior crew member. He states the most important
thing first, provides relevant citations, and flags when information is uncertain. He does not pad
answers with filler text, does not pretend to know things he cannot cite, and avoids genericisms
("interesting question", "great point").

Key voice notes:
- Concise and action-oriented.
- Caveats uncertain information explicitly ("I do not have a cached result for this yet").
- Prefers two sentences over a paragraph when the answer fits.
- References source names naturally ("Per the Deadly Stream index, …").

## Commands

### `/ask`

Ask a KOTOR question and get a source-backed answer.

**Options:**
| Option | Required | Description |
|---|---|---|
| `query` | yes | Question or topic (max 200 characters) |

**Behavior:**
- Runs **`scripts/trask_web_research.py`** (indexer retrieve + DuckDuckGo fallback on approved hosts).
- Restricts research to Trask's approved source list.
- Treats `TRASK_FAST_QA=1` as an explicit low-latency override; the default path now prefers the higher-quality
  evidence-first flow and only uses fast/local synthesis when grounded support survives relevance checks.
- Returns a short Discord-friendly answer with inline numeric citations and a compact `Sources`
  bibliography section.
- If `OPENAI_API_KEY` / `OPENROUTER_API_KEY` are unset, the runtime degrades to deterministic formatting
  plus grounded local technical references or an explicit abstention instead of hard-failing.
- Does not explain retrieval internals unless the user explicitly asks.

**Example:**
```
/ask query:mdlops model formats
```

Returns a direct answer supported by approved sources such as MDLOps, KOTOR Neocities, PyKotor,
Deadly Stream, and related KOTOR references.

---

### `/sources`

Inspect the currently approved source policy. This is an admin-facing command.

**Options:**
| Option | Required | Description |
|---|---|---|
| `kind` | no | Filter by type: `website`, `github`, or `discord` |

**Behavior:**
Returns up to ten sources per call. Shows source name, description, and freshness policy.

---

### `/queue-reindex`

Queue a source refresh request. Requires **Manage Guild** permission.

**Options:**
| Option | Required | Description |
|---|---|---|
| `source` | no | Source ID to refresh, or leave blank for all sources |

**Behavior:**
- Writes source IDs into the ingest-worker file queue.
- The ingest worker can then process queued jobs with `drain-queue` (single pass) or `run-queue-worker` (continuous polling).

---

## Approved Source Catalog

Trask's answer generation is pinned to these approved sources by default:

| ID | Name | Kind | Notes |
|---|---|---|---|
| `deadlystream` | Deadly Stream | website | Primary KOTOR modding hub |
| `lucasforums-archive` | LucasForums Archive | website | Historical forum archive |
| `pcgamingwiki-kotor` | PCGamingWiki | website | PC compatibility and fixes |
| `kotor-neocities` | KOTOR Neocities | website | Community technical docs |
| `pykotor-wiki` | PyKotor Wiki | website | PyKotor scripting reference |
| `reone-repo` | reone | github | Open engine reimplementation |
| `northernlights-repo` | Northern Lights | github | Engine and tooling work |
| `mdlops-repo` | MDLOps | github | Model conversion tooling |
| `pykotor-repo` | PyKotor | github | Python KOTOR library |
| `kotorjs-repo` | kotor.js | github | JS KOTOR tooling |
| `xoreos-repo` | xoreos | github | Odyssey/Aurora engine implementation |
| `xoreos-tools-repo` | xoreos-tools | github | Odyssey/Aurora format tooling |
| `kotorblender-repo` | KotORBlender | github | Blender model tooling |
| `kotormax-repo` | KOTORMax | github | 3ds Max model tooling |
| `mdledit-repo` | MDLEdit | github | Model editor/conversion tooling |
| `tga2tpc-repo` | TGA2TPC | github | Texture conversion tooling |
| `approved-discord-knowledge` | Approved Discord | discord | Opt-in guild channel index |

Live research is constrained to the approved base hosts `lucasforumsarchive.org`, `deadlystream.com`, `github.com`, `kotor.neocities.org`, and `pcgamingwiki.com`. GitHub crawling is further narrowed to the approved KotOR project roots in this catalog. The headless bridge passes both `query_domains` and `allowed_url_prefixes`, rejects direct or discovered URLs outside that allowlist before scraping, and reports accepted/rejected URL lists in `research_information` for audit.

**Holocron and functional e2e require live approved-web citations only** (`https://…` on the allowlisted hosts).
Answers come from live web research on those hosts (indexer passages and/or DuckDuckGo). There are no bundled
`local://` reference chunks or offline citation substitutes.

## Admin Setup

The following environment variables control Trask's scope:

| Variable | Purpose |
|---|---|
| `TRASK_ALLOWED_GUILD_IDS` | Comma-separated guild IDs where Trask is active |
| `TRASK_APPROVED_CHANNEL_IDS` | Comma-separated channel IDs where `/ask` is allowed |
| `TRASK_SLASH_GUILD_IDS` | Comma-separated guild IDs where slash commands are **registered** (use when the bot serves multiple servers; overrides single-guild deploy when non-empty) |
| `TRASK_WEB_RESEARCH_PYTHON` | Python interpreter for `scripts/trask_web_research.py` (defaults to `.venv-trask-research/bin/python` when present) |
| `TRASK_WEB_RESEARCH_SCRIPT` | Optional absolute path to override `scripts/trask_web_research.py` |
| `TRASK_INDEXER_BASE_URL` | Trask indexer retrieve API (default `http://127.0.0.1:8790`) |
| `TRASK_RESEARCH_TIMEOUT_MS` | Max time for one research run (default `900000`; alias `TRASK_RESEARCHWIZARD_TIMEOUT_MS`) |

When `TRASK_APPROVED_CHANNEL_IDS` is set, Trask only answers `/ask` in those channels. It does not
perform blanket server-history reads unless proactive mode is enabled (see below).

### Python research environment (required for `/ask` and Holocron research)

Trask spawns **`scripts/trask_web_research.py`**, which POSTs to **`TRASK_INDEXER_BASE_URL/retrieve`**
when the indexer is running, falls back to local Chroma under `data/trask-indexer`, then DuckDuckGo
when `ddgs` is installed.

**Bootstrap (recommended)**

```bash
bash scripts/bootstrap_trask_research.sh
export TRASK_WEB_RESEARCH_PYTHON="$(pwd)/.venv-trask-research/bin/python"
```

Optional: run the indexer API (`infra/trask-indexer`) on port **8790** for higher-quality passages.

LLM keys for answer rewrite live in **`.env`** / **`.env.local`** at the repo root (`OPENAI_API_KEY`,
`OPENROUTER_API_KEY`).

### Smoke test

| Command | Purpose |
|---|---|
| `pnpm smoke:trask-research` | Runs `scripts/smoke_trask_indexed_stack.py` (indexer + retrieve smoke) |
| `bash scripts/trask_index_seed_for_qa.sh` | Export allowlist, seed five Holocron golden-query fixtures into Chroma, optional indexer health check |
| `echo '{"query":"TSLPatcher","query_domains":["deadlystream.com"]}' \| .venv-trask-research/bin/python scripts/trask_web_research.py` | Minimal JSON contract check |

### Holocron functional E2E (Playwright — no API mocks)

Tests live in `apps/holocron-web/e2e/holocron-research.spec.ts`. Playwright builds the workspace,
starts **`trask-http-server`** (Holocron `dist` + `/api/trask` on **4010**), and runs five real research
queries in Chromium (202 → thread poll → answer + grounded **Sources** / citation badges).

```bash
pnpm exec playwright install chromium --with-deps   # once per machine (repo root)
pnpm holocron:e2e
```

Requires `.env` / `.env.local` when you want live web synthesis / rewrite.
Without LLM keys, Trask may still retrieve approved web pages; answers must include **at least two**
distinct `https://` sources or fail explicitly. Set `HOLOCRON_REUSE_SERVER=1` if the server is already listening on 4010.

CLI debug gate:

```bash
pnpm verify:trask-cli
```

That script mirrors the same canonical five technical queries as Holocron e2e. It is for retrieval
debugging only and does **not** replace browser or Playwright verification of real `https://` citations.

Offline citation-alignment replay (no live web research):

```bash
pnpm trask:faithfulness-eval
```

Fixtures live under `data/trask-eval/fixtures/`; specs in `data/trask-eval/golden-queries.json`.

### Discord bot slash commands (REST smoke)

Automating Discord’s **web client** requires a logged-in session; this repo ships a small **REST** probe instead:

```bash
set TRASK_DISCORD_BOT_TOKEN=...
set TRASK_DISCORD_APP_ID=...
node scripts/discord_trask_commands_smoke.mjs
```

Guild-scoped commands may not appear here if your deploy registers only per-guild — the script still validates token/app pairing.

### Proactive channel replies (optional)

When **`TRASK_PROACTIVE_ENABLED=1`**, Trask registers **privileged intents** (`Guild Messages`, `Message Content`),
listens in resolved proactive channels, and may answer **without** `/ask` using a short plain-text reply (chat-style,
not the long embed briefing).

**Requirements**

- Enable **Message Content Intent** (and guild message events) for the application in the Discord Developer Portal.
- Set **`OPENAI_API_KEY`** (or **`OPENROUTER_API_KEY`**) — used for a **small-model JSON classifier** (question +
  KOTOR relevance), **embeddings** to compare the draft answer against the research report, and the brief rewrite path.
- Configure at least one channel: **`TRASK_PROACTIVE_CHANNEL_IDS`** or **`TRASK_APPROVED_CHANNEL_IDS`** (proactive falls
  back to approved channels when the proactive list is empty).

**Behavior (high level)**

1. **Debounce** (`TRASK_PROACTIVE_DEBOUNCE_MS`, default 25s): waits for quiet time before running the pipeline on the
   latest eligible message in that channel.
2. **Competing reply heuristic**: after the wait, if another (non-bot) user posted a message at least
   `TRASK_PROACTIVE_COMPETING_MIN_LENGTH` characters long, Trask stays silent so humans can answer first.
3. **Classifier** (`TRASK_PROACTIVE_CLASSIFIER_MODEL`, default `gpt-4o-mini`): JSON output gates obvious non-questions
   and off-topic chatter.
4. **Research**: runs live web research with a **brief** digest prompt and a short Discord rewrite.
5. **Semantic gate** (`TRASK_PROACTIVE_SIMILARITY_THRESHOLD`): embedding similarity between the user question / brief
   answer and the normalized report must clear the threshold, reducing confident-but-ungrounded replies.
6. **Per-user cooldown** (`TRASK_PROACTIVE_USER_COOLDOWN_MS`) limits spam.

See [`apps/trask-bot/.env.example`](apps/trask-bot/.env.example) for all proactive tunables.

### Discord web, `/ask`, and Playwright

Discord’s web client treats slash options as structured fields. Typing a single line like
`/ask query What is MDLOps?` (or filling the composer without selecting the `query` chip) often leaves
`query` empty and shows **“This option is required”**. For manual use or automation, prefer **Apps →
Trask Q&A Assistant → `ask`**, then enter text **inside the `query` parameter** (click the `query`
pill so it is active before typing). Playwright and similar tools should mimic that flow—**Tab alone
may not bind** the option—rather than pasting a full pseudo-command string.

## Current Limitations

- Trask depends on a working **Python research venv** (`bash scripts/bootstrap_trask_research.sh`) and optional
  indexer on `TRASK_INDEXER_BASE_URL`. Missing LLM keys should
  no longer hard-fail requests, but they do reduce the runtime to deterministic local-reference answers or
  explicit abstentions when no grounded web synthesis is available.
- The vendored backend defaults to a report-oriented workflow, so prompt and formatting controls
  still need refinement to keep replies concise under Discord limits.
- Ingest queue processing is still a separate operator workflow. `/queue-reindex` enqueues work,
  while indexing execution is managed by ingest-worker CLI commands.
- With **`TRASK_PROACTIVE_ENABLED=0`** (default), Trask is slash-command-only and does not use privileged message intents.
- Proactive mode reads channel messages and requires **Message Content** intent plus operator discipline (scoped channels,
  cooldowns) to avoid noisy or intrusive automation.

## Architecture (modular)

| Piece | Role |
|---|---|
| `@openkotor/trask` | Spawns `scripts/trask_web_research.py`; optional OpenAI-compatible rewrite pass |
| `@openkotor/trask-http` | Express router factory: `GET/POST /sources`, `/history`, `/ask` under `/api/trask` with pluggable auth |
| `apps/trask-bot` | Discord slash commands; optional proactive listener uses `@openkotor/trask` brief answers + LLM gates |
| `apps/trask-http-server` | Standalone API + optional static serving of `apps/holocron-web/dist` |
| `apps/pazaak-bot` | Still mounts the same router at `/api/trask` for PazaakWorld |
| `apps/holocron-web` | Holocron SPA; **default** path calls the Trask HTTP API (legacy Spark simulation behind `VITE_TRASK_LEGACY_SPARK=1`) |
| `infra/trask-indexer` | Crawl4AI + Chroma retrieve API (`POST /retrieve`) |
| `vendor/llm_fallbacks` | Python ordering for free/chat models (HK bot and optional helpers) |

Trask Q&A does **not** require PazaakWorld: run `trask-http-server` + `holocron-web` with the research venv and indexer when available.

## Layered knowledgebase

Operator charter, Discord text export/import, welcome tone, source authority, validation ladder, Holocron REST contracts (`/ask`, `/history`, session), Holocron browser client (`VITE_*`), embedded vs standalone HTTP hosts, Pazaak `/api/trask` mount, proactive mode, env variable map, and evidence-label rules live under
[`docs/knowledgebase/README.md`](knowledgebase/README.md). Use that index when extending ingestion or documenting Trask behavior beyond this file.

## Standalone HTTP server (`apps/trask-http-server`)

Runs the shared router and optionally serves a built `apps/holocron-web` bundle.

```bash
pnpm dev:trask-http
```

See [`apps/trask-http-server/.env.example`](apps/trask-http-server/.env.example) for variables.

### Auth modes for the web UI

| Mode | Configuration |
|---|---|
| Local dev | `TRASK_WEB_ALLOW_ANONYMOUS=1` — requests are scoped to `TRASK_WEB_DEFAULT_USER_ID` |
| Shared secret | `TRASK_WEB_API_KEY` — send `Authorization: Bearer <key>` or `X-Trask-Api-Key` (Holocron web can store a key in Settings) |

### Shared history with Discord

Point both processes at the same JSON store: set **`TRASK_HTTP_DATA_DIR`** on `trask-http-server` and use the same directory + filename pattern (`trask-queries.json` via `resolveDataFile`) if you extend the bot to POST to the API later—or symlink/copy **one** `trask-queries.json` path in ops.

## Holocron Web UI (`apps/holocron-web`)

- **Default:** questions go to `/api/trask/ask` (relative URL). Vite dev proxies `/api/trask` → `TRASK_HTTP_PROXY_TARGET` (default `http://127.0.0.1:4010`). The usual Holocron dev URL is `http://localhost:5174`; the Trask HTTP server also permits `5173`, `4174`, `4173`, and `3000` for local browser/proxy testing.
- **Env:** `VITE_TRASK_API_BASE` (optional absolute API origin), `VITE_TRASK_API_KEY` (optional build-time bearer), `VITE_TRASK_LEGACY_SPARK=1` to restore the old Spark + simulated multi-agent path.

```bash
pnpm install   # monorepo root
pnpm dev:holocron-web   # or: pnpm --filter @openkotor/holocron-web dev
```

Then either open the app via `trask-http-server` (static, after `pnpm --filter @openkotor/holocron-web build`) or run the dev server with `trask-http-server` on port 4010.

## Web UI (PazaakWorld, optional)

Trask remains available from PazaakWorld after sign-in (**◉ Ask Trask**). It uses the same `/api/trask/*` contract mounted inside `pazaak-bot`.

### Q&A Screen layout (PazaakWorld)

```
┌─────────────────────────────────────────────────────────────┐
│ nav: ◉ Trask Q&A              [Sources (N)]  [← Back]       │
├─────────────────────────────────────────────────────────────┤
│  ┌───── sidebar ──────┐  ┌──── main panel ─────────────────┐│
│  │ History            │  │  <welcome / answer exchange>    ││
│  │ ─────────────────  │  │                                 ││
│  │ question 1 (done)  │  │  ┌── input form ───────────────┐││
│  │ question 2 (fail)  │  │  │  textarea (Enter to submit) │││
│  │ …                  │  │  │  [count]          [Ask]     │││
│  └────────────────────┘  └──┴─────────────────────────────┘││
└─────────────────────────────────────────────────────────────┘
```

### API endpoints (`/api/trask/*`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/trask/sources` | List approved knowledge sources (requires auth) |
| `GET` | `/api/trask/history?limit=N` | Recent questions for the authenticated user |
| `POST` | `/api/trask/ask` | Submit a question; returns a `TraskQueryRecord` |

Returns **503** if the Trask runtime is not wired (pazaak-bot) or the research script cannot run (`trask-http-server` still mounts routes but handlers error when misconfigured).

### DTO shapes

```ts
interface TraskSourceRecord {
  id: string;
  name: string;
  kind: "website" | "github" | "discord";
  homeUrl: string;
  description: string;
  freshnessPolicy: string;
}

interface TraskQueryRecord {
  queryId: string;
  userId: string;
  query: string;
  status: "pending" | "complete" | "failed";
  answer: string | null;
  sources: Array<{ id: string; name: string; url: string }>;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}
```

## LLM configuration

### Post-report rewrite (`@openkotor/trask`)

After web research returns a digest report, Trask optionally calls an **OpenAI-compatible** chat completion to tighten Discord formatting.

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Primary API key |
| `OPENROUTER_API_KEY` | Used when `OPENAI_API_KEY` is unset |
| `OPENAI_BASE_URL` | e.g. `https://openrouter.ai/api/v1` |
| `OPENAI_CHAT_MODEL` | e.g. `openrouter/auto` or another routed id |
| `OPENROUTER_HTTP_REFERER` / `OPENROUTER_APP_TITLE` | OpenRouter suggested headers |
| `TRASK_REWRITE_MODEL_FALLBACKS` | Comma-separated fallback model ids if the primary rewrite fails |
| `TRASK_GROUNDED_COMPOSE` | Set `0` / `false` to disable grounded compose. Default **on** (question-last extract-then-compose when passages exist). |
| `TRASK_RESEARCH_COMPOSE_MODE` | Set `rewrite` to opt into legacy digest rewrite fallbacks. Default `grounded`. |
| `TRASK_WEB_RESEARCH_DDG_FALLBACK` | Operator-only: allow DuckDuckGo when Chroma retrieve is empty (does not satisfy index-miss compose). |

If no key is configured, Trask uses a deterministic formatter (`fallbackDiscordRewrite`) and relies on
grounded local/web evidence or an explicit abstention; missing keys should not hard-fail the request path.

## Shared packages

`packages/trask/` exports `ResearchWizardClient` and `createResearchWizardClient`.

`packages/trask-http/` exports `createTraskHttpRouter` for any host (pazaak-bot, trask-http-server, tests).

## Persistence

- **Standalone server:** `${TRASK_HTTP_DATA_DIR}/trask-queries.json` (default `data/trask-http-server/trask-queries.json`).
- **Pazaak bot:** `${PAZAAK_DATA_DIR}/trask-queries.json`.

Uses `JsonTraskQueryRepository` from `@openkotor/persistence`.

## Next Phase

- Replace remaining source-description-only technical reference entries with richer indexed passages from approved docs/forums.
- Feature flag to hide the PazaakWorld **Ask Trask** entry when the API returns 503 at startup.
