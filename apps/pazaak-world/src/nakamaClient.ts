import { Client, Session } from "@heroiclabs/nakama-js";

const CRED_PREFIX = "nk1.";

export function isNakamaBackend(): boolean {
  const flag = String(import.meta.env.VITE_PAZAAK_BACKEND ?? "").toLowerCase().trim();
  if (flag === "nakama") return true;
  if (flag === "legacy" || flag === "worker" || flag === "http") return false;
  return Boolean(String(import.meta.env.VITE_NAKAMA_HOST ?? "").trim());
}

function nakamaHost(): string {
  return String(import.meta.env.VITE_NAKAMA_HOST ?? "127.0.0.1").trim() || "127.0.0.1";
}

function nakamaPort(): string {
  return String(import.meta.env.VITE_NAKAMA_PORT ?? "7350").trim() || "7350";
}

function nakamaServerKey(): string {
  return String(import.meta.env.VITE_NAKAMA_SERVER_KEY ?? "defaultkey").trim() || "defaultkey";
}

function nakamaUseSsl(): boolean {
  const raw = String(import.meta.env.VITE_NAKAMA_USE_SSL ?? "").toLowerCase().trim();
  return raw === "1" || raw === "true" || raw === "yes";
}

let clientSingleton: Client | null = null;

export function getNakamaClient(): Client {
  if (!clientSingleton) {
    clientSingleton = new Client(nakamaServerKey(), nakamaHost(), nakamaPort(), nakamaUseSsl());
  }
  return clientSingleton;
}

export function encodeNakamaCredential(session: Session): string {
  const payload = JSON.stringify({ t: session.token, r: session.refresh_token });
  return CRED_PREFIX + btoa(payload);
}

/** Standalone / dev placeholder sessions — not a real HTTP API bearer from login or Discord. */
export function isGuestLikeAccessToken(token: string | null | undefined): boolean {
  if (!token) return false;
  return token.startsWith("local-guest-token:") || token.startsWith("dev-user-");
}

/** Stable alphanumeric id passed to `authenticateDevice` for local `guest-*` profiles. */
export function nakamaGuestDeviceId(stableAccountId: string): string {
  return stableAccountId.replace(/^guest-/iu, "").replace(/[^a-zA-Z0-9]/gu, "");
}

/** Display username for Nakama (letters/digits/underscore); keep distinct from other users' bare-hex names. */
export function nakamaGuestUsername(stableAccountId: string): string {
  return stableAccountId.replace(/[^a-zA-Z0-9_]/gu, "_").slice(0, 32);
}

export function tryDecodeNakamaCredential(accessToken: string): Session | null {
  if (!accessToken.startsWith(CRED_PREFIX)) return null;
  try {
    const parsed = JSON.parse(atob(accessToken.slice(CRED_PREFIX.length))) as { t?: string; r?: string };
    if (typeof parsed.t === "string" && typeof parsed.r === "string") {
      return Session.restore(parsed.t, parsed.r);
    }
  } catch {
    return null;
  }
  return null;
}

/** nakama-js surfaces failed HTTP as `Response`; normalize so callers never stringify to "[object Response]". */
export async function nakamaAsError(err: unknown, label: string): Promise<Error> {
  if (err instanceof Error) return err;
  if (err instanceof Response) {
    const body = await err.text().catch(() => "");
    const trimmed = body.trim();
    return new Error(
      trimmed
        ? `${label}: HTTP ${err.status} ${trimmed.slice(0, 400)}`
        : `${label}: HTTP ${err.status} ${err.statusText || ""}`.trim(),
    );
  }
  if (err && typeof err === "object") {
    const anyErr = err as { message?: unknown; code?: unknown };
    if (typeof anyErr.message === "string") {
      const codePart = typeof anyErr.code === "number" || typeof anyErr.code === "string" ? ` (code ${String(anyErr.code)})` : "";
      return new Error(`${label}: ${anyErr.message}${codePart}`);
    }
    try {
      return new Error(`${label}: ${JSON.stringify(err).slice(0, 400)}`);
    } catch {
      // fall through to generic string conversion
    }
  }
  return new Error(`${label}: ${String(err)}`);
}

export async function ensureNakamaSession(
  accessToken: string,
  username: string,
  stableAccountId: string,
): Promise<Session> {
  const decoded = tryDecodeNakamaCredential(accessToken);
  if (decoded) {
    const now = Math.floor(Date.now() / 1000);
    try {
      if (!decoded.isexpired(now)) return decoded;
      return await getNakamaClient().sessionRefresh(decoded);
    } catch (err) {
      throw await nakamaAsError(err, "Nakama sessionRefresh");
    }
  }

  const client = getNakamaClient();
  const guestLike = isGuestLikeAccessToken(accessToken);
  /** Nakama device IDs should be alphanumeric; local `guest-<uuid>` ids include hyphens and can break account creation. */
  const deviceId = guestLike ? nakamaGuestDeviceId(stableAccountId) : stableAccountId;
  try {
    if (guestLike) {
      /**
       * Do not force a username for device auth. Reusing a prior device id with a stale/truncated username
       * can trigger HTTP 409 "Username is already in use" and prevent bootstrapping in fresh browser contexts.
       */
      return await client.authenticateDevice(deviceId, true);
    }
    return await client.authenticateCustom(`openkotor:${stableAccountId}`, true, username);
  } catch (err) {
    throw await nakamaAsError(err, guestLike ? "Nakama authenticateDevice" : "Nakama authenticateCustom");
  }
}

export interface ActivitySessionLike {
  userId: string;
  username: string;
  accessToken: string;
}

export async function bootstrapNakamaActivitySession(activity: ActivitySessionLike): Promise<ActivitySessionLike> {
  if (!isNakamaBackend()) return activity;
  const session = await ensureNakamaSession(activity.accessToken, activity.username, activity.userId);
  const userId = session.user_id ?? activity.userId;
  return {
    ...activity,
    userId,
    accessToken: encodeNakamaCredential(session),
  };
}

export async function sessionFromPazaakAccessToken(accessToken: string): Promise<Session> {
  const decoded = tryDecodeNakamaCredential(accessToken);
  if (!decoded) {
    throw new Error("Missing Nakama session. Reload and sign in again.");
  }
  const now = Math.floor(Date.now() / 1000);
  if (!decoded.isexpired(now)) return decoded;
  try {
    return await getNakamaClient().sessionRefresh(decoded);
  } catch (err) {
    throw await nakamaAsError(err, "Nakama sessionRefresh");
  }
}

export async function nakamaRpc<T extends object>(accessToken: string, rpcId: string, payload: object): Promise<T> {
  try {
    const session = await sessionFromPazaakAccessToken(accessToken);
    const res = await getNakamaClient().rpc(session, rpcId, payload);
    return (res.payload ?? {}) as T;
  } catch (err) {
    throw await nakamaAsError(err, `Nakama RPC ${rpcId}`);
  }
}
