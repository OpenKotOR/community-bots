# HK-86 Native Bot Features

HK-86 is a native `discord.js` bot. Carl-Bot's public repository and docs are useful references for feature shape, but HK-86 does not vendor or execute Carl-Bot's outdated `discord.py` implementation.

## Free-model HK dialog

Set `HK_LLM_ENABLED=true` to let HK rewrite non-critical bot copy through an OpenAI-compatible provider. HK resolves model candidates from `vendor/llm_fallbacks` and only attempts explicit free model identifiers such as `*:free` or `*-free`. If no explicit free models are available, HK falls back to deterministic local copy.

Useful environment variables:

- `OPENROUTER_API_KEY`
- `OPENAI_BASE_URL=https://openrouter.ai/api/v1`
- `OPENROUTER_HTTP_REFERER`
- `OPENROUTER_APP_TITLE`
- `HK_LLM_ENABLED=true`
- `HK_LLM_TIMEOUT_MS=6000`
- `HK_LLM_MAX_REPLY_CHARS=420`

## Guard config

Copy [`apps/hk-bot/hk-guard.example.json`](../../apps/hk-bot/hk-guard.example.json) to `HK_DATA_DIR/hk-guard.json`.

Supported native features:

- Welcome messages with `$mention`, `$user`, and `$server` placeholders.
- Autoroles and an optional labyrinth entry role on member join.
- Honeypot channels for fresh joins and young accounts.
- Optional quarantine role when a honeypot is triggered.
- Guard event logging to a configured log channel.

The honeypot intentionally does not auto-ban. It quarantines and logs so moderators can verify, because spambots are disposable and false positives are expensive.

## Carl-Bot parity direction

High-value features should be implemented as small native modules:

1. Reaction roles and role aliases.
2. Welcome/autorole/labyrinth onboarding.
3. Honeypot quarantine and moderation logging.
4. Automod rules with dry-run/log-only modes before destructive actions.
5. Custom tags/responses with strict mention sanitization.

Each module should own its config, tests, and permission checks. Do not create a Python sidecar bot.
