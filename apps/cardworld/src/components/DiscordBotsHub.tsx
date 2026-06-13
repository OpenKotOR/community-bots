import { useEffect, useState } from "react";
import {
  applyModsyncTheme,
  initModsyncTheme,
  type ModsyncThemeId,
} from "@openkotor/modsync-tokens/theme";
import { operatorConsoleRoute, pazaakWorldRoute, qaWebUiRoute } from "../deployRoutes.ts";
import "./discordBotsHub.css";

/** Matches `scripts/discord-install-links.ts` permission integers. */
const INSTALL_TRASK_PERMS = "84992";
const INSTALL_HK_PERMS = "2416266304";
const INSTALL_PAZAAK_PERMS = "19456";

const DEFAULT_REPO_BASE = "https://github.com/OpenKotOR/community-bots";
const DEFAULT_WIKI_BASE = "https://github.com/OpenKotOR/community-bots/wiki";
const DEFAULT_TRASK_INVITE_BASE = "https://trask-worker.bocloud.workers.dev";
const HK_GUIDE_WIKI_SLUG = "docs/guides/hk-86";

const THEME_SEGMENTS: Array<{ id: ModsyncThemeId; label: string; title: string }> = [
  { id: "k1", label: "K1", title: "KOTOR 1 Theme" },
  { id: "tsl", label: "TSL", title: "KOTOR 2: TSL Theme" },
  { id: "light", label: "☀", title: "Light Theme" },
];

function inviteHref(appId: string, permissions: string): string {
  const params = new URLSearchParams({
    client_id: appId,
    permissions,
    scope: "bot applications.commands",
  });
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

function traskInviteHref(appId: string, permissions: string, brokerBaseUrl: string): string {
  if (brokerBaseUrl) {
    const url = new URL("/api/trask/invite", brokerBaseUrl);
    return url.toString();
  }
  return inviteHref(appId, permissions);
}

function trimEnv(value: string | undefined): string {
  return (value ?? "").trim();
}

function ModsyncThemeToolbar({
  theme,
  onChange,
}: {
  theme: ModsyncThemeId;
  onChange: (next: ModsyncThemeId) => void;
}) {
  return (
    <div className="modsync-hub__theme" role="group" aria-label="Theme">
      {THEME_SEGMENTS.map((seg) => (
        <button
          key={seg.id}
          type="button"
          title={seg.title}
          aria-pressed={theme === seg.id}
          className={`modsync-hub__theme-seg${theme === seg.id ? " modsync-hub__theme-seg--active" : ""}`}
          onClick={() => onChange(seg.id)}
        >
          {seg.label}
        </button>
      ))}
    </div>
  );
}

export function DiscordBotsHub() {
  const [theme, setTheme] = useState<ModsyncThemeId>(() => initModsyncTheme(document.documentElement));

  useEffect(() => {
    document.title = "OpenKotOR — Discord bots";
  }, []);

  useEffect(() => {
    applyModsyncTheme(theme, document.documentElement);
  }, [theme]);

  const repoBase = trimEnv(import.meta.env.VITE_REPO_BASE_URL).replace(/\/$/, "") || DEFAULT_REPO_BASE;
  const wikiBase = trimEnv(import.meta.env.VITE_WIKI_BASE_URL).replace(/\/$/, "") || DEFAULT_WIKI_BASE;

  const traskAppId = trimEnv(import.meta.env.VITE_TRASK_DISCORD_APPLICATION_ID);
  const traskInviteBaseUrl =
    trimEnv(import.meta.env.VITE_TRASK_INVITE_BASE_URL || import.meta.env.VITE_TRASK_API_BASE)
    || DEFAULT_TRASK_INVITE_BASE;
  const hkAppId =
    trimEnv(import.meta.env.VITE_HK_DISCORD_APPLICATION_ID) ||
    trimEnv(import.meta.env.VITE_DISCORD_APPLICATION_ID);
  const pazaakAppId = trimEnv(import.meta.env.VITE_PAZAAK_DISCORD_APPLICATION_ID);

  const blob = (path: string) => `${repoBase}/blob/main${path}`;
  const guide = (path: string) => `${blob(path)}#quick-start`;
  const wikiPage = (slug: string) => `${wikiBase}/${slug.replace(/^\/+/, "")}`;

  const traskWebUiHref = qaWebUiRoute();
  const pazaakWebUiHref = pazaakWorldRoute();
  const operatorConsoleHref = operatorConsoleRoute();

  return (
    <div className="discord-bots-hub modsync-hub">
      <div className="modsync-hub__wrap">
        <div className="modsync-hub__toolbar">
          <p className="modsync-hub__eyebrow" style={{ margin: 0 }}>OpenKotOR · Discord bots</p>
          <ModsyncThemeToolbar theme={theme} onChange={setTheme} />
        </div>

        <header className="modsync-hub__hero">
          <h1 className="modsync-hub__title">Discord bots</h1>
          <p className="modsync-hub__lede">
            Invite links, documentation, and quick-start anchors for every Discord bot in this repo. OAuth URLs use the same permission integers as{" "}
            <code>scripts/discord-install-links.ts</code>
            {" "}— set each bot&apos;s application ID at build time so &quot;Invite to server&quot; stays live.
          </p>
        </header>

        <main className="modsync-hub__grid">
          <section className="modsync-hub__card" aria-labelledby="hub-trask-title">
            <div>
              <h2 id="hub-trask-title">Trask</h2>
              <p className="modsync-hub__tagline">
                KOTOR Q&amp;A with citations — use <code>/ask</code> in Discord.
              </p>
            </div>
            <ul className="modsync-hub__actions">
              <li>
                {traskAppId || traskInviteBaseUrl ? (
                  <a
                    className="modsync-hub__btn modsync-hub__btn--primary"
                    href={traskInviteHref(traskAppId, INSTALL_TRASK_PERMS, traskInviteBaseUrl)}
                    rel="noopener noreferrer"
                  >
                    Invite to server
                  </a>
                ) : (
                  <span className="modsync-hub__btn modsync-hub__btn--primary modsync-hub__btn--disabled">Invite to server</span>
                )}
              </li>
              <li>
                <a className="modsync-hub__btn modsync-hub__btn--ghost" href={blob("/docs/guides/trask.md")} rel="noopener noreferrer">
                  Documentation
                </a>
              </li>
              <li>
                <a className="modsync-hub__btn modsync-hub__btn--ghost" href={guide("/docs/guides/trask.md")} rel="noopener noreferrer">
                  Quick start
                </a>
              </li>
              <li>
                <a className="modsync-hub__btn modsync-hub__btn--ghost" href={traskWebUiHref} rel="noopener noreferrer">
                  Holocron Archive
                </a>
              </li>
            </ul>
            {!traskAppId && !traskInviteBaseUrl ? (
              <p className="modsync-hub__callout">
                Set <code>VITE_TRASK_DISCORD_APPLICATION_ID</code> at build time (or GitHub Actions variable <code>TRASK_DISCORD_APP_ID</code>) for the invite URL.
              </p>
            ) : null}
            <p className="modsync-hub__perms">
              Permissions: <code>{INSTALL_TRASK_PERMS}</code>
            </p>
            {traskInviteBaseUrl ? (
              <p className="modsync-hub__note">
                Trask installs are brokered through the public Worker and require an approved Discord guild id.
              </p>
            ) : null}
          </section>

          <section className="modsync-hub__card" aria-labelledby="hub-hk-title">
            <div>
              <h2 id="hub-hk-title">HK-86</h2>
              <p className="modsync-hub__tagline">
                Curated self-assignable roles — <code>/designations</code> and optional reaction panels.
              </p>
            </div>
            <ul className="modsync-hub__actions">
              <li>
                {hkAppId ? (
                  <a
                    className="modsync-hub__btn modsync-hub__btn--primary"
                    href={inviteHref(hkAppId, INSTALL_HK_PERMS)}
                    rel="noopener noreferrer"
                  >
                    Invite to server
                  </a>
                ) : (
                  <span className="modsync-hub__btn modsync-hub__btn--primary modsync-hub__btn--disabled">Invite to server</span>
                )}
              </li>
              <li>
                <a className="modsync-hub__btn modsync-hub__btn--ghost" href={wikiPage(HK_GUIDE_WIKI_SLUG)} rel="noopener noreferrer">
                  Documentation
                </a>
              </li>
              <li>
                <a
                  className="modsync-hub__btn modsync-hub__btn--ghost"
                  href={`${wikiPage(HK_GUIDE_WIKI_SLUG)}#quick-start`}
                  rel="noopener noreferrer"
                >
                  Quick start
                </a>
              </li>
            </ul>
            <p className="modsync-hub__extra">
              <a className="modsync-hub__text-link" href={blob("/apps/hk-bot/reaction-role-panels.example.json")} rel="noopener noreferrer">
                Reaction panels example JSON
              </a>
            </p>
            {!hkAppId ? (
              <p className="modsync-hub__callout">
                Set <code>VITE_HK_DISCORD_APPLICATION_ID</code> or <code>VITE_DISCORD_APPLICATION_ID</code> (or variable <code>HK86_DISCORD_APP_ID</code>) for the invite URL.
              </p>
            ) : null}
            <p className="modsync-hub__perms">
              Permissions: <code>{INSTALL_HK_PERMS}</code>
            </p>
            <p className="modsync-hub__note">
              Reaction-panel-ready HK invite (Manage Roles, reactions, slash). Matches <code>scripts/discord-install-links.ts</code>.
            </p>
            <details className="modsync-hub__details">
              <summary>Operator checklist (reaction panels)</summary>
              <ol className="modsync-hub__steps">
                <li>
                  Put <code>reaction-role-panels.json</code> under the HK data directory (default <code>data/hk-bot/</code>; override with <code>HK_DATA_DIR</code>). Hot reload on file change.
                </li>
                <li>
                  Run <code>/designations reactions help</code> in Discord for the full setup embed.
                </li>
                <li>
                  Use <code>/designations reactions status</code> (Manage Server) to verify config.
                </li>
              </ol>
            </details>
          </section>

          <section className="modsync-hub__card" aria-labelledby="hub-pazaak-title">
            <div>
              <h2 id="hub-pazaak-title">Pazaak Bot</h2>
              <p className="modsync-hub__tagline">
                Pazaak tables, wallets, and challenges — <code>/pazaak</code> commands.
              </p>
            </div>
            <ul className="modsync-hub__actions">
              <li>
                {pazaakAppId ? (
                  <a
                    className="modsync-hub__btn modsync-hub__btn--primary"
                    href={inviteHref(pazaakAppId, INSTALL_PAZAAK_PERMS)}
                    rel="noopener noreferrer"
                  >
                    Invite to server
                  </a>
                ) : (
                  <span className="modsync-hub__btn modsync-hub__btn--primary modsync-hub__btn--disabled">Invite to server</span>
                )}
              </li>
              <li>
                <a className="modsync-hub__btn modsync-hub__btn--ghost" href={blob("/docs/guides/pazaak.md")} rel="noopener noreferrer">
                  Documentation
                </a>
              </li>
              <li>
                <a className="modsync-hub__btn modsync-hub__btn--ghost" href={guide("/docs/guides/pazaak.md")} rel="noopener noreferrer">
                  Quick start
                </a>
              </li>
              <li>
                <a className="modsync-hub__btn modsync-hub__btn--ghost" href={pazaakWebUiHref} rel="noopener noreferrer">
                  Main menu &amp; lobby
                </a>
              </li>
            </ul>
            {!pazaakAppId ? (
              <p className="modsync-hub__callout">
                Set <code>VITE_PAZAAK_DISCORD_APPLICATION_ID</code> at build time (or GitHub Actions variable <code>PAZAAK_DISCORD_APP_ID</code>) for the invite URL.
              </p>
            ) : null}
            <p className="modsync-hub__perms">
              Permissions: <code>{INSTALL_PAZAAK_PERMS}</code>
            </p>
          </section>
        </main>

        <footer className="modsync-hub__foot">
          <span>
            Static hub served from GitHub Pages under <code>{import.meta.env.BASE_URL}</code>. HK operator WebUI remains under{" "}
            <code>{import.meta.env.BASE_URL}hk86/</code>. Ingest worker is not a Discord bot — it has no invite here.
          </span>
          <p className="modsync-hub__console-link">
            <a href={operatorConsoleHref}>Operator console</a> (API probes, deploy notes) lives at the same deploy root as this hub.
          </p>
        </footer>
      </div>
    </div>
  );
}
