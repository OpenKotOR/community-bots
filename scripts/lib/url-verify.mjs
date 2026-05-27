/**
 * Shared citation URL reachability checks for verify scripts and e2e helpers.
 * Implementation lives in @openkotor/trask (citation-url-verify.ts).
 */
export {
  assertAllUrlsReachable,
  citationUrlVerifyEnabled,
  isHttpsCitationReachable,
  isSkippableCitationUrl,
} from "@openkotor/trask";
