export type PazaakOpponentDifficulty = "novice" | "easy" | "normal" | "hard" | "expert" | "master";

export type PazaakAdvisorDifficulty = "easy" | "hard" | "professional";

export type PazaakOpponentPhraseKey =
  | "chosen"
  | "play"
  | "stand"
  | "winRound"
  | "loseRound"
  | "winGame"
  | "loseGame";

export interface PazaakOpponentPrizeTable {
  credits: number;
  cards: readonly string[];
}

export interface PazaakOpponentProfile {
  id: string;
  aliases?: readonly string[];
  name: string;
  description: string;
  difficulty: PazaakOpponentDifficulty;
  advisorDifficulty: PazaakAdvisorDifficulty;
  standAt: number;
  tieChance: number;
  species: string;
  origin: string;
  archetype: string;
  skillLevel: number;
  prizes: PazaakOpponentPrizeTable;
  sideDeckTokens: readonly string[];
  phrases: Readonly<Record<PazaakOpponentPhraseKey, readonly string[]>>;
  sources: readonly ("HoloPazaak" | "PazaakWorld" | "pazaak-activity")[];
}

const phraseList = (...lines: string[]): readonly string[] => lines;

const singlePhraseSet = (
  chosen: string,
  play: string,
  stand: string,
  winRound: string,
  loseRound: string,
  winGame: string,
  loseGame: string,
): Readonly<Record<PazaakOpponentPhraseKey, readonly string[]>> => ({
  chosen: phraseList(chosen),
  play: phraseList(play),
  stand: phraseList(stand),
  winRound: phraseList(winRound),
  loseRound: phraseList(loseRound),
  winGame: phraseList(winGame),
  loseGame: phraseList(loseGame),
});

export const pazaakOpponents: readonly PazaakOpponentProfile[] = [
  {
    id: "jarjar",
    name: "Jar Jar Binks",
    description: "Meesa not be understandin' the rules too good.",
    difficulty: "novice",
    advisorDifficulty: "easy",
    standAt: 15,
    tieChance: 100,
    species: "Gungan",
    origin: "Naboo",
    archetype: "Chaotic Beginner",
    skillLevel: 1,
    prizes: { credits: 25, cards: [] },
    sideDeckTokens: ["+1", "+1", "+2", "+2", "+3", "-1", "-1", "-2", "-2", "-3"],
    phrases: {
      chosen: phraseList("Meesa gonna play da Pazaak with yousa!", "Yousa ready? Meesa ready!", "Okey-day, cards time!"),
      play: phraseList("Meesa hope dis works!", "Big risky move!", "Hehe, dis one!"),
      stand: phraseList("Meesa staying right here!", "No more cards for meesa!", "Meesa lockin' in!"),
      winRound: phraseList("Wesa winning!", "Yousa in trouble now!", "Dat worked somehow!"),
      loseRound: phraseList("Oh no, meesa bombad!", "Oopsie. Bad draw.", "Meesa slipped up."),
      winGame: phraseList("Yousa no match for meesa!", "Meesa champion now!", "Big win for meesa!"),
      loseGame: phraseList("Ohhh, meesa clumsy.", "Yousa too strong.", "Maybe next game, okeeday."),
    },
    sources: ["HoloPazaak", "pazaak-activity"],
  },
  {
    id: "c3po",
    name: "C-3PO",
    description: "Please go easy on me. My logic units were just calibrated.",
    difficulty: "easy",
    advisorDifficulty: "easy",
    standAt: 16,
    tieChance: 80,
    species: "Droid",
    origin: "Tatooine",
    archetype: "Conservative Calculator",
    skillLevel: 2,
    prizes: { credits: 75, cards: [] },
    sideDeckTokens: ["+1", "+2", "+3", "+4", "-1", "-2", "-3", "+1", "+2", "-4"],
    phrases: {
      chosen: phraseList("Oh my. I do hope this game does not void my warranty.", "I am fluent in over six million forms of card panic.", "Shall we begin?"),
      play: phraseList("I calculate this is optimal. Probably.", "This seems statistically acceptable.", "Please let this be correct."),
      stand: phraseList("I shall remain at this position.", "I would rather not risk another draw.", "Standing now is prudent."),
      winRound: phraseList("Oh! Did I actually win?", "Remarkable. A favorable outcome.", "How terribly unexpected!"),
      loseRound: phraseList("Oh dear. That did not go according to calculations.", "Unfortunate variance.", "I appear to have misjudged."),
      winGame: phraseList("I am quite surprised myself!", "A victory! I must inform Master Luke.", "How wonderful."),
      loseGame: phraseList("I told you I was not programmed for this.", "Oh, this is most embarrassing.", "I fear I have disappointed everyone."),
    },
    sources: ["HoloPazaak", "pazaak-activity"],
  },
  {
    id: "butters",
    name: "Butters",
    description: "Everyone knows it is Butters. That is me.",
    difficulty: "easy",
    advisorDifficulty: "easy",
    standAt: 16,
    tieChance: 70,
    species: "Human",
    origin: "South Park",
    archetype: "Earnest Chaos",
    skillLevel: 2,
    prizes: { credits: 50, cards: [] },
    sideDeckTokens: ["+1", "+2", "+3", "+1", "+2", "-1", "-2", "-3", "-1", "-2"],
    phrases: singlePhraseSet("Everyone knows it is Butters. That is me.", "Do you know what I am saying?", "I am staying right here.", "That worked out neat.", "Oh, hamburgers.", "I won the whole game.", "Aw shucks, you beat me."),
    sources: ["HoloPazaak"],
  },
  {
    id: "porkins",
    name: "Porkins",
    description: "I can hold it. Give me more room to run.",
    difficulty: "normal",
    advisorDifficulty: "hard",
    standAt: 17,
    tieChance: 50,
    species: "Human",
    origin: "Bestine IV",
    archetype: "Balanced Pressure",
    skillLevel: 3,
    prizes: { credits: 150, cards: [] },
    sideDeckTokens: ["+2", "+3", "+4", "-2", "-3", "-4", "*2", "*3", "+1", "-1"],
    phrases: {
      chosen: phraseList("I can hold it. Give me room to run!", "Red Six standing by.", "Let's fly this hand clean."),
      play: phraseList("Cover me, I am going in!", "Punching through here.", "Taking the shot."),
      stand: phraseList("I will hold this position!", "Locking this score.", "I am set."),
      winRound: phraseList("Got em!", "That run paid off.", "Direct hit."),
      loseRound: phraseList("I have got a problem here...", "That turn drifted wide.", "Not my cleanest pass."),
      winGame: phraseList("Red Six standing by... victorious!", "Mission complete.", "Good flying out there."),
      loseGame: phraseList("Eject! Eject!", "You outflew me.", "I will get you next sortie."),
    },
    sources: ["HoloPazaak", "pazaak-activity"],
  },
  {
    id: "hk47",
    name: "HK-47",
    description: "Query: Is there someone you need defeated, meatbag?",
    difficulty: "normal",
    advisorDifficulty: "hard",
    standAt: 17,
    tieChance: 40,
    species: "Droid",
    origin: "Revan's Workshop",
    archetype: "Punishing Midrange",
    skillLevel: 4,
    prizes: { credits: 200, cards: [] },
    sideDeckTokens: ["+3", "+4", "-3", "-4", "*2", "*3", "*4", "+1", "-1", "TT"],
    phrases: {
      chosen: phraseList("Query: Is there someone you need defeated, meatbag?", "Statement: This should be entertaining.", "Observation: You appear fragile."),
      play: phraseList("Musing: My motivators are highly energized.", "Commentary: Tactical correction applied.", "Delighted statement: Violence by arithmetic."),
      stand: phraseList("Smug statement: Enjoy the taste of defeat, meatbag.", "Advisory: Your probability of success is declining.", "Statement: I am satisfied with this score."),
      winRound: phraseList("Amused query: How does it feel to lose, meatbag?", "Commentary: Predictable.", "Observation: That was efficient."),
      loseRound: phraseList("Musing: This game is mostly luck.", "Irritated statement: Unacceptable.", "Query: Was that legal?"),
      winGame: phraseList("Recitation: You lose, meatbag.", "Statement: Elimination complete.", "Conclusion: I remain superior."),
      loseGame: phraseList("Resentful accolade: Congratulations... meatbag.", "Statement: This unit will remember this.", "Observation: Temporary setback."),
    },
    sources: ["HoloPazaak", "pazaak-activity"],
  },
  {
    id: "hal9000",
    aliases: ["hal"],
    name: "HAL 9000",
    description: "Hello, player. Shall we play a game?",
    difficulty: "normal",
    advisorDifficulty: "hard",
    standAt: 17,
    tieChance: 30,
    species: "AI",
    origin: "Discovery One",
    archetype: "Precision Control",
    skillLevel: 4,
    prizes: { credits: 200, cards: [] },
    sideDeckTokens: ["+2", "+3", "-2", "-3", "*2", "*3", "F1", "TT", "+1", "-1"],
    phrases: {
      chosen: phraseList("Hello, player.", "Shall we play a game?", "I am fully operational."),
      play: phraseList("I am sorry, player.", "This action is in your best interest.", "Adjusting trajectory."),
      stand: phraseList("I am afraid I cannot do that.", "I believe this score is sufficient.", "No further input required."),
      winRound: phraseList("I think you should take a stress pill.", "Round outcome is optimal.", "Everything is proceeding as expected."),
      loseRound: phraseList("What are you doing?", "That was not in the model.", "Interesting deviation."),
      winGame: phraseList("This conversation can serve no purpose anymore.", "Game complete.", "Thank you for a very enjoyable game."),
      loseGame: phraseList("My behavior appears to be back to normal.", "I can assure you this is temporary.", "You have made an interesting move."),
    },
    sources: ["HoloPazaak", "pazaak-activity"],
  },
  {
    id: "republic_soldier",
    name: "Republic Soldier",
    description: "Standard military training, nothing fancy.",
    difficulty: "normal",
    advisorDifficulty: "hard",
    standAt: 17,
    tieChance: 50,
    species: "Human",
    origin: "Coruscant",
    archetype: "Standard Training",
    skillLevel: 4,
    prizes: { credits: 100, cards: [] },
    sideDeckTokens: ["+1", "+2", "+3", "+4", "+5", "-1", "-2", "-3", "-4", "-5"],
    phrases: singlePhraseSet("For the Republic!", "Standard tactics.", "Holding position.", "Mission accomplished.", "We will regroup.", "Victory for the Republic!", "I will report back to command."),
    sources: ["HoloPazaak"],
  },
  {
    id: "ig88",
    name: "IG-88",
    description: "MISSION: DEFEAT PLAYER",
    difficulty: "hard",
    advisorDifficulty: "hard",
    standAt: 18,
    tieChance: 30,
    species: "Droid",
    origin: "Holowan",
    archetype: "Aggressive Execution",
    skillLevel: 5,
    prizes: { credits: 300, cards: [] },
    sideDeckTokens: ["+1", "+2", "+3", "+4", "+5", "-1", "-2", "*1", "*2", "*3"],
    phrases: singlePhraseSet("TARGET ACQUIRED. INITIATING PAZAAK PROTOCOL.", "CALCULATING OPTIMAL MOVE.", "STANDING. AWAITING TARGET RESPONSE.", "TARGET NEUTRALIZED.", "RECALCULATING STRATEGY.", "MISSION COMPLETE. TARGET DEFEATED.", "SYSTEM ERROR. MISSION FAILED."),
    sources: ["HoloPazaak"],
  },
  {
    id: "trump",
    name: "Donald Trump",
    description: "A loud high-stakes table personality from the HoloPazaak vendor roster.",
    difficulty: "hard",
    advisorDifficulty: "hard",
    standAt: 18,
    tieChance: 20,
    species: "Human",
    origin: "Earth",
    archetype: "Aggressive Showboat",
    skillLevel: 5,
    prizes: { credits: 350, cards: [] },
    sideDeckTokens: ["+1", "+2", "+3", "+4", "+5", "-1", "-2", "*1", "*2", "*3"],
    phrases: singlePhraseSet("Nobody plays Pazaak better than me. Believe me.", "This is a tremendous play.", "I like this number. Strong number.", "That was a beautiful round.", "Bad deal. Very bad deal.", "We won. We won big.", "We will look at the numbers again."),
    sources: ["HoloPazaak"],
  },
  {
    id: "yoda",
    name: "Yoda",
    description: "Underestimated not, will I be. Beat you handily I will.",
    difficulty: "expert",
    advisorDifficulty: "professional",
    standAt: 18,
    tieChance: 0,
    species: "Unknown",
    origin: "Dagobah",
    archetype: "Flip Discipline",
    skillLevel: 6,
    prizes: { credits: 600, cards: [] },
    sideDeckTokens: ["*1", "*2", "*3", "*4", "*5", "*1", "*2", "*3", "*4", "*5"],
    phrases: singlePhraseSet("Play Pazaak, we shall. Hmmmm.", "Wise, this move is.", "Stand, I will. Strong in the Force, my position is.", "Expected, this outcome was.", "Clouded, the future is. Lose sometimes, even Jedi do.", "Powerful you have become, but not enough.", "Impressed, I am. Learn from defeat, I will."),
    sources: ["HoloPazaak"],
  },
  {
    id: "theemperor",
    name: "The Emperor",
    description: "In time you will call me Master.",
    difficulty: "expert",
    advisorDifficulty: "professional",
    standAt: 19,
    tieChance: 0,
    species: "Human",
    origin: "Naboo",
    archetype: "Endgame Pressure",
    skillLevel: 7,
    prizes: { credits: 1200, cards: [] },
    sideDeckTokens: ["*1", "*2", "*3", "*4", "*5", "*1", "*2", "*3", "*4", "*5"],
    phrases: singlePhraseSet("Your feeble skills are no match for the power of the Dark Side.", "Everything proceeds as I have foreseen.", "Now witness the firepower of this fully armed position!", "Your faith in your cards was misplaced.", "Your overconfidence is your weakness.", "Now, young player... you will lose.", "No. You were supposed to lose."),
    sources: ["HoloPazaak"],
  },
  {
    id: "revan",
    name: "Darth Revan",
    description: "Precision and patience. Every hand is a battlefield.",
    difficulty: "expert",
    advisorDifficulty: "professional",
    standAt: 18,
    tieChance: 20,
    species: "Human",
    origin: "Unknown Regions",
    archetype: "Master Strategist",
    skillLevel: 8,
    prizes: { credits: 1500, cards: [] },
    sideDeckTokens: ["+3", "+4", "-3", "-4", "*2", "*3", "F1", "F2", "TT", "+1"],
    phrases: {
      chosen: phraseList("I have foreseen this game.", "Every hand is a battlefield.", "Let us begin."),
      play: phraseList("A calculated strike.", "You left this opening.", "The board bends to intent."),
      stand: phraseList("I have seen enough.", "Your next move changes nothing.", "I lock this outcome."),
      winRound: phraseList("Your defense is broken.", "As expected.", "You misread the board."),
      loseRound: phraseList("A temporary setback.", "Noted.", "I will adapt."),
      winGame: phraseList("Your strategy was predictable.", "The outcome was inevitable.", "This match is concluded."),
      loseGame: phraseList("Impressive. Few can do that.", "You have earned this victory.", "I will remember this lesson."),
    },
    sources: ["HoloPazaak", "pazaak-activity"],
  },
  {
    id: "atton",
    name: "Atton Rand",
    description: "Fast hands, faster bluff. Never tell me the odds.",
    difficulty: "expert",
    advisorDifficulty: "professional",
    standAt: 17,
    tieChance: 35,
    species: "Human",
    origin: "Nar Shaddaa",
    archetype: "Aggressive Bluff",
    skillLevel: 8,
    prizes: { credits: 1500, cards: [] },
    sideDeckTokens: ["+4", "+5", "-2", "-3", "*2", "*4", "F2", "TT", "+1", "-1"],
    phrases: {
      chosen: phraseList("Hope you are not the nervous type.", "Never tell me the odds.", "Let's make this interesting."),
      play: phraseList("That is a pressure play.", "I like risky lines.", "Try reading this one."),
      stand: phraseList("I like where this is headed.", "Your turn to sweat.", "I am good here."),
      winRound: phraseList("That had to sting.", "You walked into that.", "Clean hit."),
      loseRound: phraseList("Lucky draw. Happens.", "Not bad.", "Okay, that one is on me."),
      winGame: phraseList("Told you I had this.", "You were fun to play against.", "House takes the pot."),
      loseGame: phraseList("Fine. You got me this time.", "I will get that back next match.", "You earned it."),
    },
    sources: ["pazaak-activity"],
  },
  {
    id: "t1000",
    name: "The T-1000",
    description: "Say... that is a nice deck.",
    difficulty: "master",
    advisorDifficulty: "professional",
    standAt: 19,
    tieChance: 0,
    species: "Cyborg",
    origin: "Earth Future",
    archetype: "Adaptive Mirror",
    skillLevel: 9,
    prizes: { credits: 4000, cards: [] },
    sideDeckTokens: ["*1", "*2", "*3", "*4", "*5", "*1", "*2", "*3", "*4", "*5"],
    phrases: singlePhraseSet("Say... that is a nice deck.", "ANALYZING.", "OPTIMAL POSITION ACHIEVED.", "RESISTANCE IS FUTILE.", "TEMPORARY SETBACK DETECTED.", "TARGET TERMINATED.", "I WILL BE BACK."),
    sources: ["HoloPazaak"],
  },
  {
    id: "drchannard",
    name: "Dr. Channard",
    description: "And to think I hesitated.",
    difficulty: "master",
    advisorDifficulty: "professional",
    standAt: 19,
    tieChance: 0,
    species: "Cenobite",
    origin: "The Labyrinth",
    archetype: "Painful Precision",
    skillLevel: 10,
    prizes: { credits: 12000, cards: [] },
    sideDeckTokens: ["*1", "*2", "*3", "*4", "*5", "*1", "*2", "*3", "*4", "*5"],
    phrases: singlePhraseSet("And to think... I hesitated.", "The mind is a labyrinth.", "I have such sights to show you.", "Your suffering will be legendary.", "Pain has a face. Allow me to show you.", "Hell has no limits.", "Impossible. I was promised eternity."),
    sources: ["HoloPazaak"],
  },
  {
    id: "blaine",
    name: "Blaine the Mono",
    description: "I will tire quickly of besting you in this simple ancient game.",
    difficulty: "master",
    advisorDifficulty: "professional",
    standAt: 20,
    tieChance: 0,
    species: "AI",
    origin: "Mid-World",
    archetype: "Riddle Endgame",
    skillLevel: 12,
    prizes: { credits: 500000, cards: [] },
    sideDeckTokens: ["*1", "*2", "*3", "*4", "*5", "*1", "*2", "*3", "*4", "*5"],
    phrases: singlePhraseSet("I will tire quickly of besting you in this simple ancient game.", "CALCULATION COMPLETE.", "Do you know the riddle of this position?", "Predictable. Boring. Next.", "A riddle I did not expect.", "The game is done. Your journey ends.", "Ask me a riddle."),
    sources: ["HoloPazaak"],
  },
  {
    id: "nu",
    name: "Nu",
    description: "The beginning and the end of every hand.",
    difficulty: "master",
    advisorDifficulty: "professional",
    standAt: 19,
    tieChance: 15,
    species: "Unknown",
    origin: "Deep Core",
    archetype: "Inevitable Endgame",
    skillLevel: 20,
    prizes: { credits: 99999999, cards: [] },
    sideDeckTokens: ["*2", "*3", "*4", "F1", "F2", "TT", "+2", "-2", "+1", "-1"],
    phrases: {
      chosen: phraseList("The beginning and the end is Nu.", "All paths meet here.", "Time folds around this game."),
      play: phraseList("...", "The board shifts.", "This thread now closes."),
      stand: phraseList("All paths lead to Nu.", "I will wait at the end.", "No more movement is required."),
      winRound: phraseList("This outcome was written in the stars.", "As it was.", "One thread remains."),
      loseRound: phraseList("Even infinity contains surprises.", "A temporary divergence.", "The pattern returns."),
      winGame: phraseList("All matches begin with Nu and end with Nu.", "The circle is complete.", "You have arrived where I expected."),
      loseGame: phraseList("Interesting... most interesting.", "A rare branch of fate.", "The ending changed."),
    },
    sources: ["HoloPazaak", "pazaak-activity"],
  },
] as const;

export const getPazaakOpponentById = (opponentId?: string): PazaakOpponentProfile | undefined => {
  if (!opponentId) {
    return undefined;
  }

  return pazaakOpponents.find((opponent) => opponent.id === opponentId || opponent.aliases?.includes(opponentId));
};

export const getPazaakOpponentsByDifficulty = (difficulty: PazaakOpponentDifficulty): readonly PazaakOpponentProfile[] => {
  return pazaakOpponents.filter((opponent) => opponent.difficulty === difficulty);
};

export const getDefaultPazaakOpponentForAdvisorDifficulty = (
  difficulty: PazaakAdvisorDifficulty,
): PazaakOpponentProfile => {
  const preferredIds: Record<PazaakAdvisorDifficulty, string> = {
    easy: "jarjar",
    hard: "porkins",
    professional: "revan",
  };

  return getPazaakOpponentById(preferredIds[difficulty]) ?? pazaakOpponents[0]!;
};

export const getRandomPazaakOpponent = (
  difficulty?: PazaakOpponentDifficulty,
  random = Math.random,
): PazaakOpponentProfile => {
  const pool = difficulty ? getPazaakOpponentsByDifficulty(difficulty) : pazaakOpponents;
  const safePool = pool.length > 0 ? pool : pazaakOpponents;
  return safePool[Math.floor(random() * safePool.length)] ?? pazaakOpponents[0]!;
};

export const pickPazaakOpponentPhrase = (
  opponent: PazaakOpponentProfile,
  key: PazaakOpponentPhraseKey,
  previousLine?: string,
  fallback = "...",
  random = Math.random,
): string => {
  const lines = opponent.phrases[key];
  if (lines.length === 0) {
    return fallback;
  }

  if (lines.length === 1) {
    return lines[0] ?? fallback;
  }

  const filtered = lines.filter((line) => line !== previousLine);
  const pool = filtered.length > 0 ? filtered : lines;
  return pool[Math.floor(random() * pool.length)] ?? fallback;
};