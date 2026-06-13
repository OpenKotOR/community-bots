import assert from "node:assert/strict";
import test from "node:test";

import {
  TRASK_AGENT_CALLABLE_METHODS,
  TRASK_AGENT_COMMANDS,
  capabilitiesBody,
  commandToRequest,
} from "../dist/agent-surface.test.js";

const readJson = async (request) => JSON.parse(await request.text());

test("capabilities expose Trask HTTP and safe ops commands", () => {
  const capabilities = capabilitiesBody();
  const commands = new Set(TRASK_AGENT_COMMANDS.map((command) => command.name));

  for (const command of [
    "ask",
    "models",
    "thread",
    "cancel",
    "history",
    "sources",
    "session",
    "health",
    "evidence",
    "refresh-dry-run",
    "purge-discord-message",
    "invite-policy",
    "allow-invite-guild",
    "revoke-invite-guild",
    "configure-invite",
    "capabilities",
  ]) {
    assert.equal(commands.has(command), true, `${command} should be registered`);
  }

  assert.equal(capabilities.agent, "TraskAgent");
  assert.equal(capabilities.agentRoute, "/agents/trask-agent/default");
  assert.deepEqual(capabilities.callableMethods, [...TRASK_AGENT_CALLABLE_METHODS]);
  for (const method of [
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
  ]) {
    assert.equal(capabilities.callableMethods.includes(method), true, `${method} should be callable`);
  }
  assert.deepEqual(capabilities.providerOrder, ["huggingface", "cloudflare", "deterministic-extractive"]);
  assert.equal(capabilities.safetyLimits.destructiveActionsDefaultToDryRun, true);
});

test("ask command maps to the current Trask HTTP ask contract", async () => {
  const request = commandToRequest(
    "query",
    {
      query: "What is TSLPatcher?",
      threadId: "018f7f8f-0000-4000-8000-000000000001",
      modelId: "hf-fast",
      sourceWeights: { website: 1, discord: 0.8 },
    },
    "https://trask-agent.local/",
  );

  assert.equal(request.method, "POST");
  assert.equal(new URL(request.url).pathname, "/api/trask/ask");
  assert.deepEqual(await readJson(request), {
    query: "What is TSLPatcher?",
    threadId: "018f7f8f-0000-4000-8000-000000000001",
    model: "hf-fast",
    sourceWeights: { website: 1, discord: 0.8 },
  });
});

test("read commands map to Trask HTTP routes", () => {
  assert.equal(new URL(commandToRequest("models", {}, "https://trask-agent.local/").url).pathname, "/api/trask/models");

  const history = new URL(commandToRequest("history", { limit: 5, threadId: "abc" }, "https://trask-agent.local/").url);
  assert.equal(history.pathname, "/api/trask/history");
  assert.equal(history.searchParams.get("limit"), "5");
  assert.equal(history.searchParams.get("thread"), "abc");

  assert.equal(
    new URL(commandToRequest("thread", { queryId: "q-1" }, "https://trask-agent.local/").url).pathname,
    "/api/trask/thread/q-1",
  );
  assert.equal(
    new URL(commandToRequest("cancel", { queryId: "q-1" }, "https://trask-agent.local/").url).pathname,
    "/api/trask/query/q-1/cancel",
  );
  assert.equal(new URL(commandToRequest("health", {}, "https://trask-agent.local/").url).pathname, "/healthz");
  assert.equal(
    new URL(commandToRequest("invite-policy", {}, "https://trask-agent.local/").url).pathname,
    "/api/trask/install-policy",
  );
});

test("invite allowlist commands map to install policy routes", async () => {
  const allow = commandToRequest("allow-invite-guild", { guildId: "123456789012345678" }, "https://trask-agent.local/");
  assert.equal(allow.method, "POST");
  assert.equal(new URL(allow.url).pathname, "/api/trask/install-policy/allow");
  assert.deepEqual(await readJson(allow), { guildId: "123456789012345678" });

  const revoke = commandToRequest("revoke-invite-guild", { id: "123456789012345678" }, "https://trask-agent.local/");
  assert.equal(revoke.method, "POST");
  assert.equal(new URL(revoke.url).pathname, "/api/trask/install-policy/revoke");
  assert.deepEqual(await readJson(revoke), { guildId: "123456789012345678" });

  const configure = commandToRequest(
    "configure-invite",
    { appId: "1305793207036022784", permissions: "84992" },
    "https://trask-agent.local/",
  );
  assert.equal(configure.method, "POST");
  assert.equal(new URL(configure.url).pathname, "/api/trask/install-policy/configure");
  assert.deepEqual(await readJson(configure), { appId: "1305793207036022784", permissions: "84992" });
});
