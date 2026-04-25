// ---------------------------------------------------------------------------
// Serialized match types — mirrors @openkotor/pazaak-engine SerializedMatch
// but is safe to import in the browser (no node:crypto dependency).
// ---------------------------------------------------------------------------

export type SideCardType =
  | "plus"
  | "minus"
  | "flip"
  | "value_change"
  | "copy_previous"
  | "tiebreaker"
  | "flip_two_four"
  | "flip_three_six";

export interface SideCard {
  id: string;
  label: string;
  value: number;
  type: SideCardType;
}

export interface AppliedSideCard {
  cardId: string;
  label: string;
  appliedValue: number;
}

export interface BoardCard {
  value: number;
  frozen: boolean;
  source?: SideCardType;
}

export interface SerializedPlayerState {
  userId: string;
  displayName: string;
  roundWins: number;
  sideDeckId: number | null;
  sideDeckLabel: string | null;
  sideDeck: SideCard[];
  hand: SideCard[];
  usedCardIds: string[];
  board: BoardCard[];
  sideCardsPlayed: AppliedSideCard[];
  total: number;
  stood: boolean;
  hasTiebreaker: boolean;
}

export interface SerializedMatch {
  id: string;
  channelId: string;
  publicMessageId: string | null;
  wager: number;
  players: [SerializedPlayerState, SerializedPlayerState];
  activePlayerIndex: number;
  setNumber: number;
  mainDeck: number[];
  phase: "turn" | "after-draw" | "after-card" | "completed";
  pendingDraw: number | null;
  statusLine: string;
  createdAt: number;
  updatedAt: number;
  turnStartedAt: number;
  turnDeadlineAt?: number;
  disconnectedSince?: Record<string, number>;
  aiSeats?: Record<string, AdvisorDifficulty>;
  initialStarterIndex: number;
  lastSetWinnerIndex: number | null;
  consecutiveTies: number;
  winnerId: string | null;
  winnerName: string | null;
  loserId: string | null;
  loserName: string | null;
  settled: boolean;
}

export interface SideCardOption {
  cardId: string;
  displayLabel: string;
  appliedValue: number;
}

export type AdvisorDifficulty = "easy" | "hard" | "professional";

export type AdvisorCategory = "exact" | "recovery" | "pressure" | "setup" | "neutral";

export type AdvisorConfidence = "low" | "medium" | "high";

export type AdvisorAction =
  | { action: "draw"; rationale: string }
  | { action: "stand"; rationale: string }
  | { action: "end_turn"; rationale: string }
  | { action: "play_side"; cardId: string; appliedValue: number; displayLabel: string; rationale: string };

export interface AdvisorAlternative {
  displayLabel: string;
  rationale: string;
  category: AdvisorCategory;
  score: number;
}

export interface AdvisorSnapshot {
  recommendation: AdvisorAction;
  difficulty: AdvisorDifficulty;
  category: AdvisorCategory;
  confidence: AdvisorConfidence;
  bustProbability: number;
  alternatives: AdvisorAlternative[];
}

export interface SavedSideboardRecord {
  name: string;
  tokens: string[];
  updatedAt: string;
  isActive: boolean;
}

export interface SavedSideboardCollectionRecord {
  userId: string;
  displayName: string;
  activeName: string | null;
  sideboards: SavedSideboardRecord[];
  updatedAt: string;
}

export type PazaakThemePreference = "kotor" | "modern" | "adaptive";

export interface PazaakUserSettings {
  theme: PazaakThemePreference;
  soundEnabled: boolean;
  turnTimerSeconds: number;
  preferredAiDifficulty: AdvisorDifficulty;
}

export interface WalletRecord {
  userId: string;
  displayName: string;
  preferredRuntimeDeckId: number | null;
  balance: number;
  wins: number;
  losses: number;
  mmr: number;
  gamesPlayed: number;
  gamesWon: number;
  lastMatchAt: string | null;
  userSettings: PazaakUserSettings;
  streak: number;
  bestStreak: number;
  lastDailyAt: string | null;
  updatedAt: string;
}

export interface MatchmakingQueueRecord {
  userId: string;
  displayName: string;
  mmr: number;
  preferredMaxPlayers: number;
  enqueuedAt: string;
}

export interface PazaakLobbyPlayerRecord {
  userId: string;
  displayName: string;
  ready: boolean;
  isHost: boolean;
  isAi: boolean;
  aiDifficulty?: AdvisorDifficulty;
  joinedAt: string;
}

export interface PazaakLobbyRecord {
  id: string;
  name: string;
  hostUserId: string;
  maxPlayers: number;
  passwordHash: string | null;
  status: "waiting" | "in_game" | "closed";
  matchId: string | null;
  players: PazaakLobbyPlayerRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface PazaakMatchHistoryRecord {
  matchId: string;
  channelId: string;
  winnerId: string;
  winnerName: string;
  loserId: string;
  loserName: string;
  wager: number;
  completedAt: string;
  summary: string;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  mmr: number;
  gamesPlayed: number;
  gamesWon: number;
  wins: number;
  losses: number;
  balance: number;
}
