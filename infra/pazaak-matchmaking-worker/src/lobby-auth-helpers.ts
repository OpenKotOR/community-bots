type AccountLike = {
  username: string;
  email: string | null;
};

export type MatchActorCreatePayload = {
  matchId: string;
  playerOneId: string;
  playerOneName: string;
  playerTwoId: string;
  playerTwoName: string;
  gameMode: "canonical" | "wacky";
  setsToWin: number;
  turnTimeoutMs: number;
};

export function selectAccountByUsernameOrEmail<T extends AccountLike>(
  accounts: Record<string, T>,
  username: string,
  email: string | null,
): T | undefined {
  return Object.values(accounts).find(
    (candidate) => candidate.username === username || (email !== null && candidate.email === email),
  );
}

export function normalizeLobbyRoundAndTimerSettings(input: {
  maxRounds: unknown;
  turnTimerSeconds: unknown;
}): {
  maxRounds: number;
  turnTimerSeconds: number;
} {
  const parsedMaxRounds = Number(input.maxRounds ?? 3);
  const parsedTurnTimerSeconds = Number(input.turnTimerSeconds ?? 45);
  return {
    maxRounds: Math.max(1, Math.min(9, Number.isFinite(parsedMaxRounds) ? parsedMaxRounds : 3)),
    turnTimerSeconds: Math.max(0, Math.min(180, Number.isFinite(parsedTurnTimerSeconds) ? parsedTurnTimerSeconds : 45)),
  };
}

export function buildMatchActorCreatePayload(input: {
  matchId: string;
  playerOneId: string;
  playerOneName: string;
  playerTwoId: string;
  playerTwoName: string;
  gameMode: string;
  maxRounds: number;
  turnTimerSeconds: number;
}): MatchActorCreatePayload {
  return {
    matchId: input.matchId,
    playerOneId: input.playerOneId,
    playerOneName: input.playerOneName,
    playerTwoId: input.playerTwoId,
    playerTwoName: input.playerTwoName,
    gameMode: input.gameMode === "wacky" ? "wacky" : "canonical",
    setsToWin: input.maxRounds,
    turnTimeoutMs: input.turnTimerSeconds * 1000,
  };
}