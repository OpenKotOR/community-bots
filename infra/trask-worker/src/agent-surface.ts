export interface TraskAgentCommand {
  name: string;
  aliases?: readonly string[];
  description: string;
  method: "GET" | "POST";
  path: string;
  args?: Record<string, string>;
  mutates?: boolean;
  dryRunDefault?: boolean;
}

export const TRASK_AGENT_CALLABLE_METHODS = [
  "capabilities",
  "status",
  "query",
  "ask",
  "research",
  "models",
  "thread",
  "cancel",
  "history",
  "sources",
  "session",
  "health",
  "evidence",
  "refreshDryRun",
  "purgeDiscordMessage",
  "invitePolicy",
  "allowInviteGuild",
  "revokeInviteGuild",
  "configureInvite",
  "command",
] as const;

export const TRASK_AGENT_COMMANDS: readonly TraskAgentCommand[] = [
  {
    name: "ask",
    aliases: ["query", "research"],
    description: "Submit a Trask research query through the configured live Trask HTTP upstream.",
    method: "POST",
    path: "/api/trask/ask",
    args: {
      query: "string",
      threadId: "optional UUID string",
      model: "optional model id from /api/trask/models",
      sourceWeights: "optional Holocron source weights object",
    },
  },
  {
    name: "models",
    description: "List Trask/Holocron research models supported by the configured upstream.",
    method: "GET",
    path: "/api/trask/models",
  },
  {
    name: "thread",
    description: "Fetch a persisted Trask query/thread by id after an async ask response.",
    method: "GET",
    path: "/api/trask/thread/:id",
    args: { id: "thread UUID, threadId, or queryId" },
  },
  {
    name: "cancel",
    description: "Cancel a pending Trask query by query id.",
    method: "POST",
    path: "/api/trask/query/:id/cancel",
    args: { id: "pending query UUID, queryId, or threadId" },
    mutates: true,
  },
  {
    name: "history",
    description: "List persisted Trask query history for the configured web user.",
    method: "GET",
    path: "/api/trask/history",
    args: { limit: "optional 1-100 integer", thread: "optional thread UUID" },
  },
  {
    name: "sources",
    description: "List approved Trask source records surfaced by the HTTP runtime.",
    method: "GET",
    path: "/api/trask/sources",
  },
  {
    name: "session",
    description: "Inspect the public Holocron/Trask session capability state.",
    method: "GET",
    path: "/api/trask/session",
  },
  {
    name: "health",
    description: "Probe the Worker and configured Trask HTTP upstream.",
    method: "GET",
    path: "/healthz",
  },
  {
    name: "evidence",
    description: "Query the Cloudflare retrieve Worker boundary and return an evidence pack.",
    method: "POST",
    path: "$TRASK_RETRIEVE_BASE_URL/retrieve",
    args: { query: "string", limit: "optional positive integer" },
  },
  {
    name: "refresh-dry-run",
    description: "Send a token-guarded dry-run reindex request through the configured retrieve/indexer boundary.",
    method: "POST",
    path: "$TRASK_RETRIEVE_BASE_URL/reindex",
    args: { limit: "optional positive integer" },
    dryRunDefault: true,
  },
  {
    name: "purge-discord-message",
    description: "Prepare a safe dry-run purge request for indexed Discord message evidence.",
    method: "POST",
    path: "/api/agent/command",
    args: { channelId: "Discord channel id", messageId: "Discord message id", guildId: "optional guild id" },
    mutates: true,
    dryRunDefault: true,
  },
  {
    name: "invite-policy",
    description: "Read the persistent Trask Discord install allowlist used by the invite broker.",
    method: "GET",
    path: "/api/trask/install-policy",
  },
  {
    name: "allow-invite-guild",
    description: "Persistently allow a Discord guild id to install Trask without restarting the bot or Worker.",
    method: "POST",
    path: "/api/trask/install-policy/allow",
    args: { guildId: "Discord guild id" },
    mutates: true,
  },
  {
    name: "revoke-invite-guild",
    description: "Remove a Discord guild id from the persistent Trask install allowlist.",
    method: "POST",
    path: "/api/trask/install-policy/revoke",
    args: { guildId: "Discord guild id" },
    mutates: true,
  },
  {
    name: "configure-invite",
    description: "Persistently configure Trask Discord app id and invite permissions without redeploying.",
    method: "POST",
    path: "/api/trask/install-policy/configure",
    args: { appId: "Discord application id", permissions: "optional permission integer" },
    mutates: true,
  },
  {
    name: "capabilities",
    description: "Return this agent command registry.",
    method: "GET",
    path: "/api/agent/capabilities",
  },
];

export function capabilitiesBody() {
  return {
    agent: "TraskAgent",
    agentRoute: "/agents/trask-agent/default",
    convenienceRoutes: {
      capabilities: "/api/agent/capabilities",
      status: "/api/agent/status",
      state: "/api/agent/state",
      query: "/api/agent/query",
      command: "/api/agent/command",
    },
    commands: TRASK_AGENT_COMMANDS.map((command) => ({ ...command })),
    callableMethods: [...TRASK_AGENT_CALLABLE_METHODS],
    providerOrder: ["huggingface", "cloudflare", "deterministic-extractive"],
    retrievalBoundary: "$TRASK_RETRIEVE_BASE_URL/retrieve",
    safetyLimits: {
      destructiveActionsDefaultToDryRun: true,
      purgeDiscordMessageIsPlanOnlyInWorker: true,
      traskInviteRequiresAllowlistedGuild: true,
    },
    notes: [
      "Trask research commands proxy to the configured live Trask HTTP upstream.",
      "Evidence commands use the Cloudflare retrieve Worker boundary configured by TRASK_RETRIEVE_BASE_URL.",
      "State is persisted by the Agents SDK Durable Object instance.",
      "Use TRASK_WEB_API_KEY to protect public agent routes, or TRASK_WEB_ALLOW_ANONYMOUS=1 for public Holocron.",
    ],
  };
}

export function readJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function optionalJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function stringValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  return "";
}

export function commandToRequest(command: string, args: Record<string, unknown>, baseUrl: string): Request {
  const url = new URL(baseUrl);
  const normalized = command.trim().toLowerCase();

  if (normalized === "ask" || normalized === "query" || normalized === "research") {
    url.pathname = "/api/trask/ask";
    const sourceWeights = optionalJsonObject(args.sourceWeights || args.sourcePreference);
    return new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: stringValue(args.query || args.question || args.prompt),
        ...(stringValue(args.threadId || args.thread) ? { threadId: stringValue(args.threadId || args.thread) } : {}),
        ...(stringValue(args.model || args.modelId) ? { model: stringValue(args.model || args.modelId) } : {}),
        ...(sourceWeights ? { sourceWeights } : {}),
      }),
    });
  }

  if (normalized === "models") {
    url.pathname = "/api/trask/models";
    return new Request(url, { method: "GET" });
  }

  if (normalized === "thread") {
    const id = stringValue(args.id || args.threadId || args.queryId);
    url.pathname = `/api/trask/thread/${encodeURIComponent(id)}`;
    return new Request(url, { method: "GET" });
  }

  if (normalized === "cancel") {
    const id = stringValue(args.id || args.queryId || args.threadId);
    url.pathname = `/api/trask/query/${encodeURIComponent(id)}/cancel`;
    return new Request(url, { method: "POST" });
  }

  if (normalized === "history") {
    url.pathname = "/api/trask/history";
    const limit = stringValue(args.limit);
    if (limit) url.searchParams.set("limit", limit);
    const thread = stringValue(args.thread || args.threadId);
    if (thread) url.searchParams.set("thread", thread);
    return new Request(url, { method: "GET" });
  }

  if (normalized === "sources") {
    url.pathname = "/api/trask/sources";
    return new Request(url, { method: "GET" });
  }

  if (normalized === "session") {
    url.pathname = "/api/trask/session";
    return new Request(url, { method: "GET" });
  }

  if (normalized === "health") {
    url.pathname = "/healthz";
    return new Request(url, { method: "GET" });
  }

  if (normalized === "invite-policy") {
    url.pathname = "/api/trask/install-policy";
    return new Request(url, { method: "GET" });
  }

  if (normalized === "allow-invite-guild" || normalized === "revoke-invite-guild") {
    url.pathname = normalized === "allow-invite-guild"
      ? "/api/trask/install-policy/allow"
      : "/api/trask/install-policy/revoke";
    return new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guildId: stringValue(args.guildId || args.guild_id || args.id) }),
    });
  }

  if (normalized === "configure-invite") {
    url.pathname = "/api/trask/install-policy/configure";
    return new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appId: stringValue(args.appId || args.clientId || args.discordAppId),
        permissions: stringValue(args.permissions || args.permissionInteger),
      }),
    });
  }

  throw Object.assign(new Error(`Unknown Trask agent command: ${command}`), { status: 422 });
}
