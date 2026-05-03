import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadTraskHttpServerConfig } from "@openkotor/config";
import { createLogger } from "@openkotor/core";
import { JsonTraskQueryRepository, resolveDataFile } from "@openkotor/persistence";
import {
  buildBrowserCorsAllowedOrigins,
  createNodeApiHost,
  resolveCorsHeaders,
} from "@openkotor/platform";
import { createDefaultSearchProvider } from "@openkotor/retrieval";
import { createResearchWizardClient } from "@openkotor/trask";
import { createTraskHttpRouter, type TraskHttpAuth } from "@openkotor/trask-http";
import express, { type Request, type Response } from "express";

const logger = createLogger("trask-http-server");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");

const extractBearerToken = (authorization: string | undefined): string | null => {
  if (!authorization || !authorization.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
};

const createWebAuth = (config: ReturnType<typeof loadTraskHttpServerConfig>): TraskHttpAuth<{ id: string }> => ({
  requireAuth: (handler) => async (req: Request, res: Response) => {
    if (config.webApiKey) {
      const bearer = extractBearerToken(req.headers.authorization);
      const headerKey =
        typeof req.headers["x-trask-api-key"] === "string" ? req.headers["x-trask-api-key"].trim() : undefined;
      const ok = bearer === config.webApiKey || headerKey === config.webApiKey;
      if (!ok) {
        res.status(401).json({ error: "Invalid or missing API key." });
        return;
      }
      await handler(req, res, { id: config.webDefaultUserId });
      return;
    }

    if (config.webAllowAnonymous) {
      await handler(req, res, { id: config.webDefaultUserId });
      return;
    }

    res.status(401).json({
      error: "Set TRASK_WEB_API_KEY or TRASK_WEB_ALLOW_ANONYMOUS=1 for local development.",
    });
  },
});

const config = loadTraskHttpServerConfig();

const queryRepository = new JsonTraskQueryRepository(resolveDataFile(config.dataDir, "trask-queries.json"));
const searchProvider = createDefaultSearchProvider({ stateDir: config.chunkDir });
const researchWizard = createResearchWizardClient(config.researchWizard, config.ai);

const runtime = {
  searchProvider,
  researchWizard,
  queryRepository,
};

const app = express();

/** In-memory Spark KV shim so qa-webui static builds stop hammering 404 on `/__spark-kv/*`. */
const sparkKvStore = new Map<string, string>();
const readSparkKvBody = (req: Request): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

app.use((req, res, next) => {
  const pathname = (req.path.split("?")[0] ?? "").replace(/\/+$/, "") || "/";
  if (!pathname.startsWith("/__spark-kv")) {
    next();
    return;
  }

  let subpath = pathname.slice("/__spark-kv".length);
  if (subpath.startsWith("/")) {
    subpath = subpath.slice(1);
  }
  const key = subpath ? decodeURIComponent(subpath.split("/")[0]!) : "";

  void (async () => {
    try {
      if (req.method === "GET" && !key) {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify([...sparkKvStore.keys()]));
        return;
      }
      if (req.method === "GET" && key) {
        const value = sparkKvStore.get(key);
        if (value === undefined) {
          res.status(404).end();
          return;
        }
        res.setHeader("Content-Type", "text/plain");
        res.end(value);
        return;
      }
      if (req.method === "POST" && key) {
        const body = await readSparkKvBody(req);
        sparkKvStore.set(key, body);
        res.status(200).end();
        return;
      }
      if (req.method === "DELETE" && key) {
        sparkKvStore.delete(key);
        res.status(204).end();
        return;
      }
      res.status(405).end();
    } catch {
      res.status(500).end();
    }
  })();
});

app.use(express.json());

const allowedCorsOrigins = buildBrowserCorsAllowedOrigins({
  publicWebOrigin: config.publicWebOrigin,
  localPorts: [5173, 4173, 3000],
});

app.use((req, res, next) => {
  const cors = resolveCorsHeaders({ method: req.method, origin: req.headers.origin }, allowedCorsOrigins, {
    allowHeaders: "Content-Type,Authorization,X-Trask-Api-Key",
  });
  for (const [name, value] of Object.entries(cors.headers)) {
    res.setHeader(name, value);
  }
  if (cors.isPreflight) {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(
  "/api/trask",
  createTraskHttpRouter({
    runtime,
    auth: createWebAuth(config),
  }),
);

const distFromEnv = process.env.TRASK_WEBUI_DIST_PATH?.trim();
const defaultDist = path.join(repoRoot, "apps", "holocron-web", "dist");
const webUiDist = distFromEnv ? path.resolve(distFromEnv) : defaultDist;

if (existsSync(webUiDist)) {
  app.use(express.static(webUiDist));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api") || req.path.startsWith("/__spark-kv")) return next();
    res.sendFile(path.join(webUiDist, "index.html"));
  });
  logger.info(`Serving Holocron web static files from ${webUiDist}`);
} else {
  logger.warn(`Holocron web dist not found at ${webUiDist}; API-only mode (TRASK_WEBUI_DIST_PATH to override).`);
}

const { server, listen } = createNodeApiHost({
  requestListener: app,
  createHub: () => ({}),
});

listen(config.port, () => {
  logger.info(`Trask HTTP API listening on port ${config.port}`);
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
