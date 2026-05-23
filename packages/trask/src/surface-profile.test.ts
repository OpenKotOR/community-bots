import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveSurfaceProfile } from "@openkotor/trask-config";

describe("surface profiles", () => {
  it("discord uses brief compose", () => {
    const profile = resolveSurfaceProfile("discord");
    assert.equal(profile.composeProfile, "brief");
    assert.equal(profile.formatterId, "discord-ask");
  });

  it("holocron uses full compose", () => {
    const profile = resolveSurfaceProfile("holocron");
    assert.equal(profile.composeProfile, "full");
    assert.equal(profile.promptTemplateId, "holocron-compose");
  });
});
