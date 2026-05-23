import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadPromptTemplate } from "./prompts.js";

describe("prompts", () => {
  it("loads discord brief compose with Sources instruction", () => {
    const body = loadPromptTemplate("discord-brief-compose");
    assert.match(body, /Sources/i);
  });
});
