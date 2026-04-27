import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type MessageEditOptions,
  type ModalSubmitInteraction,
  type RESTPostAPIApplicationCommandsJSONBody,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type StringSelectMenuInteraction,
} from "discord.js";

import { loadPazaakBotConfig } from "@openkotor/config";
import { createBotClient, createLogger, deployGuildCommands, toErrorMessage } from "@openkotor/core";
import { asBulletList, buildErrorEmbed, buildInfoEmbed, buildSuccessEmbed, buildWarningEmbed } from "@openkotor/discord-ui";
import {
  DEFAULT_PAZAAK_SIDEBOARD_NAME,
  JsonPazaakAccountRepository,
  JsonPazaakLobbyRepository,
  JsonPazaakMatchHistoryRepository,
  JsonPazaakMatchmakingQueueRepository,
  JsonPazaakSideboardRepository,
  JsonWalletRepository,
  resolveDataFile,
  type RivalryRecord,
} from "@openkotor/persistence";
import { personaProfiles } from "@openkotor/personas";

import {
  CUSTOM_SIDE_DECK_LABEL,
  PazaakCoordinator,
  canonicalTslSideDecks,
  getCanonicalSideDeckDefinition,
  isCanonicalSideDeckSupported,
  getCurrentPlayer,
  getAdvisorSnapshotForPlayer,
  getOpponentForUser,
  getPlayerForUser,
  getSideCardOptionsForPlayer,
  recommendMoveForPlayer,
  renderBoardLine,
  renderHandLine,
  HAND_SIZE,
  SETS_TO_WIN,
  MAX_BOARD_SIZE,
  normalizeSideDeckToken,
  WIN_SCORE,
  SIDE_DECK_SIZE,
  assertCustomSideDeckTokenLimits,
  getCustomSideDeckLimitErrors,
  type AdvisorAlternative,
  type AdvisorDifficulty,
  type AdvisorSnapshot,
  type MatchPlayerState,
  supportedSideDeckTokens,
  type PazaakMatch,
  type PendingChallenge,
  type SideCard,
  type SideDeckChoice,
} from "./pazaak.js";
import { MatchStore } from "./match-store.js";
import { createApiServer } from "./api-server.js";

const logger = createLogger("pazaak-bot");
const config = loadPazaakBotConfig();
const accountRepository = new JsonPazaakAccountRepository(resolveDataFile(config.dataDir, "accounts.json"));
const walletRepository = new JsonWalletRepository(resolveDataFile(config.dataDir, "wallets.json"), config.startingCredits);
const sideboardRepository = new JsonPazaakSideboardRepository(resolveDataFile(config.dataDir, "custom-sideboards.json"));
const matchmakingQueueRepository = new JsonPazaakMatchmakingQueueRepository(resolveDataFile(config.dataDir, "matchmaking-queue.json"));
const lobbyRepository = new JsonPazaakLobbyRepository(resolveDataFile(config.dataDir, "lobbies.json"));
const matchHistoryRepository = new JsonPazaakMatchHistoryRepository(resolveDataFile(config.dataDir, "match-history.json"));
const matchStore = new MatchStore(config.dataDir);
const coordinator = new PazaakCoordinator(matchStore, {
  turnTimeoutMs: config.turnTimerSeconds * 1000,
  disconnectForfeitMs: config.disconnectForfeitMs,
});
const runtimeTslDecks = canonicalTslSideDecks.filter((deck) => deck.supported && deck.id >= 10);
const runtimeTslDifficultyLabels: Readonly<Record<number, string>> = {
  10: "Very Easy",
  11: "Easy",
  12: "Average",
  13: "Hard",
  14: "Very Hard",
};
const runtimeTslDeckChoices = runtimeTslDecks.map((deck) => ({
  name: `${runtimeTslDifficultyLabels[deck.id] ?? deck.label} (#${deck.id})`,
  value: deck.id,
}));
const SIDEBOARD_MODAL_FIRST_FIELD_ID = "tokens-a";
const SIDEBOARD_MODAL_SECOND_FIELD_ID = "tokens-b";
const SIDEBOARD_EDITOR_PAGE_SIZE = 3;
const SIDEBOARD_NAME_MAX_LENGTH = 32;
const MAX_DECK_SELECTION_OPTIONS = 25;
const CUSTOM_SIDEBOARD_SELECTION_PAGE_SIZE = 25;
const SIDEBOARD_LIBRARY_PAGE_SIZE = 25;
const SIDEBOARD_SEARCH_FIELD_ID = "query";
const SIDEBOARD_SEARCH_QUERY_MAX_LENGTH = 20;
const DEFAULT_CUSTOM_SIDEBOARD_TOKENS = ["+1", "-2", "*3", "$$", "TT", "F1", "F2", "VV", "+4", "-5"] as const;
const sideboardTokenDescriptions: Readonly<Record<string, string>> = {
  "+1": "Fixed plus 1",
  "+2": "Fixed plus 2",
  "+3": "Fixed plus 3",
  "+4": "Fixed plus 4",
  "+5": "Fixed plus 5",
  "+6": "Fixed plus 6",
  "-1": "Fixed minus 1",
  "-2": "Fixed minus 2",
  "-3": "Fixed minus 3",
  "-4": "Fixed minus 4",
  "-5": "Fixed minus 5",
  "-6": "Fixed minus 6",
  "*1": "Flip plus/minus 1",
  "*2": "Flip plus/minus 2",
  "*3": "Flip plus/minus 3",
  "*4": "Flip plus/minus 4",
  "*5": "Flip plus/minus 5",
  "*6": "Flip plus/minus 6",
  "$$": "D: copy the previous resolved board card",
  TT: "±1T: choose +1 or -1 and win exact ties this set",
  F1: "2&4: flip all visible 2s and 4s",
  F2: "3&6: flip all visible 3s and 6s",
  VV: "1±2: choose +1, +2, -1, or -2",
};

const formatSideboardTokens = (tokens: readonly string[]): string => tokens.join(" ");

const resolveGameUserId = (legacyGameUserId: string | null, accountId: string): string => legacyGameUserId ?? accountId;

const resolveCommandActor = async (interaction: ChatInputCommandInteraction): Promise<{ userId: string; displayName: string }> => {
  const { account } = await accountRepository.ensureDiscordAccount({
    discordUserId: interaction.user.id,
    username: interaction.user.username,
    displayName: interaction.user.displayName ?? interaction.user.username,
  });

  return {
    userId: resolveGameUserId(account.legacyGameUserId, account.accountId),
    displayName: account.displayName,
  };
};

const buildActivityLobbyComponents = (label = "Open Activity Lobby") => [
  new ActionRowBuilder<ButtonBuilder>().addComponents(buildActivityLobbyButton(label)),
];

const normalizeRequestedSideboardName = (name?: string): string | undefined => {
  if (!name) {
    return undefined;
  }

  const normalized = name.trim().replace(/\s+/gu, " ");

  if (!normalized) {
    throw new Error("Sideboard names cannot be empty.");
  }

  if (normalized.length > SIDEBOARD_NAME_MAX_LENGTH) {
    throw new Error(`Sideboard names must be ${SIDEBOARD_NAME_MAX_LENGTH} characters or fewer.`);
  }

  return normalized;
};

const formatSideboardName = (name: string): string => name === DEFAULT_PAZAAK_SIDEBOARD_NAME ? `${name} (default)` : name;

const buildCustomSideboardLabel = (name: string): string => `${CUSTOM_SIDE_DECK_LABEL}: ${formatSideboardName(name)}`;

const buildActivityLobbyButton = (label = "Open Activity Lobby"): ButtonBuilder => {
  return new ButtonBuilder()
    .setURL(config.activityUrl)
    .setLabel(label)
    .setStyle(ButtonStyle.Link);
};

const getSideboardLibraryPage = (savedSideboards: readonly { name: string; isActive: boolean }[], requestedPage = 0): number => {
  const pageCount = Math.ceil(savedSideboards.length / SIDEBOARD_LIBRARY_PAGE_SIZE);
  const activeIndex = savedSideboards.findIndex((sideboard) => sideboard.isActive);
  const fallbackPage = activeIndex >= 0 ? Math.floor(activeIndex / SIDEBOARD_LIBRARY_PAGE_SIZE) : 0;
  return normalizeSelectionPage(Number.isNaN(requestedPage) ? fallbackPage : requestedPage, pageCount);
};

const getEffectiveSideboardTokens = (tokens?: readonly string[]): string[] => {
  return [...(tokens && tokens.length === SIDE_DECK_SIZE ? tokens : DEFAULT_CUSTOM_SIDEBOARD_TOKENS)];
};

const parseCustomSideboardTokens = (input: string): string[] => {
  const rawTokens = input.split(/[\s,]+/u).map((token) => token.trim()).filter(Boolean);

  if (rawTokens.length !== SIDE_DECK_SIZE) {
    throw new Error(`Custom sideboards must contain exactly ${SIDE_DECK_SIZE} tokens.`);
  }

  const tokens = rawTokens.map((token) => {
    const normalized = normalizeSideDeckToken(token);

    if (!normalized) {
      throw new Error(`Unsupported sideboard token \"${token}\". Supported tokens: ${supportedSideDeckTokens.join(" ")}.`);
    }

    return normalized;
  });

  assertCustomSideDeckTokenLimits(tokens);
  return tokens;
};

const buildDeckSelectionDescription = (
  savedDeckId?: number,
  savedCustomSideboardNames: readonly string[] = [],
): string => {
  const extras = [
    savedCustomSideboardNames.length > 0
      ? savedCustomSideboardNames.length === 1
        ? `use your saved ${CUSTOM_SIDE_DECK_LABEL.toLowerCase()} (${formatSideboardName(savedCustomSideboardNames[0]!)})`
        : `choose from your saved ${CUSTOM_SIDE_DECK_LABEL.toLowerCase()}s`
      : null,
    savedDeckId !== undefined ? `use your saved preset ${formatDeckDisplayName(savedDeckId)}` : null,
  ].filter((fragment): fragment is string => Boolean(fragment));

  if (extras.length === 0) {
    return "Pick your own sideboard before the match starts, or leave it on Auto for a random supported runtime deck.";
  }

  if (extras.length === 1) {
    return `Pick your own sideboard before the match starts, ${extras[0]}, or leave it on Auto for a random supported runtime deck.`;
  }

  return `Pick your own sideboard before the match starts, ${extras[0]}, ${extras[1]}, or leave it on Auto for a random supported runtime deck.`;
};

const normalizeSideboardSearchQuery = (query?: string): string | undefined => {
  if (!query) {
    return undefined;
  }

  const normalized = query.trim().replace(/\s+/gu, " ").slice(0, SIDEBOARD_SEARCH_QUERY_MAX_LENGTH);
  return normalized.length > 0 ? normalized : undefined;
};

const encodeSideboardSearchQuery = (query?: string): string => {
  const normalizedQuery = normalizeSideboardSearchQuery(query);
  return normalizedQuery ? encodeURIComponent(normalizedQuery) : "_";
};

const decodeSideboardSearchQuery = (query?: string): string | undefined => {
  if (!query || query === "_") {
    return undefined;
  }

  try {
    return normalizeSideboardSearchQuery(decodeURIComponent(query));
  } catch {
    return undefined;
  }
};

const filterSavedSideboards = <T extends { name: string }>(
  savedSideboards: readonly T[],
  searchQuery?: string,
): T[] => {
  const normalizedQuery = normalizeSideboardSearchQuery(searchQuery)?.toLocaleLowerCase();

  if (!normalizedQuery) {
    return [...savedSideboards];
  }

  return savedSideboards.filter((sideboard) => sideboard.name.toLocaleLowerCase().includes(normalizedQuery));
};

const normalizeSelectionPage = (page: number, pageCount: number): number => {
  if (pageCount <= 0) {
    return 0;
  }

  return Math.min(Math.max(page, 0), pageCount - 1);
};

const isRuntimeTslDeckSupported = (deckId: number): boolean => {
  return runtimeTslDecks.some((deck) => deck.id === deckId);
};

const formatDeckDisplayName = (deckId: number | null | undefined, fallbackLabel?: string | null): string => {
  if (deckId === null || deckId === undefined) {
    return fallbackLabel ?? "Unknown";
  }

  const runtimeLabel = runtimeTslDifficultyLabels[deckId];

  if (runtimeLabel) {
    return `${runtimeLabel} (#${deckId})`;
  }

  if (fallbackLabel) {
    return `${fallbackLabel} (#${deckId})`;
  }

  return `Deck #${deckId}`;
};

const sideCardToToken = (card: SideCard): string => {
  switch (card.type) {
    case "plus":
      return `+${card.value}`;
    case "minus":
      return `-${card.value}`;
    case "flip":
      return `*${card.value}`;
    case "copy_previous":
      return "$$";
    case "tiebreaker":
      return "TT";
    case "flip_two_four":
      return "F1";
    case "flip_three_six":
      return "F2";
    case "value_change":
      return "VV";
  }
};

const getRematchDeckSeed = (player: MatchPlayerState): { deckId?: number; customDeck?: { tokens: readonly string[]; label: string } } => {
  if (player.sideDeckId !== null) {
    return { deckId: player.sideDeckId };
  }

  return {
    customDeck: {
      tokens: player.sideDeck.map(sideCardToToken),
      label: player.sideDeckLabel ?? CUSTOM_SIDE_DECK_LABEL,
    },
  };
};

const pazaakCommand = new SlashCommandBuilder()
  .setName("pazaak")
  .setDescription("Pazaak Bot runs a fake-credit pazaak table.")
  .addSubcommand((subcommand) => subcommand.setName("rules").setDescription("Explain the current pazaak ruleset."))
  .addSubcommand((subcommand) => subcommand.setName("decks").setDescription("List the supported canonical sideboards and their ids."))
  .addSubcommand((subcommand) =>
    subcommand
      .setName("sideboard")
      .setDescription("Show, save, or clear your saved custom 10-card sideboard.")
      .addStringOption((option) =>
        option
          .setName("cards")
          .setDescription("Ten side-card tokens separated by spaces or commas.")
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName("name")
          .setDescription("Optional saved sideboard name to save, activate, or clear.")
          .setRequired(false),
      )
      .addBooleanOption((option) =>
        option.setName("clear").setDescription("Clear your saved custom sideboard instead of saving one."),
      ),
  )
  .addSubcommand((subcommand) => subcommand.setName("spectate").setDescription("Post a read-only mirror of the active board in this channel.")
    .addUserOption((option) =>
      option.setName("player").setDescription("Optional player whose active match should be mirrored.").setRequired(false),
    ))
  .addSubcommand((subcommand) =>
    subcommand
      .setName("preset")
      .setDescription("Show, save, or clear your default runtime TSL deck preset.")
      .addIntegerOption((option) =>
        option
          .setName("difficulty")
          .setDescription("Optional runtime TSL preset to save as your default.")
          .setMinValue(10)
          .setMaxValue(14)
          .addChoices(...runtimeTslDeckChoices),
      )
      .addBooleanOption((option) =>
        option.setName("clear").setDescription("Clear your saved default preset instead of saving one."),
      ),
  )
  .addSubcommand((subcommand) => subcommand.setName("wallet").setDescription("Show your current pazaak wallet."))
  .addSubcommand((subcommand) => subcommand.setName("daily").setDescription("Claim your daily login bonus from the table."))
  .addSubcommand((subcommand) => subcommand.setName("leaderboard").setDescription("Show the richest pazaak players in the current wallet file."))
  .addSubcommand((subcommand) => subcommand.setName("rivalry").setDescription("Show your full rivalry history at the pazaak table."))
  .addSubcommand((subcommand) =>
    subcommand
      .setName("queue")
      .setDescription("Join, leave, or inspect the cross-platform matchmaking queue.")
      .addStringOption((option) =>
        option
          .setName("action")
          .setDescription("Queue action to run.")
          .setRequired(true)
          .addChoices(
            { name: "Join", value: "join" },
            { name: "Leave", value: "leave" },
            { name: "Status", value: "status" },
          ),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("lobby")
      .setDescription("Manage cross-platform Pazaak lobbies.")
      .addStringOption((option) =>
        option
          .setName("action")
          .setDescription("Lobby action to run.")
          .setRequired(true)
          .addChoices(
            { name: "List", value: "list" },
            { name: "Create", value: "create" },
            { name: "Join", value: "join" },
            { name: "Ready", value: "ready" },
            { name: "Leave", value: "leave" },
            { name: "Add AI", value: "add_ai" },
            { name: "Start", value: "start" },
          ),
      )
      .addStringOption((option) => option.setName("lobby_id").setDescription("Lobby id for join/ready/leave/add AI/start."))
      .addStringOption((option) => option.setName("name").setDescription("Name for a new lobby."))
      .addStringOption((option) =>
        option
          .setName("difficulty")
          .setDescription("AI seat difficulty.")
          .addChoices(
            { name: "Easy", value: "easy" },
            { name: "Hard", value: "hard" },
            { name: "Professional", value: "professional" },
          ),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("ai")
      .setDescription("Start a single-player Pazaak match against an AI seat.")
      .addStringOption((option) =>
        option
          .setName("difficulty")
          .setDescription("AI seat difficulty.")
          .addChoices(
            { name: "Easy", value: "easy" },
            { name: "Hard", value: "hard" },
            { name: "Professional", value: "professional" },
          ),
      ),
  )
  .addSubcommand((subcommand) => {
    return subcommand
      .setName("challenge")
      .setDescription("Challenge another player to a pazaak match.")
      .addUserOption((option) => {
        return option
          .setName("opponent")
          .setDescription("Who should the pazaak table throw into the ring with you?")
          .setRequired(true);
      })
      .addIntegerOption((option) => {
        return option
          .setName("wager")
          .setDescription("How many fake credits are on the table?")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(5000);
      })
      .addIntegerOption((option) => {
        return option
          .setName("deck")
          .setDescription("Optional runtime TSL difficulty preset for your own sideboard.")
          .setMinValue(10)
          .setMaxValue(14)
          .addChoices(...runtimeTslDeckChoices);
      })
      .addBooleanOption((option) => {
        return option
          .setName("use_custom")
          .setDescription("Use your saved custom sideboard instead of a runtime TSL preset.");
      })
      .addStringOption((option) => {
        return option
          .setName("custom_name")
          .setDescription("Optional saved custom sideboard name to use for this challenge.")
          .setRequired(false);
      });
  });

const pazaakAdminCommand = new SlashCommandBuilder()
  .setName("pazaak-admin")
  .setDescription("Admin controls for the pazaak table.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("challenge")
      .setDescription("Create a fixed-deck or admin-seeded pazaak challenge.")
      .addUserOption((option) =>
        option.setName("challenger").setDescription("Who is issuing the challenge?").setRequired(true),
      )
      .addUserOption((option) =>
        option.setName("opponent").setDescription("Who needs to accept it?").setRequired(true),
      )
      .addIntegerOption((option) =>
        option.setName("wager").setDescription("How many fake credits are on the table?").setRequired(true).setMinValue(1).setMaxValue(5000),
      )
      .addIntegerOption((option) =>
        option.setName("challenger_deck").setDescription("Optional canonical deck id for the challenger.").setMinValue(0).setMaxValue(14),
      )
      .addIntegerOption((option) =>
        option.setName("opponent_deck").setDescription("Optional canonical deck id for the opponent.").setMinValue(0).setMaxValue(14),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("give")
      .setDescription("Add credits to a player's wallet.")
      .addUserOption((option) =>
        option.setName("player").setDescription("Who receives the credits?").setRequired(true),
      )
      .addIntegerOption((option) =>
        option.setName("amount").setDescription("How many credits to add?").setRequired(true).setMinValue(1).setMaxValue(1_000_000),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("take")
      .setDescription("Remove credits from a player's wallet (floored at 0).")
      .addUserOption((option) =>
        option.setName("player").setDescription("Whose credits are being removed?").setRequired(true),
      )
      .addIntegerOption((option) =>
        option.setName("amount").setDescription("How many credits to remove?").setRequired(true).setMinValue(1).setMaxValue(1_000_000),
      ),
  );

const buildRulesEmbed = () => {
  return buildInfoEmbed({
    title: `${personaProfiles.pazaak.displayName} Explains The Rules`,
    description: "Look, these are the KOTOR-flavored table rules. Try not to laugh if I lose again.",
    fields: [
      {
        name: "Match Flow",
        value: asBulletList([
          `Each match is first to ${SETS_TO_WIN} sets.`,
          `Each set aims to get closer to ${WIN_SCORE} without ending the turn over ${WIN_SCORE}.`,
          "A tie starts another set unless one player has a Tiebreaker card.",
          "Your four-card side hand lasts for the whole match. Spent side cards stay spent across later sets and ties.",
          "The loser of a set goes first in the next set. On a tie, the coin-flip opener resumes.",
        ]),
        inline: false,
      },
      {
        name: "Decks",
        value: asBulletList([
          "The main deck contains four copies of cards 1 through 10.",
          `Each player gets a ${SIDE_DECK_SIZE}-card canonical TSL sideboard at match start.`,
          `${HAND_SIZE} side cards are drawn from the sideboard once when the match begins.`,
          "Side cards include fixed (+/−), flip (±), 1±2/VV, D/$$, ±1T/TT, 2&4/F1, and 3&6/F2.",
        ]),
        inline: false,
      },
      {
        name: "Turns",
        value: asBulletList([
          "On your turn, you must draw from the main deck first.",
          `If the draw puts you over ${WIN_SCORE}, you may play one side card to recover before ending the turn.`,
          "After the draw window, stand to hold your total or end the turn to pass priority.",
          `Filling all ${MAX_BOARD_SIZE} board slots without busting wins the set automatically.`,
        ]),
        inline: false,
      },
    ],
  });
};

const buildDeckCatalogEmbed = () => {
  const formatDeckLine = (deck: (typeof canonicalTslSideDecks)[number]): string => {
    return `${formatDeckDisplayName(deck.id, deck.label)}: ${deck.cards.join(" ")}`;
  };

  return buildInfoEmbed({
    title: "Canonical Sideboards",
    description: "These are the player-facing runtime TSL sideboards available in normal matches. Admin-seeded testing rows stay out of the public picker.",
    fields: [
      {
        name: "TSL Match Decks",
        value: runtimeTslDecks.map(formatDeckLine).join("\n"),
        inline: false,
      },
      {
        name: "Token Legend",
        value: "+/- = fixed value | * = flip sign | $$ or D = copy previous | TT = +/-1T | F1 = 2&4 | F2 = 3&6 | VV = 1±2",
        inline: false,
      },
    ],
  });
};

const buildWalletEmbed = async (userId: string, displayName: string) => {
  const wallet = await walletRepository.getWallet(userId, displayName);
  const sideboard = await sideboardRepository.getSideboard(userId);
  const rivalry: RivalryRecord | undefined = walletRepository.topRivalry(wallet);

  const fields = [
    {
      name: "Record",
      value: `Wins: ${wallet.wins}\nLosses: ${wallet.losses}`,
      inline: true,
    },
    {
      name: "Streak",
      value: `Current: ${wallet.streak}\nBest: ${wallet.bestStreak}`,
      inline: true,
    },
  ];

  if (rivalry) {
    fields.push({
      name: "Top Rivalry",
      value: `${rivalry.opponentName}: ${rivalry.wins}W-${rivalry.losses}L`,
      inline: true,
    });
  }

  if (wallet.preferredRuntimeDeckId !== null) {
    fields.push({
      name: "Default Preset",
      value: formatDeckDisplayName(wallet.preferredRuntimeDeckId),
      inline: true,
    });
  }

  if (sideboard) {
    fields.push({
      name: CUSTOM_SIDE_DECK_LABEL,
      value: formatSideboardTokens(sideboard.tokens),
      inline: false,
    });
  }

  const nextDailyMs = wallet.lastDailyAt
    ? Math.max(0, new Date(wallet.lastDailyAt).getTime() + config.dailyCooldownMs - Date.now())
    : 0;
  const dailyNote = nextDailyMs > 0
    ? `Daily bonus available in ${Math.ceil(nextDailyMs / 3_600_000)}h.`
    : "Daily bonus is available — claim it with \`/pazaak daily\`.";

  return buildInfoEmbed({
    title: `${displayName}'s Wallet`,
    description: `I hate that this proves you're doing better than me. Current balance: **${wallet.balance} credits**.\n${dailyNote}`,
    fields,
  });
};

// Streak multiplier tiers: 0-1 = 1x, 2-4 = 1.25x, 5-9 = 1.5x, 10+ = 2x
const streakMultiplier = (streak: number): number => {
  if (streak >= 10) return 2;
  if (streak >= 5) return 1.5;
  if (streak >= 2) return 1.25;
  return 1;
};

const buildDailyEmbed = async (userId: string, displayName: string) => {
  const wallet = await walletRepository.getWallet(userId, displayName);
  const multiplier = streakMultiplier(wallet.wins);
  const scaledBonus = Math.round(config.dailyBonusCredits * multiplier);
  const result = await walletRepository.claimDailyBonus(userId, displayName, scaledBonus, config.dailyCooldownMs);

  if (!result.credited) {
    const hoursLeft = Math.ceil((result.nextEligibleAt - Date.now()) / 3_600_000);
    return buildWarningEmbed({
      title: "Already Claimed",
      description: `You already grabbed today's credits. Try again in about ${hoursLeft}h. I would say I'm impressed by your patience, but I'd be lying.`,
    });
  }

  const bonusNote = multiplier > 1
    ? ` That's a **${multiplier}x streak bonus** on your ${wallet.wins}-win run.`
    : "";

  return buildSuccessEmbed({
    title: "Daily Bonus Claimed",
    description: `Pazaak Bot slides **${result.amount} credits** across the table.${bonusNote}`,
  });
};

const buildRivalryEmbed = async (userId: string, displayName: string) => {
  const wallet = await walletRepository.getWallet(userId, displayName);
  const rivalries = walletRepository.allRivalries(wallet);

  if (rivalries.length === 0) {
    return buildInfoEmbed({
      title: `${displayName}'s Rivalry Record`,
      description: "You have not played enough matches to build a rivalry. Get to the table.",
    });
  }

  return buildInfoEmbed({
    title: `${displayName}'s Rivalry Record`,
    description: `${rivalries.length} opponent${rivalries.length === 1 ? "" : "s"} on record. These are the people you have faced across the pazaak table.`,
    fields: rivalries.slice(0, 10).map((r) => ({
      name: r.opponentName,
      value: `${r.wins}W–${r.losses}L (${r.wins + r.losses} matches)`,
      inline: true,
    })),
  });
};

const buildLeaderboardEmbed = async () => {
  const wallets = await walletRepository.listWallets();

  return buildInfoEmbed({
    title: "Pazaak Leaderboard",
    description: wallets.length > 0 ? "Somehow these people keep winning fake money." : "No one has touched the table yet.",
    fields: wallets.slice(0, 10).map((wallet, index) => ({
      name: `${index + 1}. ${wallet.displayName}`,
      value: `Balance: ${wallet.balance}\nRecord: ${wallet.wins}-${wallet.losses}`,
      inline: true,
    })),
  });
};

const buildQueueEmbed = async (userId: string) => {
  const queue = await matchmakingQueueRepository.get(userId);
  const queuedPlayers = await matchmakingQueueRepository.list();

  return buildInfoEmbed({
    title: "Pazaak Matchmaking Queue",
    description: queue
      ? `You are queued at ${queue.mmr} MMR. The web and Activity clients use this same queue.`
      : "You are not currently queued.",
    fields: [{
      name: "Queued Players",
      value: queuedPlayers.length === 0
        ? "No players are waiting."
        : queuedPlayers.slice(0, 10).map((ticket, index) => `${index + 1}. ${ticket.displayName} (${ticket.mmr} MMR)`).join("\n"),
      inline: false,
    }],
  });
};

const buildLobbyListEmbed = async () => {
  const lobbies = await lobbyRepository.listOpen();

  return buildInfoEmbed({
    title: "Open Pazaak Lobbies",
    description: lobbies.length === 0
      ? "No open tables are waiting right now."
      : `Open these same tables from Discord, the web frontend, or the Activity. Website: ${config.activityUrl}`,
    fields: lobbies.slice(0, 10).map((lobby) => ({
      name: `${lobby.name} (${lobby.players.length}/${lobby.maxPlayers})`,
      value: `ID: ${lobby.id}\nPlayers: ${lobby.players.map((player) => player.displayName).join(", ")}`,
      inline: false,
    })),
  });
};

const normalizeAiDifficulty = (value?: string | null): AdvisorDifficulty => {
  if (value === "easy" || value === "hard" || value === "professional") {
    return value;
  }

  return "professional";
};

const buildPresetEmbed = async (userId: string, displayName: string) => {
  const wallet = await walletRepository.getWallet(userId, displayName);
  const preset = wallet.preferredRuntimeDeckId;

  return buildInfoEmbed({
    title: "Default Runtime Preset",
    description: preset === null
      ? "You do not have a saved runtime TSL deck preset. /pazaak challenge will stay on Auto unless you pass the deck option explicitly."
      : `Saved preset: **${formatDeckDisplayName(preset)}**. Normal /pazaak challenge uses this automatically when you omit the deck option.`,
  });
};

const buildSideboardEmbed = async (userId: string, displayName: string, searchQuery?: string) => {
  const sideboardState = await sideboardRepository.listSideboards(userId, displayName);
  const activeSideboard = sideboardState.sideboards.find((sideboard) => sideboard.isActive);
  const filteredSideboards = filterSavedSideboards(sideboardState.sideboards, searchQuery);
  const normalizedQuery = normalizeSideboardSearchQuery(searchQuery);
  const savedSideboardList = filteredSideboards.length === 0
    ? "No saved sideboards yet."
    : filteredSideboards
      .map((sideboard) => sideboard.isActive ? `• **${formatSideboardName(sideboard.name)}** (active)` : `• ${formatSideboardName(sideboard.name)}`)
      .join("\n");

  return buildInfoEmbed({
    title: CUSTOM_SIDE_DECK_LABEL,
    description: activeSideboard
      ? `Active ${CUSTOM_SIDE_DECK_LABEL.toLowerCase()} for **${displayName}**: **${formatSideboardName(activeSideboard.name)}**.`
      : `You do not have a saved ${CUSTOM_SIDE_DECK_LABEL.toLowerCase()}. Save one with ten tokens separated by spaces or commas. You can keep multiple named sideboards and switch which one is active.`,
    fields: [
      {
        name: activeSideboard ? "Active Cards" : "Example",
        value: activeSideboard
          ? formatSideboardTokens(activeSideboard.tokens)
          : "/pazaak sideboard cards:+1 -2 *3 $$ TT F1 F2 VV +4 -5",
        inline: false,
      },
      {
        name: "Saved Sideboards",
        value: normalizedQuery
          ? `${filteredSideboards.length === 0 ? "No matches." : `Showing ${filteredSideboards.length} of ${sideboardState.sideboards.length} saved sideboards.`}\nSearch: **${normalizedQuery}**\n\n${savedSideboardList}`
          : savedSideboardList,
        inline: false,
      },
      {
        name: "Supported Tokens",
        value: supportedSideDeckTokens.join(" "),
        inline: false,
      },
    ],
  });
};

const buildSideboardComponents = (
  savedSideboards: readonly { name: string; isActive: boolean }[],
  requestedPage = 0,
  searchQuery?: string,
) => {
  const rows: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>> = [];
  const activeSideboard = savedSideboards.find((sideboard) => sideboard.isActive);
  const filteredSideboards = filterSavedSideboards(savedSideboards, searchQuery);
  const encodedQuery = encodeSideboardSearchQuery(searchQuery);
  const safePage = getSideboardLibraryPage(filteredSideboards, requestedPage);
  const pageCount = Math.ceil(filteredSideboards.length / SIDEBOARD_LIBRARY_PAGE_SIZE);
  const start = safePage * SIDEBOARD_LIBRARY_PAGE_SIZE;
  const visibleSideboards = filteredSideboards.slice(start, start + SIDEBOARD_LIBRARY_PAGE_SIZE);

  if (filteredSideboards.length > 0) {
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`pazaak:sideboardselect:${safePage}:${encodedQuery}`)
          .setPlaceholder(
            pageCount <= 1
              ? (activeSideboard ? `Active sideboard: ${formatSideboardName(activeSideboard.name)}` : "Choose an active sideboard")
              : `Choose an active sideboard (page ${safePage + 1}/${pageCount})`,
          )
          .addOptions(
            visibleSideboards.map((sideboard) => ({
              label: formatSideboardName(sideboard.name),
              value: sideboard.name,
              description: sideboard.isActive ? "Current active sideboard" : "Set as active sideboard",
              default: sideboard.isActive,
            })),
          ),
      ),
    );

    if (pageCount > 1) {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`pazaak:sideboard:listpage:${safePage - 1}:${encodedQuery}`)
          .setLabel("Previous Boards")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage === 0),
        new ButtonBuilder()
          .setCustomId(`pazaak:sideboard:listpage:${safePage + 1}:${encodedQuery}`)
          .setLabel("Next Boards")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage >= pageCount - 1),
      ));
    }
  }

  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("pazaak:sideboard:editor:0")
        .setLabel("Card Editor")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`pazaak:sideboard:search:${encodedQuery}`)
        .setLabel("Find Board")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("pazaak:sideboard:edit")
        .setLabel(activeSideboard ? "Edit Sideboard" : "Build Sideboard")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("pazaak:sideboard:clearsearch")
        .setLabel("Clear Search")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!normalizeSideboardSearchQuery(searchQuery)),
    ));

  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("pazaak:sideboard:clear")
        .setLabel("Clear Sideboard")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!activeSideboard),
      buildActivityLobbyButton("Open Activity Lobby"),
    ));

  return rows;
};

const buildSideboardModal = (tokens: readonly string[], sideboardName: string) => {
  const firstHalf = tokens.slice(0, 5).join(" ");
  const secondHalf = tokens.slice(5, 10).join(" ");

  return new ModalBuilder()
    .setCustomId("pazaak:sideboard:modal")
    .setTitle(`Edit: ${sideboardName}`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(SIDEBOARD_MODAL_FIRST_FIELD_ID)
          .setLabel("Slots 1-5")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder("+1 -2 *3 $$ TT")
          .setValue(firstHalf || "+1 -2 *3 $$ TT"),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(SIDEBOARD_MODAL_SECOND_FIELD_ID)
          .setLabel("Slots 6-10")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder("F1 F2 VV +4 -5")
          .setValue(secondHalf || "F1 F2 VV +4 -5"),
      ),
    );
};

const normalizeSideboardEditorSelectedSlot = (tokens: readonly string[], page: number, selectedSlot?: number): number => {
  const maxPage = Math.floor((SIDE_DECK_SIZE - 1) / SIDEBOARD_EDITOR_PAGE_SIZE);
  const safePage = Math.min(Math.max(page, 0), maxPage);
  const start = safePage * SIDEBOARD_EDITOR_PAGE_SIZE;
  const end = Math.min(start + SIDEBOARD_EDITOR_PAGE_SIZE, SIDE_DECK_SIZE);

  if (selectedSlot !== undefined && selectedSlot >= start && selectedSlot < end && selectedSlot < tokens.length) {
    return selectedSlot;
  }

  return start;
};

const buildSideboardValidationSummary = (tokens: readonly string[]): string => {
  const categoryCounts = tokens.reduce((counts, token) => {
    if (/^[+-][1-6]$/u.test(token)) {
      counts.fixed += 1;
    } else if (/^[*][1-6]$/u.test(token)) {
      counts.flip += 1;
    } else {
      counts.special += 1;
    }

    return counts;
  }, { fixed: 0, flip: 0, special: 0 });

  const uniqueCount = new Set(tokens).size;
  const limitErrors = getCustomSideDeckLimitErrors(tokens);
  const status = limitErrors.length > 0 ? `Needs edits: ${limitErrors.join(" ")}` : `All ${tokens.length} slots valid`;
  return `${status} | Fixed: ${categoryCounts.fixed} | Flip: ${categoryCounts.flip} | Special: ${categoryCounts.special} | Unique tokens: ${uniqueCount}`;
};

const buildSideboardEditorEmbed = (tokens: readonly string[], page: number, sideboardName: string, selectedSlot?: number) => {
  const effectiveTokens = getEffectiveSideboardTokens(tokens);
  const maxPage = Math.floor((SIDE_DECK_SIZE - 1) / SIDEBOARD_EDITOR_PAGE_SIZE);
  const safePage = Math.min(Math.max(page, 0), maxPage);
  const start = safePage * SIDEBOARD_EDITOR_PAGE_SIZE;
  const end = Math.min(start + SIDEBOARD_EDITOR_PAGE_SIZE, SIDE_DECK_SIZE);
  const safeSelectedSlot = normalizeSideboardEditorSelectedSlot(effectiveTokens, safePage, selectedSlot);
  const selectedToken = effectiveTokens[safeSelectedSlot]!;

  return buildInfoEmbed({
    title: "Custom Sideboard Card Editor",
    description: `Editing **${formatSideboardName(sideboardName)}**. Changes save immediately. Page ${safePage + 1} of ${maxPage + 1}. Focused slot: **${safeSelectedSlot + 1}** (${selectedToken}).`,
    fields: [
      {
        name: `Slots ${start + 1}-${end}`,
        value: effectiveTokens.slice(start, end).map((token, index) => `Slot ${start + index + 1}: **${token}**`).join("\n"),
        inline: false,
      },
      {
        name: "Focused Slot",
        value: `Slot ${safeSelectedSlot + 1}: **${selectedToken}**\n${sideboardTokenDescriptions[selectedToken] ?? selectedToken}`,
        inline: false,
      },
      {
        name: "Full Sideboard",
        value: formatSideboardTokens(effectiveTokens),
        inline: false,
      },
      {
        name: "Validation",
        value: buildSideboardValidationSummary(effectiveTokens),
        inline: false,
      },
    ],
  });
};

const buildSideboardEditorComponents = (tokens: readonly string[], page: number, selectedSlot?: number) => {
  const effectiveTokens = getEffectiveSideboardTokens(tokens);
  const maxPage = Math.floor((SIDE_DECK_SIZE - 1) / SIDEBOARD_EDITOR_PAGE_SIZE);
  const safePage = Math.min(Math.max(page, 0), maxPage);
  const start = safePage * SIDEBOARD_EDITOR_PAGE_SIZE;
  const end = Math.min(start + SIDEBOARD_EDITOR_PAGE_SIZE, SIDE_DECK_SIZE);
  const visibleSlotIndexes = Array.from({ length: end - start }, (_, index) => start + index);
  const safeSelectedSlot = normalizeSideboardEditorSelectedSlot(effectiveTokens, safePage, selectedSlot);
  const rows: Array<ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>> = [];

  for (let slotIndex = start; slotIndex < end; slotIndex += 1) {
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`pazaak:sideboardslot:${safePage}:${slotIndex}:${safeSelectedSlot}`)
          .setPlaceholder(`Slot ${slotIndex + 1}: ${effectiveTokens[slotIndex]}`)
          .addOptions(
            supportedSideDeckTokens.map((token) => ({
              label: token,
              value: token,
              description: sideboardTokenDescriptions[token] ?? token,
              default: effectiveTokens[slotIndex] === token,
            })),
          ),
      ),
    );
  }

  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...visibleSlotIndexes.map((slotIndex) => new ButtonBuilder()
        .setCustomId(`pazaak:sideboard:editorfocus:${safePage}:${slotIndex}`)
        .setLabel(`Slot ${slotIndex + 1}`)
        .setStyle(slotIndex === safeSelectedSlot ? ButtonStyle.Primary : ButtonStyle.Secondary)),
      new ButtonBuilder()
        .setCustomId(`pazaak:sideboard:editormove:${safePage}:${safeSelectedSlot}:left`)
        .setLabel("Move Left")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safeSelectedSlot === 0),
      new ButtonBuilder()
        .setCustomId(`pazaak:sideboard:editormove:${safePage}:${safeSelectedSlot}:right`)
        .setLabel("Move Right")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safeSelectedSlot >= effectiveTokens.length - 1),
    ),
  );

  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`pazaak:sideboard:editor:${safePage - 1}:${safeSelectedSlot}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage === 0),
      new ButtonBuilder()
        .setCustomId(`pazaak:sideboard:back`)
        .setLabel("Back")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("pazaak:sideboard:edit")
        .setLabel("Bulk Edit")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`pazaak:sideboard:editor:${safePage + 1}:${safeSelectedSlot}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage >= maxPage),
    ),
  );

  return rows;
};

const buildChallengeEmbed = (challenge: PendingChallenge) => {
  const deckLines = [
    challenge.challengerCustomDeck !== undefined
      ? `${challenge.challengerName}: ${challenge.challengerCustomDeck.label ?? CUSTOM_SIDE_DECK_LABEL}`
      : challenge.challengerDeckId !== undefined
      ? `${challenge.challengerName}: ${formatDeckDisplayName(challenge.challengerDeckId, getCanonicalSideDeckDefinition(challenge.challengerDeckId)?.label)}`
      : null,
    challenge.challengedCustomDeck !== undefined
      ? `${challenge.challengedName}: ${challenge.challengedCustomDeck.label ?? CUSTOM_SIDE_DECK_LABEL}`
      : challenge.challengedDeckId !== undefined
      ? `${challenge.challengedName}: ${formatDeckDisplayName(challenge.challengedDeckId, getCanonicalSideDeckDefinition(challenge.challengedDeckId)?.label)}`
      : null,
  ].filter((line): line is string => Boolean(line));

  const deckNote = deckLines.length > 0 ? `\nDecks: ${deckLines.join(" | ")}` : "";

  return buildInfoEmbed({
    title: "Pazaak Challenge",
    description: `${challenge.challengerName} just challenged ${challenge.challengedName} for **${challenge.wager} credits**. Somebody is about to embarrass me by being competent.${deckNote}`,
  });
};

const buildChallengeComponents = (challenge: PendingChallenge) => {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`pazaak:challenge:accept:${challenge.id}`)
        .setLabel("Accept")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`pazaak:challenge:decline:${challenge.id}`)
        .setLabel("Decline")
        .setStyle(ButtonStyle.Secondary),
      buildActivityLobbyButton(),
    ),
  ];
};

const buildDeckSelectionEmbed = (
  savedDeckId?: number,
  savedCustomSideboards: readonly { name: string; isActive: boolean }[] = [],
  searchQuery?: string,
) => {
  const filteredSideboards = filterSavedSideboards(savedCustomSideboards, searchQuery);
  const normalizedQuery = normalizeSideboardSearchQuery(searchQuery);

  return buildInfoEmbed({
    title: "Choose Your Deck",
    description: buildDeckSelectionDescription(savedDeckId, savedCustomSideboards.map((sideboard) => sideboard.name)),
    fields: normalizedQuery
      ? [{
          name: "Custom Sideboard Search",
          value: filteredSideboards.length === 0
            ? `No saved custom sideboards match **${normalizedQuery}**.`
            : `Showing ${filteredSideboards.length} of ${savedCustomSideboards.length} saved custom sideboards for **${normalizedQuery}**.`,
          inline: false,
        }]
      : [],
  });
};

const buildDeckSelectionComponents = (
  challengeId: string,
  savedDeckId?: number,
  savedCustomSideboards: readonly { name: string; isActive: boolean }[] = [],
  customPage = 0,
  searchQuery?: string,
) => {
  const baseDeckOptions = [
    {
      label: "Auto",
      value: "auto",
      description: "Let the engine assign a supported canonical TSL deck.",
    },
    ...(savedDeckId !== undefined ? [{
      label: `Saved Preset: ${formatDeckDisplayName(savedDeckId)}`,
      value: `saved:${savedDeckId}`,
      description: "Use your saved default runtime preset.",
    }] : []),
    ...runtimeTslDecks
      .filter((deck) => deck.id !== savedDeckId)
      .map((deck) => ({
        label: formatDeckDisplayName(deck.id, deck.label),
        value: String(deck.id),
        description: "Runtime TSL match deck",
      })),
  ];

  const rows: Array<ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>> = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`pazaak:acceptdeck:${challengeId}`)
        .setPlaceholder("Choose your sideboard before accepting")
        .addOptions(baseDeckOptions.slice(0, MAX_DECK_SELECTION_OPTIONS)),
    ),
  ];

  if (savedCustomSideboards.length > 0) {
    const filteredSideboards = filterSavedSideboards(savedCustomSideboards, searchQuery);
    const encodedQuery = encodeSideboardSearchQuery(searchQuery);
    const pageCount = Math.ceil(filteredSideboards.length / CUSTOM_SIDEBOARD_SELECTION_PAGE_SIZE);
    const safePage = normalizeSelectionPage(customPage, pageCount);
    const start = safePage * CUSTOM_SIDEBOARD_SELECTION_PAGE_SIZE;
    const visibleSideboards = filteredSideboards.slice(start, start + CUSTOM_SIDEBOARD_SELECTION_PAGE_SIZE);

    if (visibleSideboards.length > 0) {
      rows.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`pazaak:acceptdeckcustom:${challengeId}:${safePage}:${encodedQuery}`)
            .setPlaceholder(
              pageCount === 1
                ? "Choose a saved custom sideboard"
                : `Choose a saved custom sideboard (page ${safePage + 1}/${pageCount})`,
            )
            .addOptions(
              visibleSideboards.map((sideboard) => ({
                label: formatSideboardName(sideboard.name),
                value: `custom:${sideboard.name}`,
                description: sideboard.isActive ? "Saved custom sideboard (currently active)." : "Saved custom sideboard.",
                default: false,
              })),
            ),
        ),
      );
    }

    if (pageCount > 1) {
      rows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`pazaak:acceptcustompage:${challengeId}:${safePage - 1}:${encodedQuery}`)
            .setLabel("Previous Custom Boards")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage === 0),
          new ButtonBuilder()
            .setCustomId(`pazaak:acceptcustompage:${challengeId}:${safePage + 1}:${encodedQuery}`)
            .setLabel("Next Custom Boards")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage >= pageCount - 1),
        ),
      );
    }

    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`pazaak:acceptcustomsearch:${challengeId}:${encodedQuery}`)
          .setLabel("Find Custom Board")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`pazaak:acceptcustomclear:${challengeId}`)
          .setLabel("Clear Search")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!normalizeSideboardSearchQuery(searchQuery)),
      ),
    );
  }

  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      buildActivityLobbyButton("Open Activity Lobby"),
    ),
  );

  return rows;
};

const buildSideboardSearchModal = (mode: "manage" | `accept:${string}`, searchQuery?: string) => {
  return new ModalBuilder()
    .setCustomId(`pazaak:sideboardsearch:${mode}`)
    .setTitle("Find Sideboard")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(SIDEBOARD_SEARCH_FIELD_ID)
          .setLabel("Name contains")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(SIDEBOARD_SEARCH_QUERY_MAX_LENGTH)
          .setPlaceholder("default, swoop, ranked, ...")
          .setValue(normalizeSideboardSearchQuery(searchQuery) ?? ""),
      ),
    );
};

const startAcceptedMatch = async (
  challenge: PendingChallenge,
  userId: string,
  challengedDeckChoice?: SideDeckChoice,
): Promise<PazaakMatch> => {
  const match = coordinator.acceptChallenge(challenge.id, userId, challengedDeckChoice);

  if (!challenge.publicMessageId) {
    throw new Error("Pending challenge is missing its public message id.");
  }

  const channel = await client.channels.fetch(challenge.channelId);

  if (!channel?.isTextBased()) {
    throw new Error("Challenge channel is no longer available.");
  }

  const message = await channel.messages.fetch(challenge.publicMessageId);
  coordinator.setPublicMessageId(match.id, challenge.publicMessageId);
  await message.edit({
    embeds: [buildMatchEmbed(match)],
    components: buildMatchComponents(match),
  });

  return match;
};

const buildMatchEmbed = (match: PazaakMatch) => {
  const activePlayer = getCurrentPlayer(match);

  return buildInfoEmbed({
    title: "Pazaak Bot Table",
    description: `${match.statusLine}\nSet ${match.setNumber}. Wager: **${match.wager} credits**.`,
    fields: match.players.map((player) => ({
      name: `${player.displayName}${match.phase !== "completed" && activePlayer.userId === player.userId ? " (active)" : ""}`,
      value: `${renderBoardLine(player)}\nSets won: ${player.roundWins}\nDeck: ${formatDeckDisplayName(player.sideDeckId, player.sideDeckLabel)}\nSide cards left: ${player.hand.length - player.usedCardIds.size}\nStatus: ${player.stood ? "Standing" : "Still drawing"}`,
      inline: true,
    })),
  });
};

const buildMatchComponents = (match: PazaakMatch) => {
  if (match.phase === "completed") {
    if (!match.winnerId || !match.loserId) {
      return [];
    }

    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`pazaak:rematch:${match.id}`)
          .setLabel("Rematch")
          .setStyle(ButtonStyle.Primary),
      ),
    ];
  }

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`pazaak:controls:${match.id}`)
        .setLabel("Open Controls")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setURL(`${config.activityUrl}?matchId=${match.id}`)
        .setLabel("🎮 Play in Browser")
        .setStyle(ButtonStyle.Link),
      new ButtonBuilder()
        .setCustomId(`pazaak:forfeit:${match.id}`)
        .setLabel("Forfeit")
        .setStyle(ButtonStyle.Danger),
    ),
  ];
};

const buildSpectatorComponents = (match: PazaakMatch, ownerId?: string) => {
  const buttons = [
    new ButtonBuilder()
      .setURL(`${config.activityUrl}?matchId=${match.id}`)
      .setLabel("🎮 Watch in Browser")
      .setStyle(ButtonStyle.Link),
  ];

  if (ownerId) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`pazaak:closespectate:${match.id}:${ownerId}`)
        .setLabel("Close Mirror")
        .setStyle(ButtonStyle.Secondary),
    );
  }

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons),
  ];
};

const buildSpectatorEmbed = (match: PazaakMatch) => {
  return buildInfoEmbed({
    title: "Pazaak Spectator Board",
    description: `Read-only mirror for ${match.players[0].displayName} vs ${match.players[1].displayName}.\n${match.statusLine}\nSet ${match.setNumber}. Wager: **${match.wager} credits**.`,
    fields: match.players.map((player) => ({
      name: `${player.displayName}${match.phase !== "completed" && getCurrentPlayer(match).userId === player.userId ? " (active)" : ""}`,
      value: `${renderBoardLine(player)}\nSets won: ${player.roundWins}\nDeck: ${formatDeckDisplayName(player.sideDeckId, player.sideDeckLabel)}\nSide cards left: ${player.hand.length - player.usedCardIds.size}\nStatus: ${player.stood ? "Standing" : "Still drawing"}`,
      inline: true,
    })),
  });
};

const resolveSpectateMatch = (channelId: string, playerId?: string): PazaakMatch => {
  if (playerId) {
    const match = coordinator.getActiveMatchForUser(playerId);

    if (!match) {
      throw new Error("That player is not in an active pazaak match.");
    }

    if (match.channelId !== channelId) {
      throw new Error("That player's active match is in a different channel.");
    }

    return match;
  }

  const channelMatches = coordinator.getActiveMatches().filter((match) => match.channelId === channelId);

  if (channelMatches.length === 0) {
    throw new Error("There is no active pazaak match in this channel.");
  }

  if (channelMatches.length > 1) {
    throw new Error("More than one active match is running here. Use the player option to choose which one to mirror.");
  }

  return channelMatches[0]!;
};

const resolveGuildDisplayName = async (
  interaction: ButtonInteraction | ChatInputCommandInteraction,
  userId: string,
  fallbackName: string,
): Promise<string> => {
  const guild = interaction.guild;

  if (!interaction.inGuild() || !guild) {
    return fallbackName;
  }

  try {
    const member = await guild.members.fetch(userId);
    return member.displayName;
  } catch {
    return fallbackName;
  }
};

const upsertSpectatorMirror = async (
  interaction: ChatInputCommandInteraction,
  match: PazaakMatch,
): Promise<void> => {
  const existingMirror = match.spectatorMirrors.find((mirror) => mirror.ownerId === interaction.user.id);

  if (existingMirror) {
    const channel = await client.channels.fetch(match.channelId);

    if (channel?.isTextBased() && "messages" in channel) {
      try {
        const message = await channel.messages.fetch(existingMirror.messageId);
        await message.edit({
          embeds: [buildSpectatorEmbed(match)],
          components: buildSpectatorComponents(match, interaction.user.id),
        });
        await interaction.reply({
          embeds: [buildSuccessEmbed({
            title: "Mirror Refreshed",
            description: "Your existing spectator mirror was updated instead of creating a duplicate post.",
          })],
          ephemeral: true,
        });
        return;
      } catch {
        coordinator.unregisterSpectatorMessage(match.id, existingMirror.messageId);
      }
    }
  }

  await interaction.reply({
    embeds: [buildSpectatorEmbed(match)],
    components: buildSpectatorComponents(match, interaction.user.id),
    allowedMentions: { parse: [] },
  });
  const reply = await interaction.fetchReply();
  coordinator.registerSpectatorMessage(match.id, reply.id, interaction.user.id);
};

const chunkButtons = (buttons: ButtonBuilder[]) => {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let index = 0; index < buttons.length; index += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons.slice(index, index + 5)));
  }

  return rows;
};

const normalizeAdvisorDifficulty = (value?: string): AdvisorDifficulty => {
  switch (value) {
    case "easy":
    case "hard":
    case "professional":
      return value;
    default:
      return "professional";
  }
};

const formatAdvisorDifficultyLabel = (difficulty: AdvisorDifficulty): string => {
  switch (difficulty) {
    case "easy":
      return "Easy";
    case "hard":
      return "Hard";
    case "professional":
      return "Professional";
  }
};

const getNextAdvisorDifficulty = (difficulty: AdvisorDifficulty): AdvisorDifficulty => {
  switch (difficulty) {
    case "easy":
      return "hard";
    case "hard":
      return "professional";
    case "professional":
      return "easy";
  }
};

const buildAdvisorCycleButton = (matchId: string, difficulty: AdvisorDifficulty): ButtonBuilder => {
  return new ButtonBuilder()
    .setCustomId(`pazaak:advisor:${matchId}:${getNextAdvisorDifficulty(difficulty)}`)
    .setLabel(`Advisor: ${formatAdvisorDifficultyLabel(difficulty)}`)
    .setStyle(ButtonStyle.Secondary);
};

const formatAdvisorAction = (snapshot: AdvisorSnapshot): string => {
  const recommendation = snapshot.recommendation;

  if (recommendation.action === "play_side") {
    return `Play ${recommendation.displayLabel}\n${recommendation.rationale}`;
  }

  if (recommendation.action === "draw") {
    return `Draw main deck\n${recommendation.rationale}`;
  }

  if (recommendation.action === "stand") {
    return `Stand\n${recommendation.rationale}`;
  }

  return `End turn\n${recommendation.rationale}`;
};

const formatAdvisorCategoryLabel = (category: AdvisorSnapshot["category"]): string => {
  switch (category) {
    case "exact":
      return "Exact Finish";
    case "recovery":
      return "Recovery";
    case "pressure":
      return "Pressure";
    case "setup":
      return "Setup";
    case "neutral":
      return "Neutral";
  }
};

const formatAdvisorAlternative = (alternative: AdvisorAlternative): string => {
  return `${alternative.displayLabel} (${formatAdvisorCategoryLabel(alternative.category)})`;
};

const buildPrivateControlsPayload = async (match: PazaakMatch, userId: string, advisorDifficulty: AdvisorDifficulty = "professional") => {
  const player = getPlayerForUser(match, userId);

  if (!player) {
    return {
      embeds: [
        buildErrorEmbed({
          title: "Not Your Match",
          description: "You can spectate from the channel, but only the two players get a hand at the table.",
        }),
      ],
      components: [],
    };
  }

  const opponent = getOpponentForUser(match, userId)!;
  const currentPlayer = getCurrentPlayer(match);
  const handLine = renderHandLine(player) || "No side cards drawn.";
  const wallet = await walletRepository.getWallet(player.userId, player.displayName);
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  const advisorSnapshot = getAdvisorSnapshotForPlayer(match, userId, advisorDifficulty);

  let description = `Balance: **${wallet.balance} credits**\nYour hand: ${handLine}`;

  if (player.sideDeckLabel) {
    description = `${description}\nDeck: **${formatDeckDisplayName(player.sideDeckId, player.sideDeckLabel)}**`;
  }

  if (match.phase === "completed") {
    description = `${description}\n\nResult: ${match.statusLine}`;
  } else if (currentPlayer.userId !== userId) {
    description = `${description}\n\n${opponent.displayName} is holding the turn right now. Try not to look shocked.`;
  } else if (match.phase === "turn") {
    description = `${description}\n\nIt is your move. Draw from the main deck.`;
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`pazaak:draw:${match.id}:${advisorDifficulty}`).setLabel("Draw").setStyle(ButtonStyle.Primary),
        buildAdvisorCycleButton(match.id, advisorDifficulty),
      ),
    );
  } else if (match.phase === "after-card") {
    description = `${description}\n\n${match.statusLine} Stand on ${player.total} or end the turn.`;

    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`pazaak:endturn:${match.id}:${advisorDifficulty}`)
          .setLabel("End Turn")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`pazaak:stand:${match.id}:${advisorDifficulty}`)
          .setLabel("Stand")
          .setStyle(ButtonStyle.Secondary),
        buildAdvisorCycleButton(match.id, advisorDifficulty),
      ),
    );
  } else {
    description = `${description}\n\nYou drew ${match.pendingDraw}. Play a side card, stand on ${player.total}, or end the turn.`;

    const sideCardButtons = getSideCardOptionsForPlayer(player).map((option) => {
      return new ButtonBuilder()
        .setCustomId(`pazaak:play:${match.id}:${option.cardId}:${option.appliedValue}:${advisorDifficulty}`)
        .setLabel(option.displayLabel)
        .setStyle(ButtonStyle.Success);
    });

    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`pazaak:endturn:${match.id}:${advisorDifficulty}`)
          .setLabel("End Turn")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`pazaak:stand:${match.id}:${advisorDifficulty}`)
          .setLabel("Stand")
          .setStyle(ButtonStyle.Secondary),
        buildAdvisorCycleButton(match.id, advisorDifficulty),
      ),
    );
    components.push(...chunkButtons(sideCardButtons));
  }

  return {
    embeds: [
      buildInfoEmbed({
        title: "Private Pazaak Controls",
        description,
        fields: [
          {
            name: "Your Table State",
            value: `Cards: ${renderBoardLine(player)}\nSets won: ${player.roundWins}\nDeck: ${formatDeckDisplayName(player.sideDeckId, player.sideDeckLabel)}`,
            inline: true,
          },
          {
            name: `${opponent.displayName}`,
            value: `Cards: ${renderBoardLine(opponent)}\nSets won: ${opponent.roundWins}\nDeck: ${formatDeckDisplayName(opponent.sideDeckId, opponent.sideDeckLabel)}`,
            inline: true,
          },
          ...(advisorSnapshot
            ? [
                {
                  name: `PazaakWorld Advisor (${formatAdvisorDifficultyLabel(advisorDifficulty)})`,
                  value: `${formatAdvisorAction(advisorSnapshot)}\nConfidence: ${formatAdvisorDifficultyLabel(advisorDifficulty)} / ${advisorSnapshot.confidence.toUpperCase()}\nCategory: ${formatAdvisorCategoryLabel(advisorSnapshot.category)}\nBust risk on next draw: ${Math.round(advisorSnapshot.bustProbability * 100)}%${advisorSnapshot.alternatives.length > 1 ? `\nFallbacks: ${advisorSnapshot.alternatives.slice(1).map(formatAdvisorAlternative).join(", ")}` : ""}`,
                  inline: false,
                },
              ]
            : []),
        ],
      }),
    ],
    components,
  };
};

const client = createBotClient();

const refreshBoardMessage = async (match: PazaakMatch): Promise<void> => {
  const channel = await client.channels.fetch(match.channelId);

  if (!channel?.isTextBased() || !("messages" in channel)) {
    return;
  }

  if (match.publicMessageId) {
    const payload: MessageEditOptions = {
      embeds: [buildMatchEmbed(match)],
      components: buildMatchComponents(match),
    };

    try {
      const message = await channel.messages.fetch(match.publicMessageId);
      await message.edit(payload);
    } catch {
      // Keep spectator mirrors alive even if the original match post disappears.
    }
  }

  if (match.spectatorMirrors.length === 0) {
    return;
  }

  for (const spectatorMirror of [...match.spectatorMirrors]) {
    try {
      const spectatorMessage = await channel.messages.fetch(spectatorMirror.messageId);
      await spectatorMessage.edit({
        embeds: [buildSpectatorEmbed(match)],
        components: buildSpectatorComponents(match, spectatorMirror.ownerId || undefined),
      });
    } catch {
      coordinator.unregisterSpectatorMessage(match.id, spectatorMirror.messageId);
    }
  }
};

const settleCompletedMatch = async (match: PazaakMatch): Promise<void> => {
  if (match.phase !== "completed" || match.settled || !match.winnerId || !match.winnerName || !match.loserId || !match.loserName) {
    return;
  }

  await walletRepository.recordMatch({
    winnerId: match.winnerId,
    winnerName: match.winnerName,
    loserId: match.loserId,
    loserName: match.loserName,
    wager: match.wager,
  });
  await matchHistoryRepository.append({
    matchId: match.id,
    channelId: match.channelId,
    winnerId: match.winnerId,
    winnerName: match.winnerName,
    loserId: match.loserId,
    loserName: match.loserName,
    wager: match.wager,
    completedAt: new Date(match.updatedAt).toISOString(),
    summary: match.statusLine,
  });
  coordinator.markSettled(match.id);
};

const handleAdminCommand = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const subcommand = interaction.options.getSubcommand(true);
  switch (subcommand) {
    case "challenge": {
      const challenger = interaction.options.getUser("challenger", true);
      const opponent = interaction.options.getUser("opponent", true);
      const wager = interaction.options.getInteger("wager", true);
      const challengerDeckId = interaction.options.getInteger("challenger_deck") ?? undefined;
      const challengedDeckId = interaction.options.getInteger("opponent_deck") ?? undefined;

      if (challenger.bot || opponent.bot) {
        await interaction.reply({
          embeds: [buildWarningEmbed({ title: "Challenge Rejected", description: "Bot accounts are not valid seats at this pazaak table." })],
          ephemeral: true,
        });
        return;
      }

      if (challenger.id === opponent.id) {
        await interaction.reply({
          embeds: [buildWarningEmbed({ title: "Challenge Rejected", description: "An admin-seeded match still needs two distinct players." })],
          ephemeral: true,
        });
        return;
      }

      for (const [label, deckId] of [["challenger", challengerDeckId], ["opponent", challengedDeckId]] as const) {
        if (deckId !== undefined && !isCanonicalSideDeckSupported(deckId)) {
          await interaction.reply({
            embeds: [buildErrorEmbed({ title: "Unsupported Deck", description: `${label} deck ${deckId} is not supported by the current canonical engine.` })],
            ephemeral: true,
          });
          return;
        }
      }

      const challengerWallet = await walletRepository.getWallet(challenger.id, challenger.displayName);
      const challengedWallet = await walletRepository.getWallet(opponent.id, opponent.displayName);

      if (challengerWallet.balance < wager || challengedWallet.balance < wager) {
        await interaction.reply({
          embeds: [buildWarningEmbed({ title: "Insufficient Credits", description: "One of the selected players cannot cover that wager." })],
          ephemeral: true,
        });
        return;
      }

      const challenge = coordinator.createChallenge({
        channelId: interaction.channelId,
        challengerId: challenger.id,
        challengerName: challenger.displayName,
        ...(challengerDeckId !== undefined ? { challengerDeckId } : {}),
        challengedId: opponent.id,
        challengedName: opponent.displayName,
        ...(challengedDeckId !== undefined ? { challengedDeckId } : {}),
        wager,
      });

      await interaction.reply({
        embeds: [buildChallengeEmbed(challenge)],
        components: buildChallengeComponents(challenge),
        allowedMentions: { parse: [] },
      });
      const reply = await interaction.fetchReply();
      coordinator.setChallengePublicMessageId(challenge.id, reply.id);
      return;
    }

    case "give":
    case "take": {
      const player = interaction.options.getUser("player", true);
      const amount = interaction.options.getInteger("amount", true);
      const delta = subcommand === "give" ? amount : -amount;

      const updated = await walletRepository.adjustBalance(player.id, player.displayName, delta);

      const verb = subcommand === "give" ? "added" : "removed";
      const prep = subcommand === "give" ? "to" : "from";

      await interaction.reply({
        embeds: [
          buildSuccessEmbed({
            title: "Balance Adjusted",
            description: `${amount} credits ${verb} ${prep} ${player.displayName}'s wallet. New balance: **${updated.balance} credits**.`,
          }),
        ],
        ephemeral: true,
      });
      return;
    }
  }
};

const handleSlashCommand = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  if (!interaction.inGuild()) {
    await interaction.reply({
      embeds: [
        buildErrorEmbed({
          title: "Guild Required",
          description: "Pazaak Bot only runs the table inside a guild channel.",
        }),
      ],
      ephemeral: true,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand(true);

  switch (subcommand) {
    case "rules": {
      await interaction.reply({ embeds: [buildRulesEmbed()] });
      return;
    }

    case "decks": {
      await interaction.reply({ embeds: [buildDeckCatalogEmbed()] });
      return;
    }

    case "sideboard": {
      const cards = interaction.options.getString("cards") ?? undefined;
      const requestedName = normalizeRequestedSideboardName(interaction.options.getString("name") ?? undefined);
      const clear = interaction.options.getBoolean("clear") ?? false;

      if (clear && cards) {
        await interaction.reply({
          embeds: [buildErrorEmbed({
            title: "Choose One Action",
            description: "Use either `cards` to save a custom sideboard or `clear` to remove the current one, not both at once.",
          })],
          ephemeral: true,
        });
        return;
      }

      if (clear) {
        const removed = await sideboardRepository.clearSideboard(interaction.user.id, requestedName);
        const currentSideboards = await sideboardRepository.listSideboards(interaction.user.id, interaction.user.displayName);
        await interaction.reply({
          embeds: [buildSuccessEmbed({
            title: "Sideboard Cleared",
            description: removed
              ? requestedName
                ? `Removed the saved sideboard **${formatSideboardName(requestedName)}**.`
                : `Your active ${CUSTOM_SIDE_DECK_LABEL.toLowerCase()} was removed.`
              : requestedName
                ? `You do not have a saved sideboard named **${formatSideboardName(requestedName)}**.`
                : `You did not have an active ${CUSTOM_SIDE_DECK_LABEL.toLowerCase()} to clear.`,
          })],
          components: buildSideboardComponents(currentSideboards.sideboards),
          ephemeral: true,
        });
        return;
      }

      if (cards) {
        const tokens = parseCustomSideboardTokens(cards);
        const savedSideboard = await sideboardRepository.saveSideboard(interaction.user.id, interaction.user.displayName, tokens, requestedName);
        const currentSideboards = await sideboardRepository.listSideboards(interaction.user.id, interaction.user.displayName);
        await interaction.reply({
          embeds: [buildSuccessEmbed({
            title: "Sideboard Saved",
            description: `Saved **${formatSideboardName(savedSideboard.name)}** as your active custom 10-card sideboard: **${formatSideboardTokens(tokens)}**. Use it from \`/pazaak challenge use_custom:true\` or the Accept deck picker.`,
          })],
          components: buildSideboardComponents(currentSideboards.sideboards),
          ephemeral: true,
        });
        return;
      }

      if (requestedName) {
        await sideboardRepository.setActiveSideboard(interaction.user.id, interaction.user.displayName, requestedName);
        await interaction.reply({
          embeds: [buildSuccessEmbed({
            title: "Active Sideboard Updated",
            description: `**${formatSideboardName(requestedName)}** is now your active custom sideboard for challenges and deck pickers.`,
          })],
          components: buildSideboardComponents((await sideboardRepository.listSideboards(interaction.user.id, interaction.user.displayName)).sideboards),
          ephemeral: true,
        });
        return;
      }

      const currentSideboards = await sideboardRepository.listSideboards(interaction.user.id, interaction.user.displayName);

      await interaction.reply({
        embeds: [await buildSideboardEmbed(interaction.user.id, interaction.user.displayName)],
        components: buildSideboardComponents(currentSideboards.sideboards),
        ephemeral: true,
      });
      return;
    }

    case "spectate": {
      const player = interaction.options.getUser("player") ?? undefined;
      const match = resolveSpectateMatch(interaction.channelId, player?.id);

      await upsertSpectatorMirror(interaction, match);
      return;
    }

    case "preset": {
      const difficulty = interaction.options.getInteger("difficulty") ?? undefined;
      const clear = interaction.options.getBoolean("clear") ?? false;

      if (clear) {
        const updated = await walletRepository.setPreferredRuntimeDeckId(interaction.user.id, interaction.user.displayName, null);
        await interaction.reply({
          embeds: [buildSuccessEmbed({
            title: "Preset Cleared",
            description: updated.preferredRuntimeDeckId === null
              ? "Your saved runtime TSL preset was cleared. Normal challenges will fall back to Auto unless you pass `deck`."
              : "Your saved runtime TSL preset was updated.",
          })],
          ephemeral: true,
        });
        return;
      }

      if (difficulty !== undefined) {
        if (!isRuntimeTslDeckSupported(difficulty)) {
          await interaction.reply({
            embeds: [buildErrorEmbed({
              title: "Unsupported Preset",
              description: `Deck ${difficulty} is not available in the runtime TSL preset pool (10-14).`,
            })],
            ephemeral: true,
          });
          return;
        }

        await walletRepository.setPreferredRuntimeDeckId(interaction.user.id, interaction.user.displayName, difficulty);
        await interaction.reply({
          embeds: [buildSuccessEmbed({
            title: "Preset Saved",
            description: `Saved **${formatDeckDisplayName(difficulty)}** as your default runtime TSL preset for normal challenges.`,
          })],
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        embeds: [await buildPresetEmbed(interaction.user.id, interaction.user.displayName)],
        ephemeral: true,
      });
      return;
    }

    case "wallet": {
      await interaction.reply({
        embeds: [await buildWalletEmbed(interaction.user.id, interaction.user.displayName)],
        ephemeral: true,
      });
      return;
    }

    case "daily": {
      await interaction.reply({
        embeds: [await buildDailyEmbed(interaction.user.id, interaction.user.displayName)],
        ephemeral: true,
      });
      return;
    }

    case "leaderboard": {
      await interaction.reply({ embeds: [await buildLeaderboardEmbed()] });
      return;
    }

    case "rivalry": {
      await interaction.reply({
        embeds: [await buildRivalryEmbed(interaction.user.id, interaction.user.displayName)],
        ephemeral: true,
      });
      return;
    }

    case "queue": {
      const actor = await resolveCommandActor(interaction);
      const action = interaction.options.getString("action", true);

      if (action === "join") {
        const wallet = await walletRepository.getWallet(actor.userId, actor.displayName);
        await matchmakingQueueRepository.enqueue({
          userId: actor.userId,
          displayName: actor.displayName,
          mmr: wallet.mmr,
          preferredMaxPlayers: 2,
        });
        await interaction.reply({
          embeds: [await buildQueueEmbed(actor.userId)],
          components: buildActivityLobbyComponents("Open Queue in Activity"),
          ephemeral: true,
        });
        return;
      }

      if (action === "leave") {
        const removed = await matchmakingQueueRepository.remove(actor.userId);
        await interaction.reply({
          embeds: [removed
            ? buildSuccessEmbed({ title: "Queue Left", description: "You left the cross-platform Pazaak queue." })
            : buildInfoEmbed({ title: "Queue Status", description: "You were not in the queue." })],
          components: buildActivityLobbyComponents(),
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        embeds: [await buildQueueEmbed(actor.userId)],
        components: buildActivityLobbyComponents(),
        ephemeral: true,
      });
      return;
    }

    case "lobby": {
      const actor = await resolveCommandActor(interaction);
      const action = interaction.options.getString("action", true);
      const requestedLobbyId = interaction.options.getString("lobby_id") ?? undefined;
      const openLobbies = await lobbyRepository.listOpen();
      const ownLobby = openLobbies.find((lobby) => lobby.players.some((player) => player.userId === actor.userId));
      const lobbyId = requestedLobbyId ?? ownLobby?.id;

      if (action === "list") {
        await interaction.reply({
          embeds: [await buildLobbyListEmbed()],
          components: buildActivityLobbyComponents(),
          ephemeral: true,
        });
        return;
      }

      if (action === "create") {
        const name = interaction.options.getString("name") ?? `${actor.displayName}'s Table`;
        const lobby = await lobbyRepository.create({
          name,
          hostUserId: actor.userId,
          hostName: actor.displayName,
          maxPlayers: 2,
        });
        await interaction.reply({
          embeds: [buildSuccessEmbed({ title: "Lobby Created", description: `Created **${lobby.name}**. Lobby ID: ${lobby.id}` })],
          components: buildActivityLobbyComponents(),
          ephemeral: true,
        });
        return;
      }

      if (!lobbyId) {
        await interaction.reply({
          embeds: [buildErrorEmbed({ title: "Lobby ID Required", description: "Pass `lobby_id`, or join/create a lobby first." })],
          ephemeral: true,
        });
        return;
      }

      if (action === "join") {
        const lobby = await lobbyRepository.join(lobbyId, { userId: actor.userId, displayName: actor.displayName });
        await interaction.reply({
          embeds: [buildSuccessEmbed({ title: "Lobby Joined", description: `Joined **${lobby.name}**.` })],
          components: buildActivityLobbyComponents(),
          ephemeral: true,
        });
        return;
      }

      if (action === "ready") {
        const lobby = await lobbyRepository.setReady(lobbyId, actor.userId, true);
        await interaction.reply({
          embeds: [buildSuccessEmbed({ title: "Ready", description: `Marked ready in **${lobby.name}**.` })],
          components: buildActivityLobbyComponents(),
          ephemeral: true,
        });
        return;
      }

      if (action === "leave") {
        const lobby = await lobbyRepository.leave(lobbyId, actor.userId);
        await interaction.reply({
          embeds: [buildSuccessEmbed({ title: "Lobby Left", description: lobby ? `Left **${lobby.name}**.` : "That lobby is already closed." })],
          components: buildActivityLobbyComponents(),
          ephemeral: true,
        });
        return;
      }

      if (action === "add_ai") {
        const difficulty = normalizeAiDifficulty(interaction.options.getString("difficulty"));
        const lobby = await lobbyRepository.addAi(lobbyId, actor.userId, difficulty);
        await interaction.reply({
          embeds: [buildSuccessEmbed({ title: "AI Seat Added", description: `Added ${difficulty} AI to **${lobby.name}**.` })],
          components: buildActivityLobbyComponents(),
          ephemeral: true,
        });
        return;
      }

      if (action === "start") {
        const lobby = await lobbyRepository.get(lobbyId);

        if (!lobby) {
          await interaction.reply({ embeds: [buildErrorEmbed({ title: "Lobby Missing", description: "That lobby is no longer available." })], ephemeral: true });
          return;
        }

        if (lobby.hostUserId !== actor.userId || lobby.players.length !== 2 || !lobby.players.every((player) => player.ready)) {
          await interaction.reply({
            embeds: [buildWarningEmbed({ title: "Lobby Not Ready", description: "Only the host can start a two-seat lobby once both seats are ready." })],
            ephemeral: true,
          });
          return;
        }

        const [challenger, opponent] = lobby.players;
        const match = coordinator.createDirectMatch({
          channelId: interaction.channelId,
          challengerId: challenger!.userId,
          challengerName: challenger!.displayName,
          opponentId: opponent!.userId,
          opponentName: opponent!.displayName,
          opponentAiDifficulty: opponent!.aiDifficulty,
        });
        await lobbyRepository.markInGame(lobby.id, match.id);
        await interaction.reply({ embeds: [buildMatchEmbed(match)], components: buildMatchComponents(match) });
        const reply = await interaction.fetchReply();
        coordinator.setPublicMessageId(match.id, reply.id);
        return;
      }

      await interaction.reply({ embeds: [buildErrorEmbed({ title: "Unknown Lobby Action", description: `I do not know how to process ${action}.` })], ephemeral: true });
      return;
    }

    case "ai": {
      const difficulty = normalizeAiDifficulty(interaction.options.getString("difficulty"));
      const match = coordinator.createDirectMatch({
        channelId: interaction.channelId,
        challengerId: interaction.user.id,
        challengerName: interaction.user.displayName,
        opponentId: `ai:${interaction.user.id}:${Date.now()}`,
        opponentName: `${difficulty[0]!.toUpperCase()}${difficulty.slice(1)} AI`,
        opponentAiDifficulty: difficulty,
      });
      await interaction.reply({ embeds: [buildMatchEmbed(match)], components: buildMatchComponents(match) });
      const reply = await interaction.fetchReply();
      coordinator.setPublicMessageId(match.id, reply.id);
      return;
    }

    case "challenge": {
      const opponent = interaction.options.getUser("opponent", true);
      const wager = interaction.options.getInteger("wager", true);
      const explicitDeckId = interaction.options.getInteger("deck") ?? undefined;
      const useCustom = interaction.options.getBoolean("use_custom") ?? false;
      const requestedCustomName = normalizeRequestedSideboardName(interaction.options.getString("custom_name") ?? undefined);

      if (opponent.bot) {
        await interaction.reply({
          embeds: [
            buildWarningEmbed({
              title: "Challenge Rejected",
              description: "I already lose enough to organics. I am not adding bot mirrors to the humiliation stack.",
            }),
          ],
          ephemeral: true,
        });
        return;
      }

      if (opponent.id === interaction.user.id) {
        await interaction.reply({
          embeds: [
            buildWarningEmbed({
              title: "Challenge Rejected",
              description: "Even I know better than to let you hustle yourself.",
            }),
          ],
          ephemeral: true,
        });
        return;
      }

      const challengerWallet = await walletRepository.getWallet(interaction.user.id, interaction.user.displayName);
      const challengedWallet = await walletRepository.getWallet(opponent.id, opponent.displayName);
      const challengerSideboard = useCustom || requestedCustomName
        ? await sideboardRepository.getSideboard(interaction.user.id, requestedCustomName)
        : undefined;
      const challengerDeckId = explicitDeckId ?? challengerWallet.preferredRuntimeDeckId ?? undefined;

      if (explicitDeckId !== undefined && (useCustom || requestedCustomName !== undefined)) {
        await interaction.reply({
          embeds: [buildErrorEmbed({
            title: "Choose One Deck Source",
            description: "Use either `deck` for a runtime TSL preset or a custom sideboard selection, not both.",
          })],
          ephemeral: true,
        });
        return;
      }

      if ((useCustom || requestedCustomName !== undefined) && !challengerSideboard) {
        await interaction.reply({
          embeds: [buildErrorEmbed({
            title: "No Saved Sideboard",
            description: requestedCustomName
              ? `Save a custom sideboard named **${formatSideboardName(requestedCustomName)}** before challenging with it.`
              : "Save a custom sideboard first with `/pazaak sideboard cards:...` before challenging with `use_custom:true`.",
          })],
          ephemeral: true,
        });
        return;
      }

      if (!useCustom && challengerDeckId !== undefined && !isRuntimeTslDeckSupported(challengerDeckId)) {
        await interaction.reply({
          embeds: [buildErrorEmbed({ title: "Unsupported Deck", description: `Deck ${challengerDeckId} is not available in the public runtime TSL deck pool (10-14).` })],
          ephemeral: true,
        });
        return;
      }

      if (challengerWallet.balance < wager) {
        await interaction.reply({
          embeds: [
            buildWarningEmbed({
              title: "Insufficient Credits",
              description: `You tried to wager ${wager}, but you only have ${challengerWallet.balance}. This is somehow worse than one of my duels.`,
            }),
          ],
          ephemeral: true,
        });
        return;
      }

      if (challengedWallet.balance < wager) {
        await interaction.reply({
          embeds: [
            buildWarningEmbed({
              title: "Opponent Cannot Cover Wager",
              description: `${opponent.displayName} only has ${challengedWallet.balance} credits available. Lower the stake if you want a legal embarrassment.`,
            }),
          ],
          ephemeral: true,
        });
        return;
      }

      const challenge = coordinator.createChallenge({
        channelId: interaction.channelId,
        challengerId: interaction.user.id,
        challengerName: interaction.user.displayName,
        ...((useCustom || requestedCustomName !== undefined) && challengerSideboard
          ? { challengerCustomDeck: { tokens: challengerSideboard.tokens, label: buildCustomSideboardLabel(challengerSideboard.name), enforceTokenLimits: true } }
          : {}),
        ...(!(useCustom || requestedCustomName !== undefined) && challengerDeckId !== undefined ? { challengerDeckId } : {}),
        challengedId: opponent.id,
        challengedName: opponent.displayName,
        wager,
      });

      await interaction.reply({
        embeds: [buildChallengeEmbed(challenge)],
        components: buildChallengeComponents(challenge),
        allowedMentions: { parse: [] },
      });
      const reply = await interaction.fetchReply();
      coordinator.setChallengePublicMessageId(challenge.id, reply.id);
      return;
    }

    default: {
      await interaction.reply({
        embeds: [
          buildErrorEmbed({
            title: "Unknown Subcommand",
            description: `I do not know how to process ${subcommand}.`,
          }),
        ],
        ephemeral: true,
      });
    }
  }
};

const handleButtonInteraction = async (interaction: ButtonInteraction): Promise<void> => {
  const parts = interaction.customId.split(":");

  if (parts[0] !== "pazaak") {
    return;
  }

  const action = parts[1];

  switch (action) {
    case "challenge": {
      const resolution = parts[2];
      const challengeId = parts[3];

      if (!challengeId) {
        throw new Error("Malformed challenge identifier.");
      }

      if (resolution === "decline") {
        const declined = coordinator.declineChallenge(challengeId, interaction.user.id);
        await interaction.update({
          embeds: [
            buildWarningEmbed({
              title: "Challenge Closed",
              description: `${declined.challengedName} declined the wager. Honestly, probably the smart call.`,
            }),
          ],
          components: [],
        });
        return;
      }

      if (resolution === "accept") {
        const challenge = coordinator.getPendingChallenge(challengeId);

        if (!challenge) {
          throw new Error("This challenge is no longer available.");
        }

        if (interaction.user.id !== challenge.challengedId) {
          await interaction.reply({
            embeds: [buildErrorEmbed({
              title: "Not Your Challenge",
              description: "Only the challenged player can accept and choose the second deck.",
            })],
            ephemeral: true,
          });
          return;
        }

        if (challenge.challengedDeckId === undefined && challenge.challengedCustomDeck === undefined) {
          const challengedWallet = await walletRepository.getWallet(interaction.user.id, interaction.user.displayName);
          const challengedSideboards = await sideboardRepository.listSideboards(interaction.user.id, interaction.user.displayName);
          const savedDeckId = challengedWallet.preferredRuntimeDeckId ?? undefined;
          await interaction.reply({
            embeds: [buildDeckSelectionEmbed(savedDeckId, challengedSideboards.sideboards)],
            components: buildDeckSelectionComponents(challengeId, savedDeckId, challengedSideboards.sideboards),
            ephemeral: true,
          });
          return;
        }

        const match = coordinator.acceptChallenge(challengeId, interaction.user.id);
        coordinator.setPublicMessageId(match.id, interaction.message.id);
        await interaction.update({
          embeds: [buildMatchEmbed(match)],
          components: buildMatchComponents(match),
        });
        await interaction.followUp({
          ...(await buildPrivateControlsPayload(match, interaction.user.id)),
          ephemeral: true,
        });
      }

      return;
    }

    case "acceptcustompage": {
      const challengeId = parts[2];
      const requestedPage = Number(parts[3] ?? "0");
      const searchQuery = decodeSideboardSearchQuery(parts[4]);

      if (!challengeId) {
        throw new Error("Malformed custom-sideboard page payload.");
      }

      const challenge = coordinator.getPendingChallenge(challengeId);

      if (!challenge) {
        throw new Error("This challenge is no longer available.");
      }

      if (interaction.user.id !== challenge.challengedId) {
        await interaction.reply({
          embeds: [buildErrorEmbed({
            title: "Not Your Challenge",
            description: "Only the challenged player can choose the second deck.",
          })],
          ephemeral: true,
        });
        return;
      }

      const challengedWallet = await walletRepository.getWallet(interaction.user.id, interaction.user.displayName);
      const challengedSideboards = await sideboardRepository.listSideboards(interaction.user.id, interaction.user.displayName);
      const savedDeckId = challengedWallet.preferredRuntimeDeckId ?? undefined;

      await interaction.update({
        embeds: [buildDeckSelectionEmbed(savedDeckId, challengedSideboards.sideboards, searchQuery)],
        components: buildDeckSelectionComponents(
          challengeId,
          savedDeckId,
          challengedSideboards.sideboards,
          Number.isNaN(requestedPage) ? 0 : requestedPage,
          searchQuery,
        ),
      });
      return;
    }

    case "acceptcustomsearch": {
      const challengeId = parts[2];
      const searchQuery = decodeSideboardSearchQuery(parts[3]);

      if (!challengeId) {
        throw new Error("Malformed custom sideboard search payload.");
      }

      await interaction.showModal(buildSideboardSearchModal(`accept:${challengeId}`, searchQuery));
      return;
    }

    case "acceptcustomclear": {
      const challengeId = parts[2];

      if (!challengeId) {
        throw new Error("Malformed custom sideboard clear payload.");
      }

      const challengedWallet = await walletRepository.getWallet(interaction.user.id, interaction.user.displayName);
      const challengedSideboards = await sideboardRepository.listSideboards(interaction.user.id, interaction.user.displayName);
      const savedDeckId = challengedWallet.preferredRuntimeDeckId ?? undefined;

      await interaction.update({
        embeds: [buildDeckSelectionEmbed(savedDeckId, challengedSideboards.sideboards)],
        components: buildDeckSelectionComponents(challengeId, savedDeckId, challengedSideboards.sideboards),
      });
      return;
    }

    case "sideboard": {
      const resolution = parts[2];

      if (!resolution) {
        throw new Error("Malformed sideboard action.");
      }

      if (resolution === "back") {
        const currentSideboards = await sideboardRepository.listSideboards(interaction.user.id, interaction.user.displayName);
        await interaction.update({
          embeds: [await buildSideboardEmbed(interaction.user.id, interaction.user.displayName)],
          components: buildSideboardComponents(currentSideboards.sideboards),
        });
        return;
      }

      if (resolution === "listpage") {
        const requestedPage = Number(parts[3] ?? "0");
        const searchQuery = decodeSideboardSearchQuery(parts[4]);
        const currentSideboards = await sideboardRepository.listSideboards(interaction.user.id, interaction.user.displayName);
        await interaction.update({
          embeds: [await buildSideboardEmbed(interaction.user.id, interaction.user.displayName, searchQuery)],
          components: buildSideboardComponents(currentSideboards.sideboards, requestedPage, searchQuery),
        });
        return;
      }

      if (resolution === "search") {
        const searchQuery = decodeSideboardSearchQuery(parts[3]);
        await interaction.showModal(buildSideboardSearchModal("manage", searchQuery));
        return;
      }

      if (resolution === "clearsearch") {
        const currentSideboards = await sideboardRepository.listSideboards(interaction.user.id, interaction.user.displayName);
        await interaction.update({
          embeds: [await buildSideboardEmbed(interaction.user.id, interaction.user.displayName)],
          components: buildSideboardComponents(currentSideboards.sideboards),
        });
        return;
      }

      if (resolution === "editor") {
        const page = Number(parts[3] ?? "0");
        const selectedSlot = Number(parts[4] ?? "-1");
        const savedSideboard = await sideboardRepository.getSideboard(interaction.user.id);
        const tokens = getEffectiveSideboardTokens(savedSideboard?.tokens);

        await interaction.update({
          embeds: [buildSideboardEditorEmbed(tokens, Number.isNaN(page) ? 0 : page, savedSideboard?.name ?? DEFAULT_PAZAAK_SIDEBOARD_NAME, Number.isNaN(selectedSlot) ? undefined : selectedSlot)],
          components: buildSideboardEditorComponents(tokens, Number.isNaN(page) ? 0 : page, Number.isNaN(selectedSlot) ? undefined : selectedSlot),
        });
        return;
      }

      if (resolution === "editorfocus") {
        const page = Number(parts[3] ?? "0");
        const selectedSlot = Number(parts[4] ?? "-1");
        const savedSideboard = await sideboardRepository.getSideboard(interaction.user.id);
        const tokens = getEffectiveSideboardTokens(savedSideboard?.tokens);

        await interaction.update({
          embeds: [buildSideboardEditorEmbed(tokens, Number.isNaN(page) ? 0 : page, savedSideboard?.name ?? DEFAULT_PAZAAK_SIDEBOARD_NAME, Number.isNaN(selectedSlot) ? undefined : selectedSlot)],
          components: buildSideboardEditorComponents(tokens, Number.isNaN(page) ? 0 : page, Number.isNaN(selectedSlot) ? undefined : selectedSlot),
        });
        return;
      }

      if (resolution === "editormove") {
        const page = Number(parts[3] ?? "0");
        const selectedSlot = Number(parts[4] ?? "-1");
        const direction = parts[5];

        if ((direction !== "left" && direction !== "right") || Number.isNaN(selectedSlot) || selectedSlot < 0 || selectedSlot >= SIDE_DECK_SIZE) {
          throw new Error("Malformed sideboard move payload.");
        }

        const targetSlot = direction === "left" ? selectedSlot - 1 : selectedSlot + 1;

        if (targetSlot < 0 || targetSlot >= SIDE_DECK_SIZE) {
          throw new Error("Sideboard move target is out of range.");
        }

        const savedSideboard = await sideboardRepository.getSideboard(interaction.user.id);
        const tokens = getEffectiveSideboardTokens(savedSideboard?.tokens);
        [tokens[selectedSlot], tokens[targetSlot]] = [tokens[targetSlot]!, tokens[selectedSlot]!];
        const updatedSideboard = await sideboardRepository.saveSideboard(interaction.user.id, interaction.user.displayName, tokens);

        await interaction.update({
          embeds: [buildSideboardEditorEmbed(tokens, Number.isNaN(page) ? 0 : Math.floor(targetSlot / SIDEBOARD_EDITOR_PAGE_SIZE), updatedSideboard.name, targetSlot)],
          components: buildSideboardEditorComponents(tokens, Number.isNaN(page) ? 0 : Math.floor(targetSlot / SIDEBOARD_EDITOR_PAGE_SIZE), targetSlot),
        });
        return;
      }

      if (resolution === "edit") {
        const savedSideboard = await sideboardRepository.getSideboard(interaction.user.id);
        await interaction.showModal(buildSideboardModal(savedSideboard?.tokens ?? [], savedSideboard?.name ?? DEFAULT_PAZAAK_SIDEBOARD_NAME));
        return;
      }

      if (resolution === "clear") {
        const removed = await sideboardRepository.clearSideboard(interaction.user.id);
        const currentSideboards = await sideboardRepository.listSideboards(interaction.user.id, interaction.user.displayName);
        await interaction.update({
          embeds: [buildSuccessEmbed({
            title: "Sideboard Cleared",
            description: removed
              ? `Your active ${CUSTOM_SIDE_DECK_LABEL.toLowerCase()} was removed.`
              : `You did not have an active ${CUSTOM_SIDE_DECK_LABEL.toLowerCase()} to clear.`,
          })],
          components: buildSideboardComponents(currentSideboards.sideboards),
        });
        return;
      }

      return;
    }

    case "controls": {
      const matchId = parts[2];

      if (!matchId) {
        throw new Error("Malformed controls identifier.");
      }

      const match = coordinator.getMatch(matchId);

      if (!match) {
        await interaction.reply({
          embeds: [
            buildErrorEmbed({
              title: "Match Missing",
              description: "This table no longer exists. I probably misplaced it.",
            }),
          ],
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        ...(await buildPrivateControlsPayload(match, interaction.user.id)),
        ephemeral: true,
      });
      return;
    }

    case "advisor": {
      const matchId = parts[2];
      const advisorDifficulty = normalizeAdvisorDifficulty(parts[3]);

      if (!matchId) {
        throw new Error("Malformed advisor identifier.");
      }

      const match = coordinator.getMatch(matchId);

      if (!match) {
        await interaction.reply({
          embeds: [
            buildErrorEmbed({
              title: "Match Missing",
              description: "This table no longer exists. I probably misplaced it.",
            }),
          ],
          ephemeral: true,
        });
        return;
      }

      await interaction.update(await buildPrivateControlsPayload(match, interaction.user.id, advisorDifficulty));
      return;
    }

    case "closespectate": {
      const matchId = parts[2];
      const ownerId = parts[3];

      if (!matchId || !ownerId) {
        throw new Error("Malformed spectator mirror identifier.");
      }

      if (interaction.user.id !== ownerId) {
        await interaction.reply({
          embeds: [buildErrorEmbed({
            title: "Not Your Mirror",
            description: "Only the spectator who opened this mirror can close it.",
          })],
          ephemeral: true,
        });
        return;
      }

      coordinator.unregisterSpectatorMessage(matchId, interaction.message.id);
      await interaction.deferUpdate();
      await interaction.message.delete().catch(() => undefined);
      return;
    }

    case "forfeit": {
      const matchId = parts[2];

      if (!matchId) {
        throw new Error("Malformed forfeit identifier.");
      }

      const match = coordinator.forfeit(matchId, interaction.user.id);
      await settleCompletedMatch(match);
      await interaction.update({
        embeds: [buildMatchEmbed(match)],
        components: buildMatchComponents(match),
      });
      return;
    }

    case "rematch": {
      const matchId = parts[2];

      if (!matchId) {
        throw new Error("Malformed rematch payload.");
      }

      const previousMatch = coordinator.getMatch(matchId);

      if (!previousMatch || previousMatch.phase !== "completed" || !previousMatch.loserId || !previousMatch.winnerId) {
        throw new Error("That completed match is no longer available for rematch.");
      }

      const challengerId = previousMatch.loserId;
      const challengedId = previousMatch.winnerId;
      const wager = previousMatch.wager;

      if (interaction.user.id !== challengerId && interaction.user.id !== challengedId) {
        await interaction.reply({
          embeds: [buildErrorEmbed({ title: "Not a Participant", description: "Only the two players can request a rematch." })],
          ephemeral: true,
        });
        return;
      }

      const challWallet = await walletRepository.getWallet(challengerId, interaction.user.id === challengerId ? interaction.user.displayName : "Challenger");
      const challedWallet = await walletRepository.getWallet(challengedId, interaction.user.id === challengedId ? interaction.user.displayName : "Challenged");
      const challengerName = await resolveGuildDisplayName(interaction, challengerId, challWallet.displayName);
      const challengedName = await resolveGuildDisplayName(interaction, challengedId, challedWallet.displayName);
      const challengerPlayer = previousMatch.players.find((player) => player.userId === challengerId);
      const challengedPlayer = previousMatch.players.find((player) => player.userId === challengedId);

      if (!challengerPlayer || !challengedPlayer) {
        throw new Error("Could not reconstruct rematch players from the completed match.");
      }

      if (challWallet.balance < wager || challedWallet.balance < wager) {
        await interaction.reply({
          embeds: [buildWarningEmbed({
            title: "Insufficient Credits",
            description: `One of you cannot cover the ${wager}-credit rematch stake. Lower those bets if you want to embarrass yourselves again.`,
          })],
          ephemeral: true,
        });
        return;
      }

      const challengerDeckSeed = getRematchDeckSeed(challengerPlayer);
      const challengedDeckSeed = getRematchDeckSeed(challengedPlayer);

      const rematchChallenge = coordinator.createChallenge({
        channelId: interaction.channelId,
        challengerId,
        challengerName,
        ...(challengerDeckSeed.deckId !== undefined ? { challengerDeckId: challengerDeckSeed.deckId } : {}),
        ...(challengerDeckSeed.customDeck !== undefined ? { challengerCustomDeck: challengerDeckSeed.customDeck } : {}),
        challengedId,
        challengedName,
        ...(challengedDeckSeed.deckId !== undefined ? { challengedDeckId: challengedDeckSeed.deckId } : {}),
        ...(challengedDeckSeed.customDeck !== undefined ? { challengedCustomDeck: challengedDeckSeed.customDeck } : {}),
        wager,
      });

      await interaction.update({
        embeds: [buildChallengeEmbed(rematchChallenge)],
        components: buildChallengeComponents(rematchChallenge),
      });
      coordinator.setChallengePublicMessageId(rematchChallenge.id, interaction.message.id);
      return;
    }

    case "draw":
    case "stand":
    case "endturn":
    case "play": {
      const matchId = parts[2];
      const advisorDifficulty = normalizeAdvisorDifficulty(action === "play" ? parts[5] : parts[3]);

      if (!matchId) {
        throw new Error("Malformed match identifier.");
      }

      let match: PazaakMatch;

      if (action === "draw") {
        match = coordinator.draw(matchId, interaction.user.id);
      } else if (action === "stand") {
        match = coordinator.stand(matchId, interaction.user.id);
      } else if (action === "endturn") {
        match = coordinator.endTurn(matchId, interaction.user.id);
      } else {
        const cardId = parts[3];
        const appliedValue = Number(parts[4]);

        if (!cardId || Number.isNaN(appliedValue)) {
          throw new Error("Malformed side card payload.");
        }

        match = coordinator.playSideCard(matchId, interaction.user.id, cardId, appliedValue);
      }

      await settleCompletedMatch(match);
      await refreshBoardMessage(match);
      await interaction.update(await buildPrivateControlsPayload(match, interaction.user.id, advisorDifficulty));
      return;
    }

    default:
      return;
  }
};

const handleStringSelectInteraction = async (interaction: StringSelectMenuInteraction): Promise<void> => {
  const parts = interaction.customId.split(":");

  if (parts[0] !== "pazaak") {
    return;
  }

  const action = parts[1];

  if (action === "sideboardselect") {
    const requestedPage = Number(parts[2] ?? "0");
    const searchQuery = decodeSideboardSearchQuery(parts[3]);
    const selectedName = interaction.values[0];

    if (!selectedName) {
      throw new Error("Missing sideboard selection.");
    }

    await sideboardRepository.setActiveSideboard(interaction.user.id, interaction.user.displayName, selectedName);
    const currentSideboards = await sideboardRepository.listSideboards(interaction.user.id, interaction.user.displayName);

    await interaction.update({
      embeds: [await buildSideboardEmbed(interaction.user.id, interaction.user.displayName, searchQuery)],
      components: buildSideboardComponents(currentSideboards.sideboards, requestedPage, searchQuery),
    });
    return;
  }

  if (action === "sideboardslot") {
    const page = Number(parts[2] ?? "0");
    const slotIndex = Number(parts[3] ?? "-1");
    const selectedSlot = Number(parts[4] ?? "-1");
    const selectedToken = interaction.values[0];

    if (!selectedToken || Number.isNaN(slotIndex) || slotIndex < 0 || slotIndex >= SIDE_DECK_SIZE) {
      throw new Error("Malformed sideboard slot payload.");
    }

    const normalizedToken = normalizeSideDeckToken(selectedToken);

    if (!normalizedToken) {
      throw new Error(`Unsupported sideboard token: ${selectedToken}`);
    }

    const savedSideboard = await sideboardRepository.getSideboard(interaction.user.id);
    const tokens = getEffectiveSideboardTokens(savedSideboard?.tokens);
    tokens[slotIndex] = normalizedToken;
    assertCustomSideDeckTokenLimits(tokens);
    const updatedSideboard = await sideboardRepository.saveSideboard(interaction.user.id, interaction.user.displayName, tokens);

    await interaction.update({
      embeds: [buildSideboardEditorEmbed(tokens, Number.isNaN(page) ? 0 : page, updatedSideboard.name, Number.isNaN(selectedSlot) ? slotIndex : selectedSlot)],
      components: buildSideboardEditorComponents(tokens, Number.isNaN(page) ? 0 : page, Number.isNaN(selectedSlot) ? slotIndex : selectedSlot),
    });
    return;
  }

  if (action !== "acceptdeck" && action !== "acceptdeckcustom") {
    return;
  }

  const challengeId = parts[2];
  const searchQuery = action === "acceptdeckcustom" ? decodeSideboardSearchQuery(parts[4]) : undefined;
  const selectedValue = interaction.values[0];

  if (!challengeId || !selectedValue) {
    throw new Error("Malformed deck selection payload.");
  }

  const savedDeckMatch = /^saved:(\d+)$/.exec(selectedValue);
  const customDeckMatch = /^custom:(.+)$/u.exec(selectedValue);
  const challengedDeckId = selectedValue === "auto" || customDeckMatch !== null
    ? undefined
    : (savedDeckMatch ? Number(savedDeckMatch[1]) : Number(selectedValue));

  if (challengedDeckId !== undefined && (!Number.isInteger(challengedDeckId) || !isRuntimeTslDeckSupported(challengedDeckId))) {
    throw new Error(`Unsupported challenged deck selection: ${selectedValue}`);
  }

  const challenge = coordinator.getPendingChallenge(challengeId);

  if (!challenge) {
    throw new Error("This challenge is no longer available.");
  }

  if (interaction.user.id !== challenge.challengedId) {
    throw new Error("Only the challenged player can choose the second deck.");
  }

  const savedSideboard = customDeckMatch
    ? await sideboardRepository.getSideboard(interaction.user.id, customDeckMatch[1])
    : undefined;

  if (customDeckMatch && !savedSideboard) {
    throw new Error(`You no longer have a saved sideboard named ${customDeckMatch[1]}. Save it again with /pazaak sideboard first.`);
  }

  const challengedDeckChoice: SideDeckChoice | undefined = customDeckMatch
    ? { tokens: savedSideboard!.tokens, label: buildCustomSideboardLabel(savedSideboard!.name), enforceTokenLimits: true }
    : challengedDeckId;

  const match = await startAcceptedMatch(challenge, interaction.user.id, challengedDeckChoice);
  const selectedDeckLabel = customDeckMatch
    ? buildCustomSideboardLabel(savedSideboard!.name)
    : challengedDeckId === undefined
      ? "Auto"
      : formatDeckDisplayName(challengedDeckId, getCanonicalSideDeckDefinition(challengedDeckId)?.label);

  await interaction.update({
    embeds: [buildSuccessEmbed({
      title: "Deck Locked",
      description: `Accepted the challenge with **${selectedDeckLabel}**. The public table is live.`,
    })],
    components: [],
  });
  await interaction.followUp({
    ...(await buildPrivateControlsPayload(match, interaction.user.id)),
    ephemeral: true,
  });
};

const handleModalSubmitInteraction = async (interaction: ModalSubmitInteraction): Promise<void> => {
  const parts = interaction.customId.split(":");

  if (parts[0] !== "pazaak") {
    return;
  }

  if (parts[1] === "sideboardsearch") {
    const searchQuery = normalizeSideboardSearchQuery(interaction.fields.getTextInputValue(SIDEBOARD_SEARCH_FIELD_ID));

    if (parts[2] === "manage") {
      const currentSideboards = await sideboardRepository.listSideboards(interaction.user.id, interaction.user.displayName);
      await interaction.reply({
        embeds: [await buildSideboardEmbed(interaction.user.id, interaction.user.displayName, searchQuery)],
        components: buildSideboardComponents(currentSideboards.sideboards, 0, searchQuery),
        ephemeral: true,
      });
      return;
    }

    if (parts[2] === "accept") {
      const challengeId = parts[3];

      if (!challengeId) {
        throw new Error("Malformed custom sideboard search modal payload.");
      }

      const challengedWallet = await walletRepository.getWallet(interaction.user.id, interaction.user.displayName);
      const challengedSideboards = await sideboardRepository.listSideboards(interaction.user.id, interaction.user.displayName);
      const savedDeckId = challengedWallet.preferredRuntimeDeckId ?? undefined;

      await interaction.reply({
        embeds: [buildDeckSelectionEmbed(savedDeckId, challengedSideboards.sideboards, searchQuery)],
        components: buildDeckSelectionComponents(challengeId, savedDeckId, challengedSideboards.sideboards, 0, searchQuery),
        ephemeral: true,
      });
      return;
    }

    return;
  }

  if (parts[1] !== "sideboard" || parts[2] !== "modal") {
    return;
  }

  const tokens = parseCustomSideboardTokens([
    interaction.fields.getTextInputValue(SIDEBOARD_MODAL_FIRST_FIELD_ID),
    interaction.fields.getTextInputValue(SIDEBOARD_MODAL_SECOND_FIELD_ID),
  ].join(" "));

  const savedSideboard = await sideboardRepository.saveSideboard(interaction.user.id, interaction.user.displayName, tokens);
  const currentSideboards = await sideboardRepository.listSideboards(interaction.user.id, interaction.user.displayName);
  await interaction.reply({
    embeds: [buildSuccessEmbed({
      title: "Sideboard Saved",
      description: `Saved **${formatSideboardName(savedSideboard.name)}** as your active custom 10-card sideboard: **${formatSideboardTokens(tokens)}**. Use it from \`/pazaak challenge use_custom:true\` or the Accept deck picker.`,
    })],
    components: buildSideboardComponents(currentSideboards.sideboards),
    ephemeral: true,
  });
};

client.once("ready", (readyClient) => {
  logger.info("Pazaak Bot is online.", {
    user: readyClient.user.tag,
    startingCredits: config.startingCredits,
    dataDir: config.dataDir,
  });
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "pazaak") {
      await handleSlashCommand(interaction);
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "pazaak-admin") {
      await handleAdminCommand(interaction);
      return;
    }

    if (interaction.isButton()) {
      await handleButtonInteraction(interaction);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      await handleStringSelectInteraction(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      await handleModalSubmitInteraction(interaction);
    }
  } catch (error) {
    logger.error("Pazaak interaction failed.", error);

    const payload = {
      embeds: [
        buildErrorEmbed({
          title: "Table Error",
          description: `Something went wrong at the table: ${toErrorMessage(error)}`,
        }),
      ],
      ephemeral: true,
    };

    if (interaction.isRepliable()) {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload);
      } else {
        await interaction.reply(payload);
      }
    }
  }
});

const deployables = [
  pazaakCommand.toJSON() as RESTPostAPIApplicationCommandsJSONBody,
  pazaakAdminCommand.toJSON() as RESTPostAPIApplicationCommandsJSONBody,
];
await deployGuildCommands(config.discord, deployables, logger);
await coordinator.initialize();

// Turn timer: auto-forfeit the active player if they stall longer than the timeout.
// Runs every 60 seconds; also prunes stale match files once per hour (every 60th tick).
let timerTick = 0;
setInterval(() => {
  timerTick += 1;

  for (const match of coordinator.getActiveMatches()) {
    if (Date.now() - match.turnStartedAt > config.turnTimeoutMs) {
      const activePlayer = getCurrentPlayer(match);
      try {
        const forfeited = coordinator.forfeit(match.id, activePlayer.userId);
        settleCompletedMatch(forfeited).then(() => refreshBoardMessage(forfeited)).catch((err) => {
          logger.error("Turn-timer board refresh failed.", err);
        });
      } catch (err) {
        logger.error("Turn-timer forfeit failed.", err);
      }
    }
  }

  if (timerTick % 60 === 0) {
    matchStore.prune().then((removed) => {
      if (removed > 0) logger.info("Pruned stale match files.", { removed });
    }).catch((err) => {
      logger.error("Match file prune failed.", err);
    });
  }
}, 60_000);

// Start the embedded HTTP + WebSocket API server so Discord Activities and
// the standalone browser can interact with match state in real time.
const { listen: startApiServer } = createApiServer(coordinator, {
  port: config.apiPort,
  discordAppId: config.discord.appId,
  discordClientSecret: config.discord.clientSecret,
  activityOrigin: config.activityUrl,
  publicWebOrigin: config.publicWebOrigin,
  accountRepository,
  walletRepository,
  sideboardRepository,
  matchmakingQueueRepository,
  lobbyRepository,
  matchHistoryRepository,
  matchmakingTickMs: config.matchmakingTickMs,
  allowDevAuth: config.allowDevAuth,
});
startApiServer();

await client.login(config.discord.botToken);