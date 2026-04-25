import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

export interface RivalryRecord {
  opponentId: string;
  opponentName: string;
  wins: number;
  losses: number;
}

export type PazaakThemePreference = "kotor" | "modern" | "adaptive";

export interface PazaakUserSettings {
  theme: PazaakThemePreference;
  soundEnabled: boolean;
  turnTimerSeconds: number;
  preferredAiDifficulty: "easy" | "hard" | "professional";
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
  rivalries: Record<string, RivalryRecord>;
  updatedAt: string;
}

interface WalletFileShape {
  version: 1;
  wallets: Record<string, WalletRecord>;
}

const defaultPazaakUserSettings = (): PazaakUserSettings => ({
  theme: "kotor",
  soundEnabled: false,
  turnTimerSeconds: 45,
  preferredAiDifficulty: "professional",
});

const normalizeWalletRecord = (wallet: WalletRecord): WalletRecord => ({
  ...wallet,
  preferredRuntimeDeckId: wallet.preferredRuntimeDeckId ?? null,
  mmr: wallet.mmr ?? 1000,
  gamesPlayed: wallet.gamesPlayed ?? wallet.wins + wallet.losses,
  gamesWon: wallet.gamesWon ?? wallet.wins,
  lastMatchAt: wallet.lastMatchAt ?? null,
  userSettings: {
    ...defaultPazaakUserSettings(),
    ...(wallet.userSettings ?? {}),
  },
});

const cloneWallet = (wallet: WalletRecord): WalletRecord => ({
  ...normalizeWalletRecord(wallet),
  userSettings: { ...normalizeWalletRecord(wallet).userSettings },
});

const createWallet = (userId: string, displayName: string, startingBalance: number): WalletRecord => {
  return {
    userId,
    displayName,
    preferredRuntimeDeckId: null,
    balance: startingBalance,
    wins: 0,
    losses: 0,
    mmr: 1000,
    gamesPlayed: 0,
    gamesWon: 0,
    lastMatchAt: null,
    userSettings: defaultPazaakUserSettings(),
    streak: 0,
    bestStreak: 0,
    lastDailyAt: null,
    rivalries: {},
    updatedAt: new Date().toISOString(),
  };
};

export const resolveDataFile = (rootDir: string, fileName: string): string => {
  return path.resolve(rootDir, fileName);
};

export class JsonWalletRepository {
  private state?: WalletFileShape;

  public constructor(
    private readonly filePath: string,
    private readonly startingBalance: number,
  ) {}

  public async getWallet(userId: string, displayName: string): Promise<WalletRecord> {
    const state = await this.ensureState();
    const wallet = state.wallets[userId] ?? this.upsertWallet(state, userId, displayName);
    return cloneWallet(wallet);
  }

  public async canCover(userId: string, displayName: string, amount: number): Promise<boolean> {
    const wallet = await this.getWallet(userId, displayName);
    return wallet.balance >= amount;
  }

  public async listWallets(): Promise<readonly WalletRecord[]> {
    const state = await this.ensureState();
    return Object.values(state.wallets)
      .map(cloneWallet)
      .sort((left, right) => right.balance - left.balance || right.wins - left.wins || left.losses - right.losses);
  }

  public async setPreferredRuntimeDeckId(userId: string, displayName: string, deckId: number | null): Promise<WalletRecord> {
    const state = await this.ensureState();
    const wallet = this.upsertWallet(state, userId, displayName);
    wallet.preferredRuntimeDeckId = deckId;
    wallet.updatedAt = new Date().toISOString();
    await this.persist(state);
    return cloneWallet(wallet);
  }

  public async getUserSettings(userId: string, displayName: string): Promise<PazaakUserSettings> {
    const wallet = await this.getWallet(userId, displayName);
    return { ...wallet.userSettings };
  }

  public async updateUserSettings(
    userId: string,
    displayName: string,
    settings: Partial<PazaakUserSettings>,
  ): Promise<WalletRecord> {
    const state = await this.ensureState();
    const wallet = this.upsertWallet(state, userId, displayName);
    wallet.userSettings = {
      ...wallet.userSettings,
      ...settings,
    };
    wallet.updatedAt = new Date().toISOString();
    await this.persist(state);
    return cloneWallet(wallet);
  }

  public async claimDailyBonus(
    userId: string,
    displayName: string,
    bonusAmount: number,
    cooldownMs: number,
  ): Promise<{ credited: boolean; amount: number; nextEligibleAt: number }> {
    const state = await this.ensureState();
    const wallet = this.upsertWallet(state, userId, displayName);
    const now = Date.now();
    const lastDaily = wallet.lastDailyAt ? new Date(wallet.lastDailyAt).getTime() : 0;

    if (now - lastDaily < cooldownMs) {
      return { credited: false, amount: 0, nextEligibleAt: lastDaily + cooldownMs };
    }

    wallet.balance += bonusAmount;
    wallet.lastDailyAt = new Date().toISOString();
    wallet.updatedAt = new Date().toISOString();
    await this.persist(state);
    return { credited: true, amount: bonusAmount, nextEligibleAt: now + cooldownMs };
  }

  public async recordMatch(options: {
    winnerId: string;
    winnerName: string;
    loserId: string;
    loserName: string;
    wager: number;
  }): Promise<{ winner: WalletRecord; loser: WalletRecord }> {
    const state = await this.ensureState();
    const winner = this.upsertWallet(state, options.winnerId, options.winnerName);
    const loser = this.upsertWallet(state, options.loserId, options.loserName);
    const matchedAt = new Date().toISOString();

    loser.balance = Math.max(0, loser.balance - options.wager);
    loser.losses += 1;
    loser.gamesPlayed += 1;
    loser.lastMatchAt = matchedAt;
    loser.mmr = Math.max(0, loser.mmr - 15);
    loser.streak = 0;
    loser.updatedAt = matchedAt;

    winner.balance += options.wager;
    winner.wins += 1;
    winner.gamesPlayed += 1;
    winner.gamesWon += 1;
    winner.lastMatchAt = matchedAt;
    winner.mmr += 25;
    winner.streak += 1;
    winner.bestStreak = Math.max(winner.bestStreak, winner.streak);
    winner.updatedAt = matchedAt;

    this.upsertRivalry(winner, options.loserId, options.loserName, "win");
    this.upsertRivalry(loser, options.winnerId, options.winnerName, "loss");

    await this.persist(state);

    return {
      winner: cloneWallet(winner),
      loser: cloneWallet(loser),
    };
  }

  public topRivalry(wallet: WalletRecord): RivalryRecord | undefined {
    const entries = Object.values(wallet.rivalries);
    if (entries.length === 0) return undefined;
    return entries.reduce((best, entry) => {
      const bestTotal = best.wins + best.losses;
      const entryTotal = entry.wins + entry.losses;
      return entryTotal > bestTotal ? entry : best;
    });
  }

  public allRivalries(wallet: WalletRecord): readonly RivalryRecord[] {
    return Object.values(wallet.rivalries).sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses));
  }

  /**
   * Directly adjust a wallet balance by a signed delta (positive = add, negative = subtract).
   * Balance is floored at 0. Returns the updated wallet record.
   */
  public async adjustBalance(userId: string, displayName: string, delta: number): Promise<WalletRecord> {
    const state = await this.ensureState();
    const wallet = this.upsertWallet(state, userId, displayName);
    wallet.balance = Math.max(0, wallet.balance + delta);
    wallet.updatedAt = new Date().toISOString();
    await this.persist(state);
    return cloneWallet(wallet);
  }

  private async ensureState(): Promise<WalletFileShape> {
    if (this.state) {
      return this.state;
    }

    await mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, "utf8");
      this.state = JSON.parse(raw) as WalletFileShape;
    } catch {
      this.state = {
        version: 1,
        wallets: {},
      };

      await this.persist(this.state);
    }

    return this.state;
  }

  private upsertWallet(state: WalletFileShape, userId: string, displayName: string): WalletRecord {
    const existing = state.wallets[userId];

    if (existing) {
      existing.displayName = displayName;
      Object.assign(existing, normalizeWalletRecord(existing));
      return existing;
    }

    const created = createWallet(userId, displayName, this.startingBalance);
    state.wallets[userId] = created;
    return created;
  }

  private upsertRivalry(wallet: WalletRecord, opponentId: string, opponentName: string, outcome: "win" | "loss"): void {
    const existing = wallet.rivalries[opponentId];

    if (existing) {
      existing.opponentName = opponentName;
      if (outcome === "win") existing.wins += 1;
      else existing.losses += 1;
      return;
    }

    wallet.rivalries[opponentId] = {
      opponentId,
      opponentName,
      wins: outcome === "win" ? 1 : 0,
      losses: outcome === "loss" ? 1 : 0,
    };
  }

  private async persist(state: WalletFileShape): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }
}

export const DEFAULT_PAZAAK_SIDEBOARD_NAME = "default";

export interface NamedPazaakSideboardRecord {
  name: string;
  tokens: readonly string[];
  updatedAt: string;
}

export interface SavedPazaakSideboardRecord {
  userId: string;
  displayName: string;
  name: string;
  tokens: readonly string[];
  updatedAt: string;
  isActive: boolean;
}

export interface SavedPazaakSideboardCollectionRecord {
  userId: string;
  displayName: string;
  activeName: string | null;
  sideboards: readonly SavedPazaakSideboardRecord[];
  updatedAt: string;
}

interface LegacySavedPazaakSideboardRecord {
  userId: string;
  displayName: string;
  tokens: readonly string[];
  updatedAt: string;
}

interface StoredPazaakSideboardCollectionRecord {
  userId: string;
  displayName: string;
  activeName: string | null;
  sideboards: Record<string, NamedPazaakSideboardRecord>;
  updatedAt: string;
}

interface LegacySavedPazaakSideboardFileShape {
  version: 1;
  sideboards: Record<string, LegacySavedPazaakSideboardRecord>;
}

interface SavedPazaakSideboardFileShape {
  version: 2;
  sideboards: Record<string, StoredPazaakSideboardCollectionRecord>;
}

const normalizePazaakSideboardName = (name: string): string => name.trim().replace(/\s+/gu, " ").toLowerCase();

const cloneNamedSideboard = (sideboard: NamedPazaakSideboardRecord): NamedPazaakSideboardRecord => ({
  ...sideboard,
  tokens: [...sideboard.tokens],
});

const cloneSideboard = (
  user: StoredPazaakSideboardCollectionRecord,
  sideboard: NamedPazaakSideboardRecord,
  sideboardKey: string,
): SavedPazaakSideboardRecord => ({
  userId: user.userId,
  displayName: user.displayName,
  name: sideboard.name,
  tokens: [...sideboard.tokens],
  updatedAt: sideboard.updatedAt,
  isActive: user.activeName === sideboardKey,
});

const cloneSideboardCollection = (
  user: StoredPazaakSideboardCollectionRecord,
): SavedPazaakSideboardCollectionRecord => ({
  userId: user.userId,
  displayName: user.displayName,
  activeName: user.activeName,
  sideboards: Object.entries(user.sideboards)
    .map(([key, sideboard]) => cloneSideboard(user, sideboard, key))
    .sort((left, right) => Number(right.isActive) - Number(left.isActive) || left.name.localeCompare(right.name)),
  updatedAt: user.updatedAt,
});

const createSideboardCollection = (userId: string, displayName: string): StoredPazaakSideboardCollectionRecord => ({
  userId,
  displayName,
  activeName: null,
  sideboards: {},
  updatedAt: new Date().toISOString(),
});

const migrateLegacySideboards = (legacy: LegacySavedPazaakSideboardFileShape): SavedPazaakSideboardFileShape => {
  const sideboards: Record<string, StoredPazaakSideboardCollectionRecord> = {};

  for (const [userId, sideboard] of Object.entries(legacy.sideboards ?? {})) {
    sideboards[userId] = {
      userId: sideboard.userId,
      displayName: sideboard.displayName,
      activeName: DEFAULT_PAZAAK_SIDEBOARD_NAME,
      sideboards: {
        [DEFAULT_PAZAAK_SIDEBOARD_NAME]: {
          name: DEFAULT_PAZAAK_SIDEBOARD_NAME,
          tokens: [...sideboard.tokens],
          updatedAt: sideboard.updatedAt,
        },
      },
      updatedAt: sideboard.updatedAt,
    };
  }

  return {
    version: 2,
    sideboards,
  };
};

export class JsonPazaakSideboardRepository {
  private state?: SavedPazaakSideboardFileShape;

  public constructor(private readonly filePath: string) {}

  public async getSideboard(userId: string, name?: string): Promise<SavedPazaakSideboardRecord | undefined> {
    const state = await this.ensureState();
    const user = state.sideboards[userId];

    if (!user) {
      return undefined;
    }

    const key = name ? normalizePazaakSideboardName(name) : user.activeName;

    if (!key) {
      return undefined;
    }

    const sideboard = user.sideboards[key];
    return sideboard ? cloneSideboard(user, sideboard, key) : undefined;
  }

  public async listSideboards(userId: string, displayName?: string): Promise<SavedPazaakSideboardCollectionRecord> {
    const state = await this.ensureState();
    const user = state.sideboards[userId];

    if (!user) {
      return {
        userId,
        displayName: displayName ?? userId,
        activeName: null,
        sideboards: [],
        updatedAt: new Date(0).toISOString(),
      };
    }

    return cloneSideboardCollection(user);
  }

  public async saveSideboard(
    userId: string,
    displayName: string,
    tokens: readonly string[],
    name?: string,
    makeActive = true,
  ): Promise<SavedPazaakSideboardRecord> {
    const state = await this.ensureState();
    const user = this.upsertSideboardCollection(state, userId, displayName);
    const resolvedName = name?.trim().replace(/\s+/gu, " ") || user.activeName || DEFAULT_PAZAAK_SIDEBOARD_NAME;
    const sideboardKey = normalizePazaakSideboardName(resolvedName);
    const updatedAt = new Date().toISOString();

    user.sideboards[sideboardKey] = {
      name: resolvedName,
      tokens: [...tokens],
      updatedAt,
    };

    if (makeActive || !user.activeName) {
      user.activeName = sideboardKey;
    }

    user.updatedAt = updatedAt;
    await this.persist(state);

    return cloneSideboard(user, user.sideboards[sideboardKey]!, sideboardKey);
  }

  public async setActiveSideboard(userId: string, displayName: string, name: string): Promise<SavedPazaakSideboardRecord> {
    const state = await this.ensureState();
    const user = this.upsertSideboardCollection(state, userId, displayName);
    const sideboardKey = normalizePazaakSideboardName(name);
    const sideboard = user.sideboards[sideboardKey];

    if (!sideboard) {
      throw new Error(`No saved sideboard named "${name}" exists.`);
    }

    user.activeName = sideboardKey;
    user.updatedAt = new Date().toISOString();
    await this.persist(state);

    return cloneSideboard(user, sideboard, sideboardKey);
  }

  public async clearSideboard(userId: string, name?: string): Promise<boolean> {
    const state = await this.ensureState();
    const user = state.sideboards[userId];

    if (!user) {
      return false;
    }

    const sideboardKey = name ? normalizePazaakSideboardName(name) : user.activeName;

    if (!sideboardKey || !user.sideboards[sideboardKey]) {
      return false;
    }

    delete user.sideboards[sideboardKey];

    const remainingKeys = Object.keys(user.sideboards).sort((left, right) => user.sideboards[left]!.name.localeCompare(user.sideboards[right]!.name));

    if (remainingKeys.length === 0) {
      delete state.sideboards[userId];
    } else {
      if (user.activeName === sideboardKey) {
        user.activeName = remainingKeys[0]!;
      }

      user.updatedAt = new Date().toISOString();
    }

    await this.persist(state);
    return true;
  }

  private async ensureState(): Promise<SavedPazaakSideboardFileShape> {
    if (this.state) {
      return this.state;
    }

    await mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as SavedPazaakSideboardFileShape | LegacySavedPazaakSideboardFileShape;
      this.state = parsed.version === 2 ? parsed as SavedPazaakSideboardFileShape : migrateLegacySideboards(parsed as LegacySavedPazaakSideboardFileShape);
    } catch {
      this.state = {
        version: 2,
        sideboards: {},
      };
    }

    await this.persist(this.state);

    return this.state;
  }

  private upsertSideboardCollection(
    state: SavedPazaakSideboardFileShape,
    userId: string,
    displayName: string,
  ): StoredPazaakSideboardCollectionRecord {
    const existing = state.sideboards[userId];

    if (existing) {
      existing.displayName = displayName;
      return existing;
    }

    const created = createSideboardCollection(userId, displayName);
    state.sideboards[userId] = created;
    return created;
  }

  private async persist(state: SavedPazaakSideboardFileShape): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }
}

// ---------------------------------------------------------------------------
// Designation preset repository
// ---------------------------------------------------------------------------

export interface DesignationPresetRecord {
  userId: string;
  guildId: string;
  roleIds: readonly string[];
  updatedAt: string;
}

interface DesignationPresetFileShape {
  version: 1;
  presets: Record<string, DesignationPresetRecord>;
}

const presetKey = (guildId: string, userId: string): string => `${guildId}:${userId}`;

export class JsonDesignationPresetRepository {
  private state?: DesignationPresetFileShape;

  public constructor(private readonly filePath: string) {}

  public async getPreset(guildId: string, userId: string): Promise<readonly string[] | undefined> {
    const state = await this.ensureState();
    return state.presets[presetKey(guildId, userId)]?.roleIds;
  }

  public async savePreset(guildId: string, userId: string, roleIds: readonly string[]): Promise<void> {
    const state = await this.ensureState();
    state.presets[presetKey(guildId, userId)] = {
      userId,
      guildId,
      roleIds: [...roleIds],
      updatedAt: new Date().toISOString(),
    };
    await this.persist(state);
  }

  private async ensureState(): Promise<DesignationPresetFileShape> {
    if (this.state) {
      return this.state;
    }

    await mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, "utf8");
      this.state = JSON.parse(raw) as DesignationPresetFileShape;
    } catch {
      this.state = { version: 1, presets: {} };
      await this.persist(this.state);
    }

    return this.state;
  }

  private async persist(state: DesignationPresetFileShape): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }
}

// ---------------------------------------------------------------------------
// Cross-platform Pazaak repositories
// ---------------------------------------------------------------------------

export interface MatchmakingQueueRecord {
  userId: string;
  displayName: string;
  mmr: number;
  preferredMaxPlayers: number;
  enqueuedAt: string;
}

interface MatchmakingQueueFileShape {
  version: 1;
  queue: Record<string, MatchmakingQueueRecord>;
}

const cloneQueueRecord = (record: MatchmakingQueueRecord): MatchmakingQueueRecord => ({ ...record });

export class JsonPazaakMatchmakingQueueRepository {
  private state?: MatchmakingQueueFileShape;

  public constructor(private readonly filePath: string) {}

  public async list(): Promise<readonly MatchmakingQueueRecord[]> {
    const state = await this.ensureState();
    return Object.values(state.queue)
      .map(cloneQueueRecord)
      .sort((left, right) => left.enqueuedAt.localeCompare(right.enqueuedAt));
  }

  public async get(userId: string): Promise<MatchmakingQueueRecord | undefined> {
    const state = await this.ensureState();
    const record = state.queue[userId];
    return record ? cloneQueueRecord(record) : undefined;
  }

  public async enqueue(record: Omit<MatchmakingQueueRecord, "enqueuedAt">): Promise<MatchmakingQueueRecord> {
    const state = await this.ensureState();
    const nextRecord: MatchmakingQueueRecord = {
      ...record,
      preferredMaxPlayers: Math.max(2, Math.min(5, record.preferredMaxPlayers)),
      enqueuedAt: state.queue[record.userId]?.enqueuedAt ?? new Date().toISOString(),
    };
    state.queue[record.userId] = nextRecord;
    await this.persist(state);
    return cloneQueueRecord(nextRecord);
  }

  public async remove(userId: string): Promise<boolean> {
    const state = await this.ensureState();

    if (!state.queue[userId]) {
      return false;
    }

    delete state.queue[userId];
    await this.persist(state);
    return true;
  }

  private async ensureState(): Promise<MatchmakingQueueFileShape> {
    if (this.state) return this.state;
    await mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, "utf8");
      this.state = JSON.parse(raw) as MatchmakingQueueFileShape;
    } catch {
      this.state = { version: 1, queue: {} };
      await this.persist(this.state);
    }

    return this.state;
  }

  private async persist(state: MatchmakingQueueFileShape): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }
}

export type PazaakLobbyStatus = "waiting" | "in_game" | "closed";

export interface PazaakLobbyPlayerRecord {
  userId: string;
  displayName: string;
  ready: boolean;
  isHost: boolean;
  isAi: boolean;
  aiDifficulty?: "easy" | "hard" | "professional" | undefined;
  joinedAt: string;
}

export interface PazaakLobbyRecord {
  id: string;
  name: string;
  hostUserId: string;
  maxPlayers: number;
  passwordHash: string | null;
  status: PazaakLobbyStatus;
  matchId: string | null;
  players: readonly PazaakLobbyPlayerRecord[];
  createdAt: string;
  updatedAt: string;
}

interface PazaakLobbyFileShape {
  version: 1;
  lobbies: Record<string, PazaakLobbyRecord>;
}

const hashLobbyPassword = (password: string): string => createHash("sha256").update(password).digest("hex");
const cloneLobby = (lobby: PazaakLobbyRecord): PazaakLobbyRecord => ({
  ...lobby,
  players: lobby.players.map((player) => ({ ...player })),
});

export class JsonPazaakLobbyRepository {
  private state?: PazaakLobbyFileShape;

  public constructor(private readonly filePath: string) {}

  public async listOpen(): Promise<readonly PazaakLobbyRecord[]> {
    const state = await this.ensureState();
    return Object.values(state.lobbies)
      .filter((lobby) => lobby.status === "waiting")
      .map(cloneLobby)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  public async get(lobbyId: string): Promise<PazaakLobbyRecord | undefined> {
    const state = await this.ensureState();
    const lobby = state.lobbies[lobbyId];
    return lobby ? cloneLobby(lobby) : undefined;
  }

  public async create(input: {
    name: string;
    hostUserId: string;
    hostName: string;
    maxPlayers: number;
    password?: string | undefined;
  }): Promise<PazaakLobbyRecord> {
    const state = await this.ensureState();
    const now = new Date().toISOString();
    const lobby: PazaakLobbyRecord = {
      id: randomUUID(),
      name: input.name.trim() || `${input.hostName}'s Table`,
      hostUserId: input.hostUserId,
      maxPlayers: Math.max(2, Math.min(5, input.maxPlayers)),
      passwordHash: input.password ? hashLobbyPassword(input.password) : null,
      status: "waiting",
      matchId: null,
      players: [{
        userId: input.hostUserId,
        displayName: input.hostName,
        ready: true,
        isHost: true,
        isAi: false,
        joinedAt: now,
      }],
      createdAt: now,
      updatedAt: now,
    };
    state.lobbies[lobby.id] = lobby;
    await this.persist(state);
    return cloneLobby(lobby);
  }

  public async join(lobbyId: string, input: { userId: string; displayName: string; password?: string | undefined }): Promise<PazaakLobbyRecord> {
    const state = await this.ensureState();
    const lobby = this.getMutableLobby(state, lobbyId);
    this.assertLobbyPassword(lobby, input.password);

    if (lobby.players.some((player) => player.userId === input.userId)) {
      return cloneLobby(lobby);
    }

    if (lobby.players.length >= lobby.maxPlayers) {
      throw new Error("That lobby is full.");
    }

    lobby.players = [...lobby.players, {
      userId: input.userId,
      displayName: input.displayName,
      ready: false,
      isHost: false,
      isAi: false,
      joinedAt: new Date().toISOString(),
    }];
    lobby.updatedAt = new Date().toISOString();
    await this.persist(state);
    return cloneLobby(lobby);
  }

  public async setReady(lobbyId: string, userId: string, ready: boolean): Promise<PazaakLobbyRecord> {
    const state = await this.ensureState();
    const lobby = this.getMutableLobby(state, lobbyId);
    lobby.players = lobby.players.map((player) => player.userId === userId ? { ...player, ready } : player);
    lobby.updatedAt = new Date().toISOString();
    await this.persist(state);
    return cloneLobby(lobby);
  }

  public async addAi(lobbyId: string, hostUserId: string, difficulty: "easy" | "hard" | "professional"): Promise<PazaakLobbyRecord> {
    const state = await this.ensureState();
    const lobby = this.getMutableLobby(state, lobbyId);

    if (lobby.hostUserId !== hostUserId) {
      throw new Error("Only the lobby host can add AI seats.");
    }

    if (lobby.players.length >= lobby.maxPlayers) {
      throw new Error("That lobby is full.");
    }

    const aiNumber = lobby.players.filter((player) => player.isAi).length + 1;
    lobby.players = [...lobby.players, {
      userId: `ai:${lobby.id}:${aiNumber}`,
      displayName: `${difficulty[0]!.toUpperCase()}${difficulty.slice(1)} AI ${aiNumber}`,
      ready: true,
      isHost: false,
      isAi: true,
      aiDifficulty: difficulty,
      joinedAt: new Date().toISOString(),
    }];
    lobby.updatedAt = new Date().toISOString();
    await this.persist(state);
    return cloneLobby(lobby);
  }

  public async leave(lobbyId: string, userId: string): Promise<PazaakLobbyRecord | undefined> {
    const state = await this.ensureState();
    const lobby = state.lobbies[lobbyId];

    if (!lobby) return undefined;

    const players = lobby.players.filter((player) => player.userId !== userId);

    if (players.length === 0 || lobby.hostUserId === userId) {
      lobby.status = "closed";
      lobby.players = players;
    } else {
      lobby.players = players;
    }

    lobby.updatedAt = new Date().toISOString();
    await this.persist(state);
    return cloneLobby(lobby);
  }

  public async markInGame(lobbyId: string, matchId: string): Promise<PazaakLobbyRecord> {
    const state = await this.ensureState();
    const lobby = this.getMutableLobby(state, lobbyId);
    lobby.status = "in_game";
    lobby.matchId = matchId;
    lobby.updatedAt = new Date().toISOString();
    await this.persist(state);
    return cloneLobby(lobby);
  }

  private async ensureState(): Promise<PazaakLobbyFileShape> {
    if (this.state) return this.state;
    await mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, "utf8");
      this.state = JSON.parse(raw) as PazaakLobbyFileShape;
    } catch {
      this.state = { version: 1, lobbies: {} };
      await this.persist(this.state);
    }

    return this.state;
  }

  private getMutableLobby(state: PazaakLobbyFileShape, lobbyId: string): PazaakLobbyRecord {
    const lobby = state.lobbies[lobbyId];

    if (!lobby || lobby.status !== "waiting") {
      throw new Error("That lobby is not available.");
    }

    return lobby;
  }

  private assertLobbyPassword(lobby: PazaakLobbyRecord, password?: string | undefined): void {
    if (lobby.passwordHash && hashLobbyPassword(password ?? "") !== lobby.passwordHash) {
      throw new Error("Incorrect lobby password.");
    }
  }

  private async persist(state: PazaakLobbyFileShape): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }
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

interface PazaakMatchHistoryFileShape {
  version: 1;
  matches: Record<string, PazaakMatchHistoryRecord>;
}

const cloneHistoryRecord = (record: PazaakMatchHistoryRecord): PazaakMatchHistoryRecord => ({ ...record });

export class JsonPazaakMatchHistoryRepository {
  private state?: PazaakMatchHistoryFileShape;

  public constructor(private readonly filePath: string) {}

  public async append(record: PazaakMatchHistoryRecord): Promise<PazaakMatchHistoryRecord> {
    const state = await this.ensureState();
    state.matches[record.matchId] = { ...record };
    await this.persist(state);
    return cloneHistoryRecord(record);
  }

  public async listForUser(userId: string, limit = 25): Promise<readonly PazaakMatchHistoryRecord[]> {
    const state = await this.ensureState();
    return Object.values(state.matches)
      .filter((match) => match.winnerId === userId || match.loserId === userId)
      .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
      .slice(0, Math.max(1, Math.min(100, limit)))
      .map(cloneHistoryRecord);
  }

  private async ensureState(): Promise<PazaakMatchHistoryFileShape> {
    if (this.state) return this.state;
    await mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, "utf8");
      this.state = JSON.parse(raw) as PazaakMatchHistoryFileShape;
    } catch {
      this.state = { version: 1, matches: {} };
      await this.persist(this.state);
    }

    return this.state;
  }

  private async persist(state: PazaakMatchHistoryFileShape): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }
}

export class JsonPazaakLeaderboardRepository {
  public constructor(private readonly walletRepository: JsonWalletRepository) {}

  public async list(limit = 25): Promise<readonly WalletRecord[]> {
    const wallets = await this.walletRepository.listWallets();
    return [...wallets]
      .sort((left, right) => right.mmr - left.mmr || right.gamesWon - left.gamesWon || right.wins - left.wins)
      .slice(0, Math.max(1, Math.min(100, limit)));
  }
}
