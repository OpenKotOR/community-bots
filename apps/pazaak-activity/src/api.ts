import type {
  AdvisorDifficulty,
  LeaderboardEntry,
  MatchmakingQueueRecord,
  PazaakLobbyRecord,
  PazaakMatchHistoryRecord,
  PazaakUserSettings,
  SavedSideboardCollectionRecord,
  SerializedMatch,
  SideCardOption,
  WalletRecord,
} from "./types.ts";

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });

  const body = await res.json() as Record<string, unknown>;

  if (!res.ok) {
    throw new Error((body["error"] as string | undefined) ?? `HTTP ${res.status}`);
  }

  return body as T;
}

// ---------------------------------------------------------------------------
// Public API client
// ---------------------------------------------------------------------------

export interface MatchResponse {
  match: SerializedMatch;
}

export interface SideboardsResponse {
  sideboards: SavedSideboardCollectionRecord;
}

export interface MeResponse {
  user: { id: string; username: string; displayName: string };
  wallet: WalletRecord;
  queue: MatchmakingQueueRecord | null;
  match: SerializedMatch | null;
}

export interface SettingsResponse {
  settings: PazaakUserSettings;
  wallet?: WalletRecord;
}

export interface LeaderboardResponse {
  leaders: LeaderboardEntry[];
}

export interface HistoryResponse {
  history: PazaakMatchHistoryRecord[];
}

export interface QueueResponse {
  queue: MatchmakingQueueRecord | null;
}

export interface LobbiesResponse {
  lobbies: PazaakLobbyRecord[];
}

export interface LobbyResponse {
  lobby: PazaakLobbyRecord | null;
  match?: SerializedMatch;
}

export async function fetchMe(accessToken: string): Promise<MeResponse> {
  return apiFetch<MeResponse>("/api/me", accessToken);
}

export async function fetchSettings(accessToken: string): Promise<PazaakUserSettings> {
  const data = await apiFetch<SettingsResponse>("/api/settings", accessToken);
  return data.settings;
}

export async function updateSettings(
  accessToken: string,
  settings: Partial<PazaakUserSettings>,
): Promise<PazaakUserSettings> {
  const data = await apiFetch<SettingsResponse>("/api/settings", accessToken, {
    method: "PUT",
    body: JSON.stringify(settings),
  });
  return data.settings;
}

export async function fetchLeaderboard(accessToken: string): Promise<LeaderboardEntry[]> {
  const data = await apiFetch<LeaderboardResponse>("/api/leaderboard", accessToken);
  return data.leaders;
}

export async function fetchHistory(accessToken: string, limit = 25): Promise<PazaakMatchHistoryRecord[]> {
  const data = await apiFetch<HistoryResponse>(`/api/me/history?limit=${encodeURIComponent(String(limit))}`, accessToken);
  return data.history;
}

export async function enqueueMatchmaking(accessToken: string, preferredMaxPlayers = 2): Promise<MatchmakingQueueRecord | null> {
  const data = await apiFetch<QueueResponse>("/api/matchmaking/enqueue", accessToken, {
    method: "POST",
    body: JSON.stringify({ preferredMaxPlayers }),
  });
  return data.queue;
}

export async function leaveMatchmaking(accessToken: string): Promise<boolean> {
  const data = await apiFetch<{ removed: boolean }>("/api/matchmaking/leave", accessToken, { method: "POST" });
  return data.removed;
}

export async function fetchMatchmakingStatus(accessToken: string): Promise<MatchmakingQueueRecord | null> {
  const data = await apiFetch<QueueResponse>("/api/matchmaking/status", accessToken);
  return data.queue;
}

export async function fetchLobbies(accessToken: string): Promise<PazaakLobbyRecord[]> {
  const data = await apiFetch<LobbiesResponse>("/api/lobbies", accessToken);
  return data.lobbies;
}

export async function createLobby(
  accessToken: string,
  input: { name?: string; maxPlayers?: number; password?: string },
): Promise<PazaakLobbyRecord> {
  const data = await apiFetch<LobbyResponse>("/api/lobbies", accessToken, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!data.lobby) throw new Error("Lobby was not created.");
  return data.lobby;
}

export async function joinLobby(accessToken: string, lobbyId: string, password?: string): Promise<PazaakLobbyRecord> {
  const data = await apiFetch<LobbyResponse>(`/api/lobbies/${encodeURIComponent(lobbyId)}/join`, accessToken, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  if (!data.lobby) throw new Error("Lobby was not joined.");
  return data.lobby;
}

export async function setLobbyReady(accessToken: string, lobbyId: string, ready: boolean): Promise<PazaakLobbyRecord> {
  const data = await apiFetch<LobbyResponse>(`/api/lobbies/${encodeURIComponent(lobbyId)}/ready`, accessToken, {
    method: "POST",
    body: JSON.stringify({ ready }),
  });
  if (!data.lobby) throw new Error("Lobby was not updated.");
  return data.lobby;
}

export async function addLobbyAi(accessToken: string, lobbyId: string, difficulty: AdvisorDifficulty): Promise<PazaakLobbyRecord> {
  const data = await apiFetch<LobbyResponse>(`/api/lobbies/${encodeURIComponent(lobbyId)}/addAi`, accessToken, {
    method: "POST",
    body: JSON.stringify({ difficulty }),
  });
  if (!data.lobby) throw new Error("AI seat was not added.");
  return data.lobby;
}

export async function leaveLobby(accessToken: string, lobbyId: string): Promise<PazaakLobbyRecord | null> {
  const data = await apiFetch<LobbyResponse>(`/api/lobbies/${encodeURIComponent(lobbyId)}/leave`, accessToken, { method: "POST" });
  return data.lobby;
}

export async function startLobby(accessToken: string, lobbyId: string): Promise<{ lobby: PazaakLobbyRecord; match: SerializedMatch }> {
  const data = await apiFetch<LobbyResponse>(`/api/lobbies/${encodeURIComponent(lobbyId)}/start`, accessToken, { method: "POST" });
  if (!data.lobby || !data.match) throw new Error("Lobby did not start a match.");
  return { lobby: data.lobby, match: data.match };
}

/** Fetch the caller's active match, or null if none exists. */
export async function fetchMyMatch(accessToken: string): Promise<SerializedMatch | null> {
  try {
    const data = await apiFetch<MatchResponse>("/api/match/me", accessToken);
    return data.match;
  } catch (err) {
    if (err instanceof Error && err.message.includes("No active match")) return null;
    throw err;
  }
}

/** Fetch a match by ID. */
export async function fetchMatch(matchId: string, accessToken: string): Promise<SerializedMatch | null> {
  try {
    const data = await apiFetch<MatchResponse>(`/api/match/${matchId}`, accessToken);
    return data.match;
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) return null;
    throw err;
  }
}

export async function fetchSideboards(accessToken: string): Promise<SavedSideboardCollectionRecord> {
  const data = await apiFetch<SideboardsResponse>("/api/sideboards", accessToken);
  return data.sideboards;
}

export async function saveSideboard(
  name: string,
  tokens: string[],
  accessToken: string,
  makeActive = true,
): Promise<SavedSideboardCollectionRecord> {
  const data = await apiFetch<SideboardsResponse>(`/api/sideboards/${encodeURIComponent(name)}`, accessToken, {
    method: "PUT",
    body: JSON.stringify({ tokens, makeActive }),
  });
  return data.sideboards;
}

export async function setActiveSideboard(name: string, accessToken: string): Promise<SavedSideboardCollectionRecord> {
  const data = await apiFetch<SideboardsResponse>("/api/sideboards/active", accessToken, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return data.sideboards;
}

export async function deleteSideboard(name: string, accessToken: string): Promise<SavedSideboardCollectionRecord> {
  const data = await apiFetch<SideboardsResponse>(`/api/sideboards/${encodeURIComponent(name)}`, accessToken, {
    method: "DELETE",
  });
  return data.sideboards;
}

export async function draw(matchId: string, accessToken: string): Promise<SerializedMatch> {
  const data = await apiFetch<MatchResponse>(`/api/match/${matchId}/draw`, accessToken, { method: "POST" });
  return data.match;
}

export async function stand(matchId: string, accessToken: string): Promise<SerializedMatch> {
  const data = await apiFetch<MatchResponse>(`/api/match/${matchId}/stand`, accessToken, { method: "POST" });
  return data.match;
}

export async function endTurn(matchId: string, accessToken: string): Promise<SerializedMatch> {
  const data = await apiFetch<MatchResponse>(`/api/match/${matchId}/endturn`, accessToken, { method: "POST" });
  return data.match;
}

export async function playSideCard(
  matchId: string,
  accessToken: string,
  option: SideCardOption,
): Promise<SerializedMatch> {
  const data = await apiFetch<MatchResponse>(`/api/match/${matchId}/play`, accessToken, {
    method: "POST",
    body: JSON.stringify({ cardId: option.cardId, appliedValue: option.appliedValue }),
  });
  return data.match;
}

export async function forfeit(matchId: string, accessToken: string): Promise<SerializedMatch> {
  const data = await apiFetch<MatchResponse>(`/api/match/${matchId}/forfeit`, accessToken, { method: "POST" });
  return data.match;
}

// ---------------------------------------------------------------------------
// WebSocket subscription
// ---------------------------------------------------------------------------

export type MatchUpdateHandler = (match: SerializedMatch) => void;

interface WsMessage {
  type: "match_update";
  data: SerializedMatch;
}

/**
 * Opens a WebSocket connection that listens for live match updates.
 * Returns an unsubscribe function.
 */
export function subscribeToMatch(matchId: string, onUpdate: MatchUpdateHandler): () => void {
  const wsBase = window.location.origin.replace(/^http/, "ws");
  const ws = new WebSocket(`${wsBase}/ws?matchId=${encodeURIComponent(matchId)}`);

  ws.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data as string) as WsMessage;
      if (msg.type === "match_update") {
        onUpdate(msg.data);
      }
    } catch {
      // Ignore malformed messages.
    }
  });

  return () => ws.close();
}
