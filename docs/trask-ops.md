# Bot Operations Guide

Operations and verification guide for the three OpenKOTOR Discord bots plus the Trask Holocron web UI.

## Verified Working

| Component | Status | Evidence |
|-----------|--------|---------|
| Trask HTTP server (`/api/trask/*`) | ✅ | `pnpm verify:trask-web` — 5/5 RICH lore answers from local knowledge |
| Holocron web UI (`apps/holocron-web`) | ✅ | Playwright verifier passes 5 KOTOR Q&A queries |
| GPTR Python venv auto-discovery | ✅ | No path config needed; walks up from cwd |
| Garbage content filtering | ✅ | Cloudflare/JS-challenge blocks stripped from scraped pages |
| Seeded KOTOR lore (15 entries) | ✅ | Revan/Bastila/HK-47/Exile/Nihilus/Pazaak-rules/etc. answer without LLM key |
| Local knowledge fallback | ✅ | `localKnowledgeFallbackAnswer` used when synthesis fails |
| HK-86 bot unit tests | ✅ | 130/130 passing incl. reaction-role logic |
| Bot cold-start (no tokens) | ✅ | All 3 bots start → only fail at Discord token step |
| Discord bot code + command registration | ✅ | `pnpm discord:smoke-bots` once tokens provided |
| Live Discord bot interaction | ⏳ | Run `pnpm discord:setup` to enter credentials — see below |

---

## First-Time Setup (< 5 minutes)

### 1. Install dependencies and build

```bash
pnpm install
pnpm rebuild esbuild   # must run once after clean install
pnpm build
```

### 2. Bootstrap the research venv (for Trask web Q&A)

```bash
node scripts/trask_ops.mjs setup-venv
```

This creates `.venv-trask-gptr/` at the repo root with all Python dependencies.
**Both the venv path and the ai-researchwizard root are auto-discovered — no path configuration needed.**

### 3. Configure Discord credentials

Run the interactive wizard (opens discord.com/developers/applications in your browser):

```bash
pnpm discord:setup
```

The wizard will:
1. Open https://discord.com/developers/applications in your browser  
2. Prompt you to paste **App ID**, **Public Key**, and **Bot Token** for each bot  
3. Write validated credentials to `.env` at the repo root

**Where to find each value in the Developer Portal:**
- **App ID** and **Public Key** — "General Information" tab
- **Bot Token** — "Bot" tab → "Reset Token" → confirm → copy

### 4. Optionally add an LLM key for prose synthesis

Without an LLM key, Trask returns citation lists. Add one of these to `.env`:

```env
# Option A: OpenAI
OPENAI_API_KEY=sk-...

# Option B: OpenRouter (free tier available)
OPENROUTER_API_KEY=sk-or-...
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_HTTP_REFERER=https://github.com/openkotor/community-bots
OPENROUTER_APP_TITLE=OpenKotor Trask
TRASK_REWRITE_MODEL_FALLBACKS=meta-llama/llama-3.2-3b-instruct:free,openrouter/auto

# Option C: Tavily (improves search quality)
TAVILY_API_KEY=tvly-...
```

---

## Running the Bots

```bash
# Start Trask web Q&A server (port 4010)
pnpm dev:trask-http

# Start Trask Discord bot
pnpm dev:trask

# Start HK-86 Discord bot (react-for-role)
pnpm dev:hk

# Start Pazaak Discord bot
pnpm dev:pazaak
```

Bots automatically load credentials from root `.env` (dotenv walks up from `cwd`).

---

## HK-86 Reaction-Role Setup

After the bot is running you need to configure which message(s) act as reaction panels.

### Step 1 — Create a panel message in Discord

Post a message in any channel (e.g. `#roles`). Users will react to that message to get roles.
In Discord: **User Settings → Advanced → Developer Mode** to enable copying IDs.

- Right-click the **channel** → "Copy Channel ID"
- Right-click the **message** → "Copy Message ID"

### Step 2 — Configure `data/hk-bot/reaction-role-panels.json`

The file is auto-created from the template when you run `pnpm discord:setup`. Edit it:

```json
{
  "version": 1,
  "defaultAnnounceMode": "reply",
  "replyCooldownMs": 3000,
  "panels": [
    {
      "channelId": "123456789012345678",
      "messageId": "234567890123456789",
      "mappings": [
        { "emoji": "🎮", "roleNameHint": "PC Gamer" },
        { "emoji": "📚", "roleNameHint": "Lore Enthusiast" }
      ]
    }
  ]
}
```

Use `roleNameHint` to bind by role name (auto-looked-up), or `roleId` for a stable snowflake ID.
The bot **hot-reloads** the file — no restart needed after saving changes.

### Step 3 — Invite the bot with correct permissions

The `/designations reactions help` command (ephemeral) outputs a pre-filled invite link.
Required permissions: **Manage Roles** (must be positioned above any role it assigns), Send Messages, Embed, Read History, Add Reactions.

### Step 4 — Verify

```bash
# In Discord, as a guild manager:
/designations reactions status
```

Shows loaded panels and mapping counts. Then react on the panel message with a test account — HK-86 should reply and apply the role.

---

## Verification

### Web UI (Trask / Holocron)

```bash
pnpm verify:trask-web
```

Opens the Holocron web UI with Playwright and submits five dynamic KOTOR queries.
Passes when each returns source-backed results (RICH) or a graceful degraded response.

### Discord command registration smoke test

```bash
pnpm discord:smoke-bots
```

Calls the Discord REST API to confirm all slash commands are registered for each bot.

### Manual Discord verification checklist

| Bot | Command to test |
|-----|----------------|
| Trask | `/ask query:<your question>` — should return briefing with sources |
| HK-86 | `/designations reactions status` — check reaction-role panel |
| HK-86 | Click a reaction emoji → role should be added/removed |
| Pazaak | `/pazaak rules` then `/pazaak lobby action:create` |

---

## Updating

```bash
# Pull latest + rebuild
git pull
node scripts/trask_ops.mjs update

# Refresh research venv if requirements changed
node scripts/trask_ops.mjs setup-venv
```

---

## Trask ops helper reference

```bash
node scripts/trask_ops.mjs --help

# Commands:
#   setup          Install deps, init submodules, build
#   setup-venv     Create/update .venv-trask-gptr Python venv
#   update         git pull + rebuild
#   build-web      Build holocron-web static assets
#   dev-http       Start trask-http-server (port 4010)
#   verify-web     Playwright browser verification (5 queries)
#   smoke-discord  Discord REST command registration smoke test
```
