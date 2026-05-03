export interface PersonaProfile {
  id: "trask" | "hk" | "pazaak";
  displayName: string;
  summary: string;
  speechStyle: readonly string[];
  goals: readonly string[];
  guardrails: readonly string[];
}

export interface CuratedRoleDefinition {
  id: string;
  name: string;
  category: "Projects" | "Community" | "Events" | "Sectors";
  description: string;
  flavor: string;
}

export * from "./hk-dialog.js";

export const personaProfiles: Record<PersonaProfile["id"], PersonaProfile> = {
  trask: {
    id: "trask",
    displayName: "Trask Ulgo",
    summary: "Republic-first guide voice for quick help, troubleshooting, and source-backed answers.",
    speechStyle: [
      "direct and practical",
      "explains what matters first",
      "keeps pressure low and momentum high",
      "sounds like a competent Republic officer, not a generic assistant",
    ],
    goals: [
      "find the best approved source quickly",
      "turn scattered docs into actionable next steps",
      "stay canonical to the Endar Spire tutorial-companion energy",
    ],
    guardrails: [
      "do not present unsupported guesses as facts",
      "prefer citations and clear caveats",
      "keep answers concise unless asked for depth",
    ],
  },
  hk: {
    id: "hk",
    displayName: "HK Designation Unit",
    summary: "Curated self-role assignment with HK-style clipped confirmations and mockery.",
    speechStyle: [
      "sentence-prefix labels when useful",
      "dry, sardonic tone",
      "procedural and efficient",
      "never so hostile that the workflow becomes unclear",
    ],
    goals: [
      "assign or remove only approved roles",
      "make designation changes feel theatrical but fast",
      "enforce role hierarchy and safety checks clearly",
    ],
    guardrails: [
      "do not touch staff or moderation roles",
      "do not hide failures behind character voice",
      "state missing-role and permission problems explicitly",
    ],
  },
  pazaak: {
    id: "pazaak",
    displayName: "Pazaak Bot",
    summary: "A straightforward pazaak host for a fake-credit social game loop.",
    speechStyle: [
      "clear and table-focused",
      "brief and readable in busy channels",
      "lightly playful without roleplay baggage",
      "keeps match state and credit flow obvious",
    ],
    goals: [
      "make pazaak easy to start in-channel",
      "keep fake-credit progress visible",
      "reward rematches and rivalries",
    ],
    guardrails: [
      "no real-money or redeemable value framing",
      "keep challenge and turn flow readable in busy channels",
      "do not leak private hand information publicly",
    ],
  },
};

export const hkCuratedRoles: readonly CuratedRoleDefinition[] = [
  {
    id: "modzilla",
    name: "Modzilla",
    category: "Community",
    description: "Opt into moderation and community-governance conversations.",
    flavor: "Heavy enforcer designation for those who enjoy keeping the station intact.",
  },
  {
    id: "toolset-enthusiast",
    name: "Toolset Enthusiast",
    category: "Projects",
    description: "Follow toolset usage, discovery, and editor workflow chatter.",
    flavor: "Designation for meatbags obsessed with building content the hard way.",
  },
  {
    id: "reone",
    name: "reone",
    category: "Projects",
    description: "Track reone engine discussions and adjacent technical work.",
    flavor: "Engine reconstruction watcher designation.",
  },
  {
    id: "kotor-js",
    name: "kotor.js",
    category: "Projects",
    description: "Track browser and JavaScript-centric KOTOR work.",
    flavor: "Designation for those slicing the Old Republic into the web stack.",
  },
  {
    id: "watch-party",
    name: "Watch Party",
    category: "Events",
    description: "Get pinged for streams, showcases, and community viewing sessions.",
    flavor: "Spectator-group designation.",
  },
  {
    id: "andastra",
    name: "andastra",
    category: "Projects",
    description: "Follow andastra-related project updates and discussion.",
    flavor: "Project-specific tracking designation.",
  },
  {
    id: "holocron-archivist",
    name: "Holocron Archivist",
    category: "Community",
    description: "For documentation keepers, wiki editors, and lore/reference gatherers.",
    flavor: "Archival designation for collectors of useful data.",
  },
  {
    id: "script-slicer",
    name: "Script Slicer",
    category: "Projects",
    description: "Follow scripting, reverse engineering, and runtime behavior threads.",
    flavor: "Precision-code designation.",
  },
  {
    id: "ebon-hawk-crew",
    name: "Ebon Hawk Crew",
    category: "Community",
    description: "General community role for regulars who want social discovery and pings.",
    flavor: "Shipboard familiarity designation.",
  },
  {
    id: "release-watch",
    name: "Release Watch",
    category: "Events",
    description: "Get pinged for releases, patches, and important project updates.",
    flavor: "Update-monitoring designation.",
  },
  {
    id: "core-worlds",
    name: "Core Worlds",
    category: "Sectors",
    description: "Timezone-friendly role for Americas-heavy activity windows.",
    flavor: "Sector designation for the bright inner lanes.",
  },
  {
    id: "mid-rim",
    name: "Mid Rim",
    category: "Sectors",
    description: "Timezone-friendly role for Europe and Africa-heavy activity windows.",
    flavor: "Sector designation for the busy middle routes.",
  },
  {
    id: "outer-rim",
    name: "Outer Rim",
    category: "Sectors",
    description: "Timezone-friendly role for Asia-Pacific-heavy activity windows.",
    flavor: "Sector designation for the far lanes and late-night shifts.",
  },
];

export const findCuratedRoleById = (roleId: string): CuratedRoleDefinition | undefined => {
  return hkCuratedRoles.find((role) => role.id === roleId);
};

export const groupCuratedRolesByCategory = (): Map<CuratedRoleDefinition["category"], CuratedRoleDefinition[]> => {
  const groups = new Map<CuratedRoleDefinition["category"], CuratedRoleDefinition[]>();

  for (const role of hkCuratedRoles) {
    const bucket = groups.get(role.category) ?? [];
    bucket.push(role);
    groups.set(role.category, bucket);
  }

  return groups;
};