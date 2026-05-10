# PazaakWorld OAuth — Google, Discord, and GitHub

This guide documents **every supported surface** for social login used by PazaakWorld: the **embedded Pazaak bot HTTP API** (local/prod Node process) and the **Cloudflare Worker** fallback (`infra/pazaak-matchmaking-worker`). It is meant to be **operator-complete**: provider consoles, redirect URIs, secret names, precedence rules, CI wiring, verification commands, and common failures.

---

## 1. Concepts

### 1.1 Where OAuth runs

| Backend | Typical URL | Role |
|--------|-------------|------|
| **Pazaak bot** (`apps/pazaak-bot`, `api-server.ts`) | `http://localhost:4001` in dev; public URL in prod | Full-featured API; reads `PAZAAK_OAUTH_*` from **process env** (`.env`). |
| **Cloudflare Worker** | `https://<your-worker>.<subdomain>.workers.dev` | Public auth/session fallback; reads OAuth-related **Wrangler secrets** and `[vars]` from `wrangler.toml`. |

The **browser never receives OAuth client secrets**. It calls JSON endpoints such as `GET /api/auth/oauth/providers` and `POST /api/auth/oauth/<provider>/start`; only **client IDs** appear in redirect URLs (that is normal).

### 1.2 What the UI checks

The auth modal enables a provider only when the backend reports **`enabled: true`** for that provider on:

```http
GET /api/auth/oauth/providers
```

Response shape (abbreviated):

```json
{
  "providers": [
    { "provider": "discord", "enabled": false },
    { "provider": "github", "enabled": false },
    { "provider": "google", "enabled": false }
  ]
}
```

`enabled` is **`true` only when both** an OAuth **client ID** and **client secret** resolve for that provider on **whichever API origin answers first** (`VITE_LEGACY_HTTP_ORIGIN` / `VITE_API_BASES`; see `apps/pazaak-world/src/api.ts` and `docs/pazaak-world-hosting.md`).

### 1.3 Redirect URI modes (critical)

OAuth providers require **exact** redirect URI registration. You must use the URI that matches **the host actually handling** `/api/auth/oauth/<provider>/callback`.

| Scenario | Callback URL pattern |
|----------|----------------------|
| **Worker is the API** (typical for GitHub Pages + `PAZAAK_API_BASES`) | `https://<worker-host>/api/auth/oauth/google/callback` (and `/discord/`, `/github/`). |
| **Embedded bot is the API** (public bot URL or localhost) | `https://<bot-origin>/api/auth/oauth/<provider>/callback` or `http://localhost:4001/api/auth/oauth/<provider>/callback`. |
| **GitHub Pages static host only** | Does **not** execute OAuth callbacks itself — do **not** register only the Pages URL unless something **proxies** `/api` to an API that accepts that path (unusual). |

The published game shell lives at:

`https://openkotor.github.io/community-bots/pazaakworld`

…but successful OAuth **code exchange** still hits your **Worker or bot** origin unless you run a reverse proxy that forwards `/api` under that exact host/path.

After login, the Worker redirects users back to the SPA using **`PUBLIC_WEB_ORIGIN`** (`wrangler.toml` `[vars]`) so tokens arrive as query parameters on the static site.

### 1.4 Scopes (implemented in code)

Defined in `@openkotor/platform` (`buildSocialAuthAuthorizeUrl`):

| Provider | OAuth scopes |
|----------|----------------|
| Google | `openid profile email` |
| Discord | `identify email` |
| GitHub | `read:user user:email` |

---

## 2. Environment variable naming and precedence

### 2.1 Shared resolution (`@openkotor/platform`)

`resolveSocialAuthProviderConfig` (see `packages/platform/src/oauth.ts`) loads:

1. **`PAZAAK_SOCIAL_AUTH_PROVIDER_ENV_MAP`** keys first (`PAZAAK_OAUTH_GOOGLE_CLIENT_ID`, …).
2. Then **fallback** names from **`DEFAULT_SOCIAL_AUTH_PROVIDER_ENV_MAP`** (`GOOGLE_CLIENT_ID`, `DISCORD_CLIENT_ID`, `GITHUB_CLIENT_ID`, …).

So **`PAZAAK_OAUTH_*` wins over bare `GOOGLE_*` / `DISCORD_*` / `GITHUB_*`** when both are present — unless the Worker-specific logic below overrides that for Google/GitHub.

### 2.2 Pazaak bot (`apps/pazaak-bot`)

Uses `PAZAAK_SOCIAL_AUTH_PROVIDER_ENV_MAP` plus Discord fallbacks to **`PAZAAK_DISCORD_APP_ID`** / **`PAZAAK_DISCORD_CLIENT_SECRET`** when Discord OAuth keys are omitted (`api-server.ts`).

### 2.3 Cloudflare Worker (`infra/pazaak-matchmaking-worker`)

Implementation: `resolveOauthProviderConfig` in `src/index.ts`.

| Provider | Behavior |
|----------|-----------|
| **Google** | If **`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`** are both non-empty, **`PAZAAK_OAUTH_GOOGLE_*` keys are ignored** for resolution so stale Wrangler secrets cannot shadow the standard `GOOGLE_*` pair (fixes Google `invalid_client` when you rotated secrets). |
| **GitHub** | Same: complete **`GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET`** pair ignores **`PAZAAK_OAUTH_GITHUB_*`**. |
| **Discord** | **No** Google-style merge. Order remains: `PAZAAK_OAUTH_DISCORD_*` → `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` → optional **`PAZAAK_DISCORD_APP_ID`** (ID) and **`PAZAAK_DISCORD_CLIENT_SECRET`** (secret). Stale **`PAZAAK_OAUTH_DISCORD_*`** can still override good **`DISCORD_*`** — delete conflicting secrets if needed. |

---

## 3. Google OAuth

### 3.1 Google Cloud Console

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select the correct **project**.
2. **APIs & Services → OAuth consent screen** — configure user type (often **External** for testing), app name, support email, and **test users** if the app is in **Testing**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
4. Application type: **Web application**.
5. **Authorized redirect URIs** — add **exactly** the callback for the API that will handle the exchange:
   - Worker API (replace host if yours differs):
     `https://pazaak-matchmaking.bocloud.workers.dev/api/auth/oauth/google/callback`
   - Local bot:
     `http://localhost:4001/api/auth/oauth/google/callback`
   - Only add the GitHub Pages–style path if your deployment truly serves OAuth at that URL (usually **not** for Worker-only setups).

Copy **Client ID** and **Client secret** from this credential.

### 3.2 Store secrets — Worker (Wrangler)

From repo root:

```bash
pnpm dlx wrangler@4.87.0 secret put GOOGLE_CLIENT_ID --config infra/pazaak-matchmaking-worker/wrangler.toml
pnpm dlx wrangler@4.87.0 secret put GOOGLE_CLIENT_SECRET --config infra/pazaak-matchmaking-worker/wrangler.toml
```

Interactive stdin — avoid pasting secrets into chat or committing them.

Optional explicit redirect override (usually unnecessary on Worker): `GOOGLE_REDIRECT_URI` secret.

### 3.3 Store secrets — GitHub Actions → Worker

Repository **Settings → Secrets and variables → Actions → Secrets**:

| Repository secret | Mapped Worker secret (see `.github/workflows/pazaak-matchmaking-worker.yml`) |
|-------------------|-------------------------------------------------------------------------------|
| `WORKER_GOOGLE_CLIENT_ID` | `GOOGLE_CLIENT_ID` |
| `WORKER_GOOGLE_CLIENT_SECRET` | `GOOGLE_CLIENT_SECRET` |

After setting secrets, run the **Deploy Pazaak Matchmaking Worker** workflow (or push to `main` under configured paths). The workflow deploys the Worker, then runs optional `wrangler secret put` steps when values exist.

### 3.4 Store secrets — Pazaak bot (local / server `.env`)

Use `PAZAAK_OAUTH_GOOGLE_CLIENT_ID`, `PAZAAK_OAUTH_GOOGLE_CLIENT_SECRET`, and callback URL consistent with where the bot is reachable. See `docs/setup.md` § Pazaak World.

### 3.5 Troubleshooting Google `401 invalid_client`

| Symptom | Likely cause | Mitigation |
|---------|----------------|------------|
| **OAuth client was not found** | Wrong or deleted **client ID** in Cloudflare secrets, or stale **`PAZAAK_OAUTH_GOOGLE_CLIENT_ID`** overriding **`GOOGLE_CLIENT_ID`**. | Confirm Client ID in GCP matches the ID used at runtime; delete stale **`PAZAAK_OAUTH_GOOGLE_*`** Wrangler secrets if you standardize on **`GOOGLE_*`**; redeploy Worker. |
| **Redirect URI mismatch** | Redirect in GCP does not match **`redirect_uri`** sent in the token exchange (Worker hostname vs Pages hostname). | Register the **Worker** callback URL on the Web client used by the Worker. |
| Consent screen blocks users | App in **Testing** and user not listed as test user. | Add test users or publish consent screen per Google policy. |

---

## 4. Discord OAuth

### 4.1 Discord Developer Portal

1. Open [Discord Developer Portal — Applications](https://discord.com/developers/applications).
2. Select or create the application (often the same app as the **Pazaak Discord bot**).
3. **OAuth2 → Redirects** — add **exactly**:
   - Worker:
     `https://pazaak-matchmaking.bocloud.workers.dev/api/auth/oauth/discord/callback`
   - Local bot:
     `http://localhost:4001/api/auth/oauth/discord/callback`
4. Save.

### 4.2 Credentials

- **Client ID** = **Application ID** (shown under **General Information** and OAuth2).
- **Client Secret** = **OAuth2 → Client Secret** (reset/copy). **Not** the bot token.

### 4.3 Store secrets — Worker (Wrangler)

```bash
pnpm dlx wrangler@4.87.0 secret put DISCORD_CLIENT_ID --config infra/pazaak-matchmaking-worker/wrangler.toml
pnpm dlx wrangler@4.87.0 secret put DISCORD_CLIENT_SECRET --config infra/pazaak-matchmaking-worker/wrangler.toml
```

Optional: `DISCORD_REDIRECT_URI` if Discord requires an explicit redirect env in your setup.

### 4.4 Store secrets — GitHub Actions → Worker

| Repository secret | Worker secret |
|-------------------|---------------|
| `WORKER_DISCORD_CLIENT_ID` | `DISCORD_CLIENT_ID` |
| `WORKER_DISCORD_CLIENT_SECRET` | `DISCORD_CLIENT_SECRET` |

### 4.5 Store secrets — Pazaak bot (`.env`)

Prefer `PAZAAK_OAUTH_DISCORD_CLIENT_ID` / `PAZAAK_OAUTH_DISCORD_CLIENT_SECRET`, or rely on fallbacks **`PAZAAK_DISCORD_APP_ID`** + **`PAZAAK_DISCORD_CLIENT_SECRET`** per `docs/setup.md`.

### 4.6 Troubleshooting Discord

| Issue | Fix |
|-------|-----|
| **invalid_redirect_uri** | Redirect in portal must match Worker/bot callback **exactly**. |
| **`enabled: false`** after setting secrets | Both ID and secret required; confirm OAuth **client secret**, not bot token. |
| Wrong account behavior | Stale **`PAZAAK_OAUTH_DISCORD_*`** may override **`DISCORD_*`** — delete obsolete **`PAZAAK_OAUTH_DISCORD_*`** secrets on the Worker if switching naming schemes. |

---

## 5. GitHub OAuth

### 5.1 Create a GitHub OAuth App

1. GitHub **Settings** (user or org) → **Developer settings** → **OAuth Apps** → **New OAuth App**.
2. **Homepage URL**: e.g. `https://openkotor.github.io/community-bots/pazaakworld`.
3. **Authorization callback URL** (Worker example):
   `https://pazaak-matchmaking.bocloud.workers.dev/api/auth/oauth/github/callback`
4. Register application.
5. Copy **Client ID**; under **Client secrets**, generate and copy a **new client secret** (shown once).

### 5.2 Store secrets — Worker (Wrangler)

```bash
pnpm dlx wrangler@4.87.0 secret put GITHUB_CLIENT_ID --config infra/pazaak-matchmaking-worker/wrangler.toml
pnpm dlx wrangler@4.87.0 secret put GITHUB_CLIENT_SECRET --config infra/pazaak-matchmaking-worker/wrangler.toml
```

### 5.3 Store secrets — GitHub Actions → Worker

| Repository secret | Worker secret |
|-------------------|---------------|
| `WORKER_GITHUB_CLIENT_ID` | `GITHUB_CLIENT_ID` |
| `WORKER_GITHUB_CLIENT_SECRET` | `GITHUB_CLIENT_SECRET` |

### 5.4 Troubleshooting GitHub

| Issue | Fix |
|-------|-----|
| Redirect URI mismatch | Callback URL in the OAuth App must match the Worker (or bot) callback exactly. |
| **`enabled: false`** | Both `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` must exist on the Worker. |

---

## 6. Deploy and verify

### 6.1 Deploy Worker

```bash
pnpm dlx wrangler@4.87.0 deploy --config infra/pazaak-matchmaking-worker/wrangler.toml
```

Or rely on `.github/workflows/pazaak-matchmaking-worker.yml` (requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets).

### 6.2 Verify provider flags

```bash
curl -sS "https://<worker-host>/api/auth/oauth/providers"
```

Expect `"enabled": true` for each configured provider.

### 6.3 Verify start endpoints (optional)

Replace origin and path prefix as needed:

```bash
curl -sS -X POST "https://<worker-host>/api/auth/oauth/google/start" -H "Content-Type: application/json" -d "{}"
curl -sS -X POST "https://<worker-host>/api/auth/oauth/discord/start" -H "Content-Type: application/json" -d "{}"
curl -sS -X POST "https://<worker-host>/api/auth/oauth/github/start" -H "Content-Type: application/json" -d "{}"
```

Each should return JSON including a **`redirectUrl`**.

### 6.4 Local bot checklist

Use `corepack pnpm check:pazaak-oauth` and `curl http://localhost:4001/api/auth/oauth/providers` as documented in `docs/setup.md`.

---

## 7. Frontend / CI variables (no secrets)

GitHub Pages build (`.github/workflows/deploy-pazaakworld.yml`) injects **`VITE_API_BASES`** from repository variable **`PAZAAK_API_BASES`** and optional **`VITE_LEGACY_HTTP_ORIGIN`**. These must point the SPA at an origin that serves **`/api/auth/oauth/*`**. See `docs/pazaak-world-hosting.md`.

**Never** put OAuth client **secrets** in any `VITE_*` variable.

---

## 8. Security summary

- Treat OAuth client secrets like passwords; rotate if exposed.
- Prefer **repository Actions secrets** + **`wrangler secret put`** over committing `.env` files with production secrets.
- Restrict Discord/Google/GitHub OAuth apps to the minimal redirect URIs you actually use.

---

## 9. Related docs

- **Local bot env and quick checklist**: [`setup.md`](setup.md) (§ Pazaak World, OAuth).
- **Hosting, failover, `VITE_API_BASES`**: [`pazaak-world-hosting.md`](pazaak-world-hosting.md).
- **Worker bundle and ops**: [`../infra/pazaak-matchmaking-worker/README.md`](../infra/pazaak-matchmaking-worker/README.md).
