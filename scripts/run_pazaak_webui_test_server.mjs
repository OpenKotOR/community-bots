#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { createApiServer } from "../apps/pazaak-bot/dist/api-server.js";
import { PazaakCoordinator } from "../packages/pazaak-engine/dist/index.js";
import {
  JsonPazaakLobbyRepository,
  JsonPazaakMatchHistoryRepository,
  JsonPazaakMatchmakingQueueRepository,
  JsonPazaakSideboardRepository,
  JsonWalletRepository,
} from "../packages/persistence/dist/index.js";

const port = Number(process.env.PAZAAK_API_PORT ?? "4001");
const dataDir = resolve(process.env.PAZAAK_WEBUI_TEST_DATA_DIR ?? "data/pazaak-webui-test");

await mkdir(dataDir, { recursive: true });

const walletRepository = new JsonWalletRepository(resolve(dataDir, "wallets.json"), 1000);
const sideboardRepository = new JsonPazaakSideboardRepository(resolve(dataDir, "sideboards.json"));
const queueRepository = new JsonPazaakMatchmakingQueueRepository(resolve(dataDir, "queue.json"));
const lobbyRepository = new JsonPazaakLobbyRepository(resolve(dataDir, "lobbies.json"));
const historyRepository = new JsonPazaakMatchHistoryRepository(resolve(dataDir, "history.json"));

const coordinator = new PazaakCoordinator(undefined, {
  turnTimeoutMs: 45_000,
  disconnectForfeitMs: 30_000,
});

const { server, listen } = createApiServer(coordinator, {
  port,
  discordAppId: "local-dev",
  discordClientSecret: undefined,
  activityOrigin: "http://localhost:5173",
  publicWebOrigin: "http://localhost:5173",
  walletRepository,
  sideboardRepository,
  matchmakingQueueRepository: queueRepository,
  lobbyRepository,
  matchHistoryRepository: historyRepository,
  matchmakingTickMs: 250,
  allowDevAuth: true,
});

listen();

const shutdown = () => {
  server.close(() => {
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`[webui-test] API server listening on http://localhost:${port}`);
console.log("[webui-test] Use tokens like Bearer dev-user-player-a via the frontend ?devUser=player-a query parameter.");
