import { useState, useEffect, useCallback } from "react";
import type { LeaderboardEntry, MatchmakingQueueRecord, PazaakLobbyRecord, PazaakMatchHistoryRecord, SerializedMatch, WalletRecord } from "./types.ts";
import { initDiscordAuth, closeActivity } from "./discord.ts";
import {
  addLobbyAi,
  createLobby,
  enqueueMatchmaking,
  fetchHistory,
  fetchLeaderboard,
  fetchLobbies,
  fetchMe,
  fetchMyMatch,
  joinLobby,
  leaveLobby,
  leaveMatchmaking,
  setLobbyReady,
  startLobby,
  subscribeToMatch,
} from "./api.ts";
import { GameBoard } from "./components/GameBoard.tsx";
import { QuickSideboardSwitcher } from "./components/QuickSideboardSwitcher.tsx";
import { SideboardWorkshop } from "./components/SideboardWorkshop.tsx";

type ActivitySession = {
  userId: string;
  username: string;
  accessToken: string;
};

// ---------------------------------------------------------------------------
// App states
// ---------------------------------------------------------------------------

type AppState =
  | { stage: "loading" }
  | { stage: "auth_error"; message: string }
  | { stage: "lobby"; auth: ActivitySession }
  | { stage: "workshop"; auth: ActivitySession; returnTo: "lobby" | "game"; match?: SerializedMatch }
  | { stage: "game"; auth: ActivitySession; match: SerializedMatch };

export default function App() {
  const [state, setState] = useState<AppState>({ stage: "loading" });

  // On mount: run Discord SDK auth, then poll for an active match.
  useEffect(() => {
    (async () => {
      try {
        const auth = await initDiscordAuth();
        const match = await fetchMyMatch(auth.accessToken);

        const session: ActivitySession = {
          userId: auth.userId,
          username: auth.username,
          accessToken: auth.accessToken,
        };

        if (match) {
          setState({ stage: "game", auth: session, match });
        } else {
          setState({ stage: "lobby", auth: session });
        }
      } catch (err) {
        setState({
          stage: "auth_error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }, []);

  // Subscribe to live WS updates when in game.
  const handleMatchUpdate = useCallback((updated: SerializedMatch) => {
    setState((prev) => {
      if (prev.stage !== "game") return prev;
      return { ...prev, match: updated };
    });
  }, []);

  useEffect(() => {
    if (state.stage !== "game") return;
    const unsubscribe = subscribeToMatch(state.match.id, handleMatchUpdate);
    return unsubscribe;
    // Re-subscribe only when the match ID changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stage === "game" ? state.match.id : null]);

  const restoreFromWorkshop = useCallback(async (auth: ActivitySession, returnTo: "lobby" | "game") => {
    try {
      if (returnTo === "game") {
        const latestMatch = await fetchMyMatch(auth.accessToken);

        if (latestMatch) {
          setState({ stage: "game", auth, match: latestMatch });
          return;
        }
      }
    } catch {
      // Fall through to the lobby if the match refresh fails.
    }

    setState({ stage: "lobby", auth });
  }, []);

  if (state.stage === "loading") {
    return <LoadingScreen />;
  }

  if (state.stage === "auth_error") {
    return <ErrorScreen message={state.message} />;
  }

  if (state.stage === "lobby") {
    return (
      <LobbyScreen
        accessToken={state.auth.accessToken}
        userId={state.auth.userId}
        username={state.auth.username}
        onOpenWorkshop={() => setState({ stage: "workshop", auth: state.auth, returnTo: "lobby" })}
        onEnterMatch={(match) => setState({ stage: "game", auth: state.auth, match })}
      />
    );
  }

  if (state.stage === "workshop") {
    return (
      <SideboardWorkshop
        accessToken={state.auth.accessToken}
        username={state.auth.username}
        onBack={() => restoreFromWorkshop(state.auth, state.returnTo)}
      />
    );
  }

  // stage === "game"
  return (
    <GameBoard
      match={state.match}
      userId={state.auth.userId}
      accessToken={state.auth.accessToken}
      onMatchUpdate={(match) => setState({ stage: "game", auth: state.auth, match })}
      onOpenWorkshop={() => setState({ stage: "workshop", auth: state.auth, returnTo: "game", match: state.match })}
      onExit={() => closeActivity("Player exited game")}
    />
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function LoadingScreen() {
  return (
    <div className="screen screen--loading">
      <div className="loading-spinner" aria-label="Loading…">
        <div className="spinner-ring" />
      </div>
      <p className="loading-label">Connecting to the pazaak table…</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="screen screen--error">
      <div className="error-card">
        <div className="error-icon" aria-hidden="true">⚠</div>
        <h2 className="error-title">Authentication Failed</h2>
        <p className="error-message">{message}</p>
        <button className="btn btn--primary" onClick={() => window.location.reload()}>
          Try Again
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lobby (no active match)
// ---------------------------------------------------------------------------

function LobbyScreen({
  accessToken,
  userId,
  username,
  onEnterMatch,
  onOpenWorkshop,
}: {
  accessToken: string;
  userId: string;
  username: string;
  onEnterMatch: (match: SerializedMatch) => void;
  onOpenWorkshop: () => void;
}) {
  const [wallet, setWallet] = useState<WalletRecord | null>(null);
  const [queue, setQueue] = useState<MatchmakingQueueRecord | null>(null);
  const [lobbies, setLobbies] = useState<PazaakLobbyRecord[]>([]);
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([]);
  const [history, setHistory] = useState<PazaakMatchHistoryRecord[]>([]);
  const [newLobbyName, setNewLobbyName] = useState(`${username}'s Table`);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshLobby = useCallback(async () => {
    const [me, openLobbies, leaderboard, recentHistory] = await Promise.all([
      fetchMe(accessToken),
      fetchLobbies(accessToken),
      fetchLeaderboard(accessToken),
      fetchHistory(accessToken, 5),
    ]);

    if (me.match) {
      onEnterMatch(me.match);
      return;
    }

    setWallet(me.wallet);
    setQueue(me.queue);
    setLobbies(openLobbies);
    setLeaders(leaderboard.slice(0, 5));
    setHistory(recentHistory);
  }, [accessToken, onEnterMatch]);

  useEffect(() => {
    refreshLobby().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [refreshLobby]);

  const runLobbyAction = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError(null);

    try {
      await action();
      await refreshLobby();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleRefresh = () => runLobbyAction("refresh", async () => {
    const match = await fetchMyMatch(accessToken);
    if (match) onEnterMatch(match);
  });

  const handleCreateLobby = () => runLobbyAction("create-lobby", async () => {
    await createLobby(accessToken, { name: newLobbyName, maxPlayers: 2 });
  });

  const handleStartSolo = () => runLobbyAction("solo", async () => {
    const lobby = await createLobby(accessToken, { name: `${username} vs AI`, maxPlayers: 2 });
    await addLobbyAi(accessToken, lobby.id, wallet?.userSettings.preferredAiDifficulty ?? "professional");
    const started = await startLobby(accessToken, lobby.id);
    onEnterMatch(started.match);
  });

  const ownLobby = lobbies.find((lobby) => lobby.players.some((player) => player.userId === userId));
  const canUseLobbyControls = busy === null;

  const formatDate = (value: string | null) => value ? new Date(value).toLocaleDateString() : "Never";

  return (
    <div className="screen screen--lobby">
      <div className="lobby-shell">
        <section className="lobby-panel lobby-panel--profile">
          <div>
            <p className="lobby-kicker">Pazaak Table</p>
            <h1 className="lobby-title">{username}</h1>
            <p className="lobby-sub">{wallet ? `${wallet.balance} credits · ${wallet.mmr} MMR · ${wallet.gamesWon}/${wallet.gamesPlayed} games` : "Loading account"}</p>
          </div>
          {error ? <div className="lobby-alert lobby-alert--error">{error}</div> : null}
          <div className="lobby-stat-grid">
            <div><span>Streak</span><strong>{wallet?.streak ?? 0}</strong></div>
            <div><span>Best</span><strong>{wallet?.bestStreak ?? 0}</strong></div>
            <div><span>Last Match</span><strong>{formatDate(wallet?.lastMatchAt ?? null)}</strong></div>
          </div>
          <div className="lobby-actions">
            <button className="btn btn--primary" onClick={handleStartSolo} disabled={!canUseLobbyControls}>
              Start AI Table
            </button>
            {queue ? (
              <button className="btn btn--secondary" onClick={() => runLobbyAction("leave-queue", async () => { await leaveMatchmaking(accessToken); })} disabled={!canUseLobbyControls}>
                Leave Queue
              </button>
            ) : (
              <button className="btn btn--secondary" onClick={() => runLobbyAction("queue", async () => { await enqueueMatchmaking(accessToken); })} disabled={!canUseLobbyControls}>
                Join Queue
              </button>
            )}
            <button className="btn btn--secondary" onClick={onOpenWorkshop}>
              Sideboards
            </button>
            <button className="btn btn--ghost" onClick={handleRefresh} disabled={!canUseLobbyControls}>
              {busy === "refresh" ? "Checking" : "Refresh"}
            </button>
          </div>
        </section>

        <section className="lobby-panel lobby-panel--tables">
          <div className="lobby-section-header">
            <div>
              <p className="lobby-kicker">Open Tables</p>
              <h2>Lobby Browser</h2>
            </div>
            <div className="lobby-create">
              <input value={newLobbyName} onChange={(event) => setNewLobbyName(event.target.value)} aria-label="Lobby name" />
              <button className="btn btn--primary btn--sm" onClick={handleCreateLobby} disabled={!canUseLobbyControls}>Create</button>
            </div>
          </div>

          <div className="lobby-table-list">
            {lobbies.length === 0 ? <p className="lobby-empty">No open tables.</p> : null}
            {lobbies.map((lobby) => {
              const inLobby = lobby.players.some((player) => player.userId === userId);
              const isHost = lobby.hostUserId === userId;
              const readyPlayer = lobby.players.find((player) => player.userId === userId)?.ready ?? false;
              const canStart = isHost && lobby.players.length === 2 && lobby.players.every((player) => player.ready);

              return (
                <article className="lobby-table" key={lobby.id}>
                  <div>
                    <strong>{lobby.name}</strong>
                    <span>{lobby.players.length}/{lobby.maxPlayers} seats · {lobby.players.map((player) => player.displayName).join(", ")}</span>
                  </div>
                  <div className="lobby-table__actions">
                    {inLobby ? (
                      <>
                        <button className="btn btn--card" onClick={() => runLobbyAction(`ready-${lobby.id}`, async () => { await setLobbyReady(accessToken, lobby.id, !readyPlayer); })} disabled={!canUseLobbyControls}>
                          {readyPlayer ? "Unready" : "Ready"}
                        </button>
                        {isHost ? <button className="btn btn--card" onClick={() => runLobbyAction(`ai-${lobby.id}`, async () => { await addLobbyAi(accessToken, lobby.id, wallet?.userSettings.preferredAiDifficulty ?? "professional"); })} disabled={!canUseLobbyControls || lobby.players.length >= lobby.maxPlayers}>Add AI</button> : null}
                        {isHost ? <button className="btn btn--primary btn--sm" onClick={() => runLobbyAction(`start-${lobby.id}`, async () => { const result = await startLobby(accessToken, lobby.id); onEnterMatch(result.match); })} disabled={!canUseLobbyControls || !canStart}>Start</button> : null}
                        <button className="btn btn--ghost btn--sm" onClick={() => runLobbyAction(`leave-${lobby.id}`, async () => { await leaveLobby(accessToken, lobby.id); })} disabled={!canUseLobbyControls}>Leave</button>
                      </>
                    ) : (
                      <button className="btn btn--card" onClick={() => runLobbyAction(`join-${lobby.id}`, async () => { await joinLobby(accessToken, lobby.id); })} disabled={!canUseLobbyControls || ownLobby !== undefined || lobby.players.length >= lobby.maxPlayers}>Join</button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="lobby-panel">
          <p className="lobby-kicker">Leaderboard</p>
          <div className="lobby-list">
            {leaders.map((leader) => <div key={leader.userId}><span>#{leader.rank} {leader.displayName}</span><strong>{leader.mmr}</strong></div>)}
            {leaders.length === 0 ? <p className="lobby-empty">No ranked games yet.</p> : null}
          </div>
        </section>

        <section className="lobby-panel">
          <p className="lobby-kicker">Recent History</p>
          <div className="lobby-list">
            {history.map((match) => <div key={match.matchId}><span>{match.summary}</span><strong>{formatDate(match.completedAt)}</strong></div>)}
            {history.length === 0 ? <p className="lobby-empty">No completed matches.</p> : null}
          </div>
        </section>

        <QuickSideboardSwitcher accessToken={accessToken} variant="lobby" onOpenWorkshop={onOpenWorkshop} />
      </div>
    </div>
  );
}

