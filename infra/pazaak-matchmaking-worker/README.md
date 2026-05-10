# Pazaak Matchmaking Worker (Free Fallback)

This Worker provides a free, deployable fallback API for PazaakWorld auth/session,
queueing, and basic lobbies. It is designed to run on Cloudflare Workers + Durable
Objects with zero server maintenance.

It also exposes Discord Activity support endpoints that can sit in front of the
authoritative bot API:

- `POST /api/auth/token` or `POST /api/token` exchanges a Discord Activity OAuth
	code for a Discord access token while keeping the client secret server-side.
- `wss://<worker>/relay/:instanceId` provides a lightweight Durable Object
	presence relay for Activity instances. This relay does not own Pazaak match
	state; live draw/play/stand actions still go to the authoritative Pazaak bot
	API configured in `VITE_API_BASES`.

## Endpoints implemented

- `GET /api/ping`
- `POST /api/auth/token`
- `POST /api/token`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/oauth/providers`
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `GET /api/me`
- `GET/PUT /api/settings`
- `GET /api/leaderboard`
- `GET /api/me/history`
- `GET /api/pazaak/opponents`
- `POST /api/matchmaking/enqueue`
- `POST /api/matchmaking/leave`
- `GET /api/matchmaking/status`
- `GET /api/matchmaking/stats`
- `GET/POST /api/lobbies`
- `POST /api/lobbies/join-by-code`
- `POST /api/lobbies/:id/join`
- `POST /api/lobbies/:id/ready`
- `POST /api/lobbies/:id/status`
- `POST /api/lobbies/:id/leave`
- `GET /relay/:instanceId` as a WebSocket upgrade
- `GET /api/config/public` — cache-friendly subset of `@openkotor/pazaak-policy`
  (regions, time-control presets, feature flags) for the lobby UI
- `GET/PUT /api/admin/policy` — RBAC policy merge (Discord allowlist / guild admin);
  pair with `GET /api/admin/audit`
- Match authority when enabled: `MatchActor` Durable Object routes under
  `/api/matches/:id/state` and `/command`; bot may dual-write via
  `POST /api/bot-match-sync` (see `wrangler.toml` secrets)

### Signed bot sync payloads

`POST /api/bot-match-sync` now requires a timestamped HMAC signature so
snapshots are authenticated and replay-resistant:

- Header `X-Pazaak-Sync-Timestamp`: Unix epoch seconds
- Header `X-Pazaak-Sync-Signature`: base64url(HMAC-SHA256(`${timestamp}.${rawBody}`))

Requests are rejected when the signature is invalid or the timestamp is outside
the 5-minute acceptance window.

Set `PAZAAK_BOT_SYNC_SECRET` to a high-entropy value (minimum 32 characters).

## Ops policy (Wrangler vars + env)

Policy merges in this order: **baked defaults** → optional **`PAZAAK_POLICY_JSON`**
secret or Worker **`[vars]`** entries your loader understands → runtime admin
`PUT /api/admin/policy`. Client-side env overrides like `PAZAAK_POLICY__…` are
documented in the `@openkotor/pazaak-policy` package (`packages/pazaak-policy`)
for Node/bot processes; the Worker typically uses `PAZAAK_POLICY_JSON` or admin API.

Multiplayer match action endpoints intentionally return errors, so clients can
fall back to local play.

## Local dev

```bash
pnpm dlx wrangler dev --config infra/pazaak-matchmaking-worker/wrangler.toml
```

## Deploy

```bash
pnpm dlx wrangler deploy --config infra/pazaak-matchmaking-worker/wrangler.toml
```

CI validates the bundle without Cloudflare credentials via `wrangler deploy --dry-run` in
`.github/workflows/pazaak-matchmaking-worker.yml` (`verify-bundle` job).

After deploy, use the worker URL in `VITE_API_BASES` (comma-separated list) to
enable frontend failover. To keep a **bot API first** and the Worker second, set
`VITE_LEGACY_HTTP_ORIGIN` to the bot public origin and put the Worker in `VITE_API_BASES` / `PAZAAK_API_BASES`
(see `docs/pazaak-world-hosting.md`).

For **regional entrypoints** on container PaaS (Fly, Render, Railway, Koyeb) that still proxy to this Worker, see [`infra/matchmaking-inducer/README.md`](../matchmaking-inducer/README.md).

For Discord Activity token exchange and participant verification, set secrets:

```bash
pnpm dlx wrangler secret put DISCORD_CLIENT_ID --config infra/pazaak-matchmaking-worker/wrangler.toml
pnpm dlx wrangler secret put DISCORD_CLIENT_SECRET --config infra/pazaak-matchmaking-worker/wrangler.toml
pnpm dlx wrangler secret put DISCORD_BOT_TOKEN --config infra/pazaak-matchmaking-worker/wrangler.toml
# Optional, if your Discord OAuth setup requires it:
pnpm dlx wrangler secret put DISCORD_REDIRECT_URI --config infra/pazaak-matchmaking-worker/wrangler.toml
```

In development, `ALLOW_UNVERIFIED_INSTANCES = "1"` allows the relay to accept
`dev-*`, `local-*`, and test Activity instance IDs. For production, set it to
`"0"` and provide `DISCORD_CLIENT_ID` plus `DISCORD_BOT_TOKEN` so the relay can
verify participants with Discord before accepting a room join.

## Social OAuth (Google / Discord / GitHub)

**Full documentation** (Google Cloud / Discord / GitHub consoles, callback URLs, Wrangler + GitHub
Actions secret names, precedence, verification, troubleshooting): **[`docs/pazaak-oauth-providers.md`](../../docs/pazaak-oauth-providers.md)**.

PazaakWorld reads `GET /api/auth/oauth/providers` and only enables buttons when
the Worker has the matching client credentials.

### GitHub Actions (recommended)

Add **repository secrets** on `OpenKotOR/community-bots` (values come from each provider console):

| Repository secret | Written to Worker secret |
|---|---|
| `WORKER_DISCORD_CLIENT_ID` | `DISCORD_CLIENT_ID` |
| `WORKER_DISCORD_CLIENT_SECRET` | `DISCORD_CLIENT_SECRET` |
| `WORKER_GOOGLE_CLIENT_ID` | `GOOGLE_CLIENT_ID` |
| `WORKER_GOOGLE_CLIENT_SECRET` | `GOOGLE_CLIENT_SECRET` |
| `WORKER_GITHUB_CLIENT_ID` | `GITHUB_CLIENT_ID` |
| `WORKER_GITHUB_CLIENT_SECRET` | `GITHUB_CLIENT_SECRET` |

The deploy workflow runs `wrangler secret put` after each deploy (empty secrets are skipped).

1. **Secrets** (manual alternative: repeat with `wrangler secret put … --config infra/pazaak-matchmaking-worker/wrangler.toml`):

   - `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` (optional `DISCORD_REDIRECT_URI`)
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (optional `GOOGLE_REDIRECT_URI`)
   - `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (optional `GITHUB_REDIRECT_URI`)

2. **Frontend origin**: Build/deploy PazaakWorld with this Worker URL first in
   `VITE_API_BASES` so `/api` requests hit the Worker (see
   [`docs/pazaak-world-hosting.md`](../../docs/pazaak-world-hosting.md)).

3. **Provider consoles**: Register redirect URLs exactly as the Worker uses them:
   `https://<your-worker-host>/api/auth/oauth/<provider>/callback` unless you
   override with `*_REDIRECT_URI`.

4. **Verify**: After deploy, open `https://<worker>/api/auth/oauth/providers`
   and confirm each intended provider has `"enabled": true`.

5. **Google `invalid_client` after setting `GOOGLE_CLIENT_ID`**: Older
   `PAZAAK_OAUTH_GOOGLE_*` Wrangler secrets take precedence in `resolveSocialAuthProviderConfig`
   unless both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set — the Worker now prefers that pair
   and ignores conflicting `PAZAAK_OAUTH_GOOGLE_*`. If you still see errors, delete stale secrets:
   `wrangler secret delete PAZAAK_OAUTH_GOOGLE_CLIENT_ID` (and the other `PAZAAK_OAUTH_GOOGLE_*` keys),
   then redeploy.

Without these secrets, the UI correctly shows **Unavailable** / “Not enabled in
this environment.” Local Vite dev falls back to all-disabled when the embedded
API on port `4001` is not running.
