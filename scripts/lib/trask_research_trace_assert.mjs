/**
 * Plan 006 AE3: ensure `trask_research_trace` stderr JSON exposes classifiable failure diag keys.
 */
import {
  emitResearchTraceLog,
  timeoutDiagForResearchError,
  _diagFromResearchPayload,
} from "@openkotor/trask";

const assert = (ok, message) => {
  if (!ok) {
    throw new Error(message);
  }
};

/** Capture one `trask_research_trace` line emitted by `emitResearchTraceLog`. */
export const captureResearchTraceLine = (event) => {
  const lines = [];
  const originalError = console.error;
  const priorTraceLogEnv = process.env.TRASK_RESEARCH_TRACE_LOG;
  delete process.env.TRASK_RESEARCH_TRACE_LOG;
  console.error = (...args) => {
    lines.push(String(args[0] ?? ""));
  };
  try {
    emitResearchTraceLog(event);
  } finally {
    console.error = originalError;
    if (priorTraceLogEnv === undefined) {
      delete process.env.TRASK_RESEARCH_TRACE_LOG;
    } else {
      process.env.TRASK_RESEARCH_TRACE_LOG = priorTraceLogEnv;
    }
  }
  assert(lines.length === 1, "expected exactly one trask_research_trace line");
  const parsed = JSON.parse(lines[0]);
  assert(parsed.type === "trask_research_trace", `unexpected trace type: ${parsed.type}`);
  assert(typeof parsed.phase === "string", "trace line missing phase");
  return parsed;
};

/** @returns {void} */
export const assertAe3ResearchTraceFailureClasses = () => {
  const gatherTimeout = timeoutDiagForResearchError(
    "Trask web research runner timed out after 90000ms (gather)",
    91_000,
    90_000,
    120_000,
  );
  assert(gatherTimeout.timeout_phase === "gather", "gather timeout_phase");
  assert(gatherTimeout.timeout_limit_ms === 90_000, "gather timeout_limit_ms");
  assert(typeof gatherTimeout.elapsed_ms === "number", "gather elapsed_ms");

  const composeTimeout = timeoutDiagForResearchError("rewrite timed out after 120000ms", 121_000, 90_000, 120_000);
  assert(composeTimeout.timeout_phase === "compose", "compose timeout_phase");
  assert(composeTimeout.timeout_limit_ms === 120_000, "compose timeout_limit_ms");

  const indexMissTrace = captureResearchTraceLine({
    phase: "gather",
    detail: "POST /retrieve → no passages",
    diag: _diagFromResearchPayload(
      {
        passages: [],
        research_information: { index_miss: true, passages_count: 0, indexer_url: "http://127.0.0.1:8787" },
      },
      "http://127.0.0.1:8787",
    ),
  });
  assert(indexMissTrace.diag?.index_miss === true, "trace index_miss diag");

  const verifyRejectTrace = captureResearchTraceLine({
    phase: "gather",
    detail: "URL verify rejected 2 unreachable URLs",
    diag: { rejected_urls: 2 },
  });
  assert(
    typeof verifyRejectTrace.diag?.rejected_urls === "number" && verifyRejectTrace.diag.rejected_urls > 0,
    "trace rejected_urls diag",
  );

  const researchDoneTrace = captureResearchTraceLine({
    phase: "gather",
    detail: "research_done · 3 passages · 2 URLs · index miss",
    diag: {
      research_done: true,
      passages: 3,
      urls: 2,
      index_miss: true,
      rejected_urls: 0,
      retrieve_elapsed_ms: 900,
    },
  });
  assert(researchDoneTrace.diag?.research_done === true, "trace research_done flag");
  assert(researchDoneTrace.diag?.passages === 3, "trace research_done passages");
  assert(researchDoneTrace.diag?.index_miss === true, "trace research_done index_miss");

  const timeoutTrace = captureResearchTraceLine({
    phase: "compose",
    detail: "Gather timed out (90000ms budget)",
    diag: gatherTimeout,
  });
  assert(timeoutTrace.diag?.timeout_phase === "gather", "trace timeout_phase on failure row");
};
