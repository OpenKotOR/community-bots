import { z } from "zod";

import { loadValidatedJson } from "./json-load.js";
import { traskDataPath } from "./repo-root.js";

const SurfaceProfileSchema = z.object({
  composeProfile: z.enum(["full", "brief"]),
  minWebCitations: z.number().int().positive(),
  minWebCitationsWhenSingleSource: z.boolean(),
  formatterId: z.string().nullable(),
  promptTemplateId: z.string().min(1),
});

const SurfaceProfilesFileSchema = z.object({
  version: z.number().int().positive(),
  profiles: z.record(SurfaceProfileSchema),
});

export type SurfaceProfile = z.infer<typeof SurfaceProfileSchema>;
export type SurfaceProfileId = keyof z.infer<typeof SurfaceProfilesFileSchema>["profiles"] | string;

let cachedProfiles: Record<string, SurfaceProfile> | null = null;

const surfacesPath = (): string => {
  const override = process.env.TRASK_SURFACE_PROFILES_PATH?.trim();
  if (override) return override;
  return traskDataPath("profiles", "surfaces.json");
};

export const loadSurfaceProfiles = (): Record<string, SurfaceProfile> => {
  if (cachedProfiles) return cachedProfiles;
  const file = loadValidatedJson(surfacesPath(), SurfaceProfilesFileSchema);
  cachedProfiles = file.profiles;
  return cachedProfiles;
};

export const resolveSurfaceProfile = (profileId: string): SurfaceProfile => {
  const profiles = loadSurfaceProfiles();
  const profile = profiles[profileId];
  if (!profile) {
    if (profileId !== "holocron" && profiles.holocron) {
      return profiles.holocron;
    }
    throw new Error(`Unknown Trask surface profile: ${profileId}`);
  }
  return profile;
};

export const clearSurfaceProfilesCache = (): void => {
  cachedProfiles = null;
};
