import type { ResearchWizardRuntimeConfig } from "@openkotor/config";

export type ResearchComposeStrategy =
  | "grounded"
  | "source_only"
  | "degraded"
  | "rewrite"
  | "fallback_discord";

type ComposePolicyConfig = Pick<
  ResearchWizardRuntimeConfig,
  "composeMode" | "groundedComposeEnabled"
>;

export const isGroundedComposeEnabled = (config: ComposePolicyConfig): boolean => {
  if (config.composeMode === "rewrite") {
    return false;
  }
  return config.groundedComposeEnabled;
};

export const isRewriteComposeEnabled = (config: ComposePolicyConfig): boolean =>
  config.composeMode === "rewrite";

export const isIndexMissPayload = (payload: {
  readonly passages?: readonly unknown[] | null;
  readonly research_information?: { readonly index_miss?: boolean | null } | null;
}): boolean => {
  const info = payload.research_information;
  if (info && typeof info === "object" && "index_miss" in info) {
    return Boolean(info.index_miss);
  }
  return (payload.passages?.length ?? 0) === 0;
};
