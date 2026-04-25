import { DiscordSDK, RPCCloseCodes } from "@discord/embedded-app-sdk";

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID as string;
let discordSdk: DiscordSDK | null = null;

export interface DiscordAuth {
  userId: string;
  username: string;
  accessToken: string;
}

/** Returns true when the app is running inside a Discord Activity iframe. */
export const isDiscordActivity = (): boolean => {
  return window.location.href.includes("discordsays.com");
};

const getDiscordSdk = (): DiscordSDK => {
  if (!discordSdk) {
    discordSdk = new DiscordSDK(CLIENT_ID);
  }
  return discordSdk;
};

const parseDevAuth = (): DiscordAuth | null => {
  const url = new URL(window.location.href);
  const devUser = url.searchParams.get("devUser")?.trim();
  if (!devUser) {
    return null;
  }

  const userId = decodeURIComponent(devUser);
  if (!userId) {
    return null;
  }

  const username = (url.searchParams.get("devName")?.trim() || userId).slice(0, 64);
  const accessToken = `dev-user-${encodeURIComponent(userId)}`;

  return {
    userId,
    username,
    accessToken,
  };
};

/**
 * Full Discord Embedded App SDK auth flow:
 * 1. Wait for SDK ready
 * 2. Authorize (gets code)
 * 3. Exchange code for access_token via our bot's /api/auth/token endpoint
 * 4. Authenticate with SDK (validates token, populates SDK user)
 */
export async function initDiscordAuth(): Promise<DiscordAuth> {
  const devAuth = parseDevAuth();
  if (devAuth) {
    return devAuth;
  }

  if (!isDiscordActivity()) {
    throw new Error("This page is not running inside Discord Activity. Add ?devUser=<id>&devName=<name> for local browser testing.");
  }

  const sdk = getDiscordSdk();

  await sdk.ready();

  // Step 1: Get authorization code.
  const { code } = await sdk.commands.authorize({
    client_id: CLIENT_ID,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify"],
  });

  // Step 2: Exchange the code for an access token via our API (keeps client_secret server-side).
  const tokenRes = await fetch("/api/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });

  if (!tokenRes.ok) {
    const err = (await tokenRes.json()) as { error?: string };
    throw new Error(`Token exchange failed: ${err.error ?? tokenRes.statusText}`);
  }

  const { access_token } = (await tokenRes.json()) as { access_token: string };

  // Step 3: Authenticate the SDK with the access token.
  const auth = await sdk.commands.authenticate({ access_token });

  return {
    userId: auth.user.id,
    username: auth.user.username,
    accessToken: access_token,
  };
}

export function closeActivity(reason = "Player exited"): void {
  if (!isDiscordActivity()) {
    return;
  }
  getDiscordSdk().close(RPCCloseCodes.CLOSE_NORMAL, reason);
}
