import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DISCORD_UNKNOWN_INTERACTION_CODE,
  ensureAskDeferred,
  isUnknownInteractionError,
  safeEditReply,
  safeReply,
} from "./discord-ask-interaction.js";

const noopLogger = {
  warn: () => undefined,
};

const createInteraction = (overrides: {
  deferred?: boolean;
  replied?: boolean;
  deferReply?: (options?: { ephemeral?: boolean }) => Promise<void>;
  reply?: () => Promise<void>;
  followUp?: () => Promise<void>;
  editReply?: () => Promise<void>;
  guildId?: string | null;
  channelId?: string;
} = {}) => {
  const state = {
    deferred: overrides.deferred ?? false,
    replied: overrides.replied ?? false,
  };

  return {
    deferred: state.deferred,
    replied: state.replied,
    guildId: overrides.guildId ?? "guild-1",
    channelId: overrides.channelId ?? "channel-1",
    deferReply: overrides.deferReply
      ?? (async () => {
        state.deferred = true;
      }),
    reply:
      overrides.reply
      ?? (async () => {
        state.replied = true;
      }),
    followUp:
      overrides.followUp
      ?? (async () => {
        state.replied = true;
      }),
    editReply: overrides.editReply ?? (async () => undefined),
  } as unknown as import("discord.js").ChatInputCommandInteraction;
};

describe("discord-ask-interaction", () => {
  it("isUnknownInteractionError detects Discord 10062", () => {
    assert.equal(isUnknownInteractionError({ code: DISCORD_UNKNOWN_INTERACTION_CODE }), true);
    assert.equal(isUnknownInteractionError(new Error("nope")), false);
  });

  it("ensureAskDeferred calls deferReply when not yet acknowledged", async () => {
    let deferCalls = 0;
    const interaction = createInteraction({
      deferReply: async () => {
        deferCalls += 1;
      },
    });

    const ok = await ensureAskDeferred(interaction, noopLogger);
    assert.equal(ok, true);
    assert.equal(deferCalls, 1);
  });

  it("ensureAskDeferred skips when already deferred", async () => {
    let deferCalls = 0;
    const interaction = createInteraction({
      deferred: true,
      deferReply: async () => {
        deferCalls += 1;
      },
    });

    const ok = await ensureAskDeferred(interaction, noopLogger);
    assert.equal(ok, true);
    assert.equal(deferCalls, 0);
  });

  it("ensureAskDeferred returns false on stale interaction without throwing", async () => {
    const interaction = createInteraction({
      deferReply: async () => {
        const err = new Error("Unknown interaction") as Error & { code: number };
        err.code = DISCORD_UNKNOWN_INTERACTION_CODE;
        throw err;
      },
    });

    const ok = await ensureAskDeferred(interaction, noopLogger);
    assert.equal(ok, false);
  });

  it("ensureAskDeferred falls back to ephemeral defer", async () => {
    const modes: string[] = [];
    const interaction = createInteraction({
      deferReply: async (options) => {
        if (!options?.ephemeral) {
          throw new Error("public defer failed");
        }
        modes.push("ephemeral");
      },
    });

    const ok = await ensureAskDeferred(interaction, noopLogger);
    assert.equal(ok, true);
    assert.deepEqual(modes, ["ephemeral"]);
  });

  it("safeReply uses followUp when already deferred", async () => {
    let followUps = 0;
    const interaction = createInteraction({
      deferred: true,
      followUp: async () => {
        followUps += 1;
      },
    });

    await safeReply(interaction, { content: "hi" }, noopLogger);
    assert.equal(followUps, 1);
  });

  it("safeEditReply swallows stale interaction errors", async () => {
    const interaction = createInteraction({
      editReply: async () => {
        const err = new Error("Unknown interaction") as Error & { code: number };
        err.code = DISCORD_UNKNOWN_INTERACTION_CODE;
        throw err;
      },
    });

    await assert.doesNotReject(async () => {
      await safeEditReply(interaction, { content: "done" }, noopLogger);
    });
  });
});
