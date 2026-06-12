import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyTraskProactiveMessageHeuristic,
  parseTraskProactiveClassificationJson,
  scoreLexicalResearchAlignment,
} from "./proactive-llm.js";

test("parseTraskProactiveClassificationJson treats string false as false", () => {
  const parsed = parseTraskProactiveClassificationJson(
    JSON.stringify({
      is_question: "false",
      kotor_relevant: "false",
      confidence: "0.82",
    }),
  );

  assert.deepEqual(parsed, {
    isQuestion: false,
    kotorRelevant: false,
    confidence: 0.82,
  });
});

test("parseTraskProactiveClassificationJson accepts common truthy strings", () => {
  const parsed = parseTraskProactiveClassificationJson(
    JSON.stringify({
      is_question: "yes",
      kotor_relevant: "1",
      confidence: 2,
    }),
  );

  assert.deepEqual(parsed, {
    isQuestion: true,
    kotorRelevant: true,
    confidence: 1,
  });
});

test("parseTraskProactiveClassificationJson rejects nonnumeric confidence", () => {
  assert.equal(
    parseTraskProactiveClassificationJson(
      JSON.stringify({
        is_question: true,
        kotor_relevant: true,
        confidence: "certain",
      }),
    ),
    null,
  );
});

test("scoreLexicalResearchAlignment accepts overlapping KOTOR evidence", () => {
  const score = scoreLexicalResearchAlignment({
    question: "Could TSLPatcher patch TLK entries for a KOTOR mod install?",
    answerMarkdown: "TSLPatcher can patch TLK entries for KOTOR installs. [1]",
    researchReport: "TSLPatcher documentation covers TLK and KOTOR mod installation.",
  });

  assert.ok(score >= 0.5, String(score));
});

test("scoreLexicalResearchAlignment rejects weak unrelated evidence", () => {
  const score = scoreLexicalResearchAlignment({
    question: "Could TSLPatcher patch TLK entries for a KOTOR mod install?",
    answerMarkdown: "The weather forecast is sunny.",
    researchReport: "No game modding evidence here.",
  });

  assert.equal(score, 0);
});

test("classifyTraskProactiveMessageHeuristic accepts KOTOR modding questions", () => {
  const result = classifyTraskProactiveMessageHeuristic(
    "Can TSLPatcher safely patch 2DA, GFF, and TLK changes for KotOR mods?",
  );

  assert.equal(result.isQuestion, true);
  assert.equal(result.kotorRelevant, true);
  assert.ok(result.confidence >= 0.55, String(result.confidence));
});

test("classifyTraskProactiveMessageHeuristic rejects off-topic questions", () => {
  const result = classifyTraskProactiveMessageHeuristic(
    "Can anyone recommend a good pizza place downtown?",
  );

  assert.equal(result.isQuestion, true);
  assert.equal(result.kotorRelevant, false);
  assert.ok(result.confidence < 0.55, String(result.confidence));
});

test("classifyTraskProactiveMessageHeuristic rejects KOTOR chatter without a question", () => {
  const result = classifyTraskProactiveMessageHeuristic(
    "KOTOR vibes are immaculate tonight lol",
  );

  assert.equal(result.isQuestion, false);
  assert.equal(result.kotorRelevant, true);
  assert.ok(result.confidence < 0.55, String(result.confidence));
});
