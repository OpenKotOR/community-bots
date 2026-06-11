import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildGitHubBlobUrl,
  inferGitHubFilePath,
  isPlausibleRepoRelativePath,
  lineAnchorForQuote,
  parseShallowGitHubRepoUrl,
  resolveGitHubCitationUrlSync,
  webCitationDisplayLabel,
} from "./github-citation-url.js";

describe("github-citation-url", () => {
  test("parseShallowGitHubRepoUrl accepts repo roots only", () => {
    assert.deepEqual(parseShallowGitHubRepoUrl("https://github.com/seedhartha/reone"), {
      owner: "seedhartha",
      repo: "reone",
    });
    assert.equal(parseShallowGitHubRepoUrl("https://github.com/seedhartha/reone/blob/main/README.md"), null);
  });

  test("resolveGitHubCitationUrlSync builds README blob with line anchor", () => {
    const passage = "# reone Odyssey engine\n\nThe reone project is an open-source reimplementation.";
    const quote = "The reone project is an open-source reimplementation.";
    const resolved = resolveGitHubCitationUrlSync(
      "https://github.com/seedhartha/reone",
      passage,
      quote,
    );
    assert.match(resolved, /^https:\/\/github\.com\/seedhartha\/reone\/blob\/main\/README\.md#L\d+/u);
  });

  test("lineAnchorForQuote returns a range for multi-line quotes", () => {
    const passage = "line one\nline two\nline three";
    const quote = "line two\nline three";
    assert.equal(lineAnchorForQuote(passage, quote), "#L2-L3");
  });

  test("inferGitHubFilePath prefers explicit repo paths", () => {
    const passage = "See src/libs/graphics/renderer.cpp for details.";
    assert.equal(
      inferGitHubFilePath("https://github.com/seedhartha/reone", passage),
      "src/libs/graphics/renderer.cpp",
    );
  });

  test("webCitationDisplayLabel shows file path instead of github.com", () => {
    const label = webCitationDisplayLabel(
      "https://github.com/seedhartha/reone/blob/abc1234/README.md#L3-L5",
      "github.com",
    );
    assert.equal(label, "README.md#L3-L5");
  });

  test("buildGitHubBlobUrl preserves commit sha ref", () => {
    assert.equal(
      buildGitHubBlobUrl("seedhartha", "reone", "abc1234", "README.md", "#L2"),
      "https://github.com/seedhartha/reone/blob/abc1234/README.md#L2",
    );
  });

  test("inferGitHubFilePath ignores raw.githubusercontent paths in passage text", () => {
    const passage =
      "See [icon](https://raw.githubusercontent.com/KobaltBlu/KotOR.js/master/src/assets/icons/icon.png) for branding.";
    assert.equal(inferGitHubFilePath("https://github.com/KobaltBlu/KotOR.js", passage), "README.md");
    assert.equal(isPlausibleRepoRelativePath("githubusercontent.com/KobaltBlu/KotOR.js"), false);
  });

  test("resolveGitHubCitationUrlSync does not embed githubusercontent in blob path", () => {
    const passage =
      "KotOR.js ports the engine [icon.png](https://raw.githubusercontent.com/KobaltBlu/KotOR.js/master/src/assets/icons/icon.png).";
    const resolved = resolveGitHubCitationUrlSync(
      "https://github.com/KobaltBlu/KotOR.js",
      passage,
      "KotOR.js ports the engine.",
    );
    assert.doesNotMatch(resolved, /githubusercontent/iu);
    assert.match(resolved, /\/blob\/main\/README\.md(?:#|$)/iu);
  });

  test("webCitationDisplayLabel uses README path for malformed blob URLs", () => {
    const label = webCitationDisplayLabel(
      "https://github.com/KobaltBlu/KotOR.js/blob/master/githubusercontent.com/KobaltBlu/KotOR.js#L1",
      "github.com",
    );
    assert.equal(label, "README.md#L1");
  });
});
