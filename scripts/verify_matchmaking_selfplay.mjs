#!/usr/bin/env node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

import { createApiServer } from "../apps/pazaak-bot/dist/api-server.js";
import { PazaakCoordinator } from "../packages/pazaak-engine/dist/index.js";
import {
  JsonPazaakLobbyRepository,
  JsonPazaakMatchHistoryRepository,
  JsonPazaakMatchmakingQueueRepository,
  JsonPazaakSideboardRepository,
  JsonWalletRepository,
} from "../packages/persistence/dist/index.js";

const PORT = 41997;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DISCORD_API_USERS_ME = "https://discord.com/api/v10/users/@me";

const TOKEN_A = "selfplay-token-a";
const TOKEN_B = "selfplay-token-b";

const TOKEN_TO_USER = new Map([
  [TOKEN_A, {
    id: "self-player-a",
    username: "SelfA",
    global_name: "Self A",
    discriminator: "0001",
  }],
  [TOKEN_B, {
    id: "self-player-b",
    username: "SelfB",
    global_name: "Self B",
    discriminator: "0002",
  }],
]);

const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

  if (url === DISCORD_API_USERS_ME) {
    const authHeader = init?.headers && typeof init.headers === "object" && !Array.isArray(init.headers)
      ? init.headers.Authorization ?? init.headers.authorization
      : undefined;

    const token = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : "";

    const user = TOKEN_TO_USER.get(token);

    if (!user) {
      return new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify(user), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  return originalFetch(input, init);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const authHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

const api = async (token, path, { method = "GET", body } = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: authHeaders(token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${path}: ${JSON.stringify(data)}`);
  }

  return data;
};

const tokenForUser = (userId) => {
  if (userId === "self-player-a") return TOKEN_A;
  if (userId === "self-player-b") return TOKEN_B;
  throw new Error(`Unknown user id: ${userId}`);
};

const chooseTurnAction = (match) => {
  const activePlayer = match.players[match.activePlayerIndex];

  if (!activePlayer) {
    throw new Error("Missing active player in match state.");
  }

  if (match.phase === "turn") {
    return { userId: activePlayer.userId, endpoint: `/api/match/${match.id}/draw`, method: "POST" };
  }

  if (match.phase === "after-draw" || match.phase === "after-card") {
    if (activePlayer.total >= 18) {
      return { userId: activePlayer.userId, endpoint: `/api/match/${match.id}/stand`, method: "POST" };
    }

    return { userId: activePlayer.userId, endpoint: `/api/match/${match.id}/endturn`, method: "POST" };
  }

  throw new Error(`Unsupported match phase during self-play: ${match.phase}`);
};

const waitForAutoMatchedGame = async () => {
  const timeoutMs = 20_000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const [meA, meB] = await Promise.all([
      api(TOKEN_A, "/api/me"),
      api(TOKEN_B, "/api/me"),
    ]);

    const matchA = meA?.match;
    const matchB = meB?.match;

    if (matchA?.id && matchA.id === matchB?.id) {
      return matchA;
    }

    await sleep(200);
  }

  throw new Error("Timed out waiting for queue auto-match.");
};

const subscribeForMatchUpdates = async (matchId) => {
  const wsBaseUrl = BASE_URL.replace(/^http/, "ws");
  const WebSocketImpl = globalThis.WebSocket ?? (await import("ws")).WebSocket;
  const ws = new WebSocketImpl(`${wsBaseUrl}/ws?matchId=${encodeURIComponent(matchId)}`);
  let wsUpdateCount = 0;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for websocket open.")), 5_000);
    ws.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve(undefined);
    }, { once: true });
    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Websocket connection failed."));
    }, { once: true });
  });

  ws.addEventListener("message", (event) => {
    try {
      const text = typeof event.data === "string" ? event.data : event.data?.toString?.() ?? "";
      const parsed = JSON.parse(text);
      if (parsed?.type === "match_update" && parsed?.data?.id === matchId) {
        wsUpdateCount += 1;
      }
    } catch {
      // Ignore malformed frames in the harness.
    }
  });

  return {
    close: () => ws.close(),
    getCount: () => wsUpdateCount,
  };
};

const playFullMatch = async (match, label) => {
  const subscription = await subscribeForMatchUpdates(match.id);

  try {
    let turns = 0;
    let current = match;

    while (current.phase !== "completed") {
      turns += 1;
      if (turns > 500) {
        throw new Error(`${label}: exceeded max turn count before completion.`);
      }

      const action = chooseTurnAction(current);
      const actionToken = tokenForUser(action.userId);
      const next = await api(actionToken, action.endpoint, { method: action.method, body: {} });
      current = next.match;
    }

    if (!current.winnerId || !current.loserId) {
      throw new Error(`${label}: completed match is missing winner/loser metadata.`);
    }

    if (subscription.getCount() < 1) {
      throw new Error(`${label}: did not receive websocket match_update events during gameplay.`);
    }

    return {
      match: current,
      turns,
      wsUpdateCount: subscription.getCount(),
    };
  } finally {
    subscription.close();
  }
};

const run = async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pazaak-selfplay-"));

  const walletRepository = new JsonWalletRepository(join(dataDir, "wallets.json"), 1000);
  const sideboardRepository = new JsonPazaakSideboardRepository(join(dataDir, "sideboards.json"));
  const queueRepository = new JsonPazaakMatchmakingQueueRepository(join(dataDir, "queue.json"));
  const lobbyRepository = new JsonPazaakLobbyRepository(join(dataDir, "lobbies.json"));
  const historyRepository = new JsonPazaakMatchHistoryRepository(join(dataDir, "history.json"));

  const coordinator = new PazaakCoordinator(undefined, {
    turnTimeoutMs: 45_000,
    disconnectForfeitMs: 30_000,
  });

  const { server, listen } = createApiServer(coordinator, {
    port: PORT,
    discordAppId: "selfplay-app-id",
    discordClientSecret: undefined,
    activityOrigin: "http://localhost:5173",
    publicWebOrigin: "http://localhost:3000",
    walletRepository,
    sideboardRepository,
    matchmakingQueueRepository: queueRepository,
    lobbyRepository,
    matchHistoryRepository: historyRepository,
    matchmakingTickMs: 250,
  });

  try {
    listen();
    await once(server, "listening");

    console.log("[selfplay] API server listening.");

    // Scenario 1: queue auto-pair daemon creates a match; play it to completion.
    await api(TOKEN_A, "/api/matchmaking/enqueue", { method: "POST", body: { preferredMaxPlayers: 2 } });
    await api(TOKEN_B, "/api/matchmaking/enqueue", { method: "POST", body: { preferredMaxPlayers: 2 } });

    const queueMatch = await waitForAutoMatchedGame();
    console.log(`[selfplay] Queue auto-match created: ${queueMatch.id}`);

    const queueOutcome = await playFullMatch(queueMatch, "queue-match");
    console.log(`[selfplay] Queue match completed in ${queueOutcome.turns} turns with ${queueOutcome.wsUpdateCount} ws updates.`);

    // Scenario 2: explicit lobby flow still works after daemon changes.
    const createdLobby = await api(TOKEN_A, "/api/lobbies", {
      method: "POST",
      body: { name: "Selfplay Table", maxPlayers: 2 },
    });

    const lobbyId = createdLobby?.lobby?.id;

    if (!lobbyId) {
      throw new Error("Failed to create lobby.");
    }

    await api(TOKEN_B, `/api/lobbies/${encodeURIComponent(lobbyId)}/join`, { method: "POST", body: {} });
    await api(TOKEN_A, `/api/lobbies/${encodeURIComponent(lobbyId)}/ready`, { method: "POST", body: { ready: true } });
    await api(TOKEN_B, `/api/lobbies/${encodeURIComponent(lobbyId)}/ready`, { method: "POST", body: { ready: true } });

    const started = await api(TOKEN_A, `/api/lobbies/${encodeURIComponent(lobbyId)}/start`, { method: "POST", body: {} });
    const lobbyMatch = started.match;

    if (!lobbyMatch?.id) {
      throw new Error("Lobby start did not produce a match.");
    }

    const lobbyOutcome = await playFullMatch(lobbyMatch, "lobby-match");
    console.log(`[selfplay] Lobby match completed in ${lobbyOutcome.turns} turns with ${lobbyOutcome.wsUpdateCount} ws updates.`);

    const [historyA, historyB, meA, meB] = await Promise.all([
      api(TOKEN_A, "/api/me/history?limit=10"),
      api(TOKEN_B, "/api/me/history?limit=10"),
      api(TOKEN_A, "/api/me"),
      api(TOKEN_B, "/api/me"),
    ]);

    if (!Array.isArray(historyA.history) || historyA.history.length < 2) {
      throw new Error("History was not recorded for both completed matches (player A).");
    }

    if (!Array.isArray(historyB.history) || historyB.history.length < 2) {
      throw new Error("History was not recorded for both completed matches (player B).");
    }

    console.log("[selfplay] Full matchmaking and lobby lifecycle verification succeeded.");
    console.log(JSON.stringify({
      queueMatch: {
        matchId: queueOutcome.match.id,
        winnerId: queueOutcome.match.winnerId,
        loserId: queueOutcome.match.loserId,
        turns: queueOutcome.turns,
        wsUpdateCount: queueOutcome.wsUpdateCount,
      },
      lobbyMatch: {
        lobbyId,
        matchId: lobbyOutcome.match.id,
        winnerId: lobbyOutcome.match.winnerId,
        loserId: lobbyOutcome.match.loserId,
        turns: lobbyOutcome.turns,
        wsUpdateCount: lobbyOutcome.wsUpdateCount,
      },
      playerA: {
        mmr: meA.wallet?.mmr,
        gamesPlayed: meA.wallet?.gamesPlayed,
        gamesWon: meA.wallet?.gamesWon,
      },
      playerB: {
        mmr: meB.wallet?.mmr,
        gamesPlayed: meB.wallet?.gamesPlayed,
        gamesWon: meB.wallet?.gamesWon,
      },
    }, null, 2));

  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  }
};

run().catch((err) => {
  console.error("[selfplay] FAILED", err);
  process.exitCode = 1;
});
