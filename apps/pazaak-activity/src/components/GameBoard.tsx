import { useState } from "react";
import type { AdvisorAction, AdvisorAlternative, AdvisorCategory, AdvisorConfidence, AdvisorDifficulty, AdvisorSnapshot, SerializedMatch, SerializedPlayerState, SideCardOption } from "../types.ts";
import { draw, stand, endTurn, playSideCard, forfeit } from "../api.ts";
import { getAdvisorSnapshot, getSideCardOptions, WIN_SCORE, SETS_TO_WIN } from "../game-utils.ts";
import { QuickSideboardSwitcher } from "./QuickSideboardSwitcher.tsx";

interface GameBoardProps {
  match: SerializedMatch;
  userId: string;
  accessToken: string;
  onMatchUpdate: (match: SerializedMatch) => void;
  onOpenWorkshop: () => void;
  onExit: () => void;
}

export function GameBoard({ match, userId, accessToken, onMatchUpdate, onOpenWorkshop, onExit }: GameBoardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advisorDifficulty, setAdvisorDifficulty] = useState<AdvisorDifficulty>("professional");

  const myPlayer = match.players.find((p) => p.userId === userId) ?? null;
  const opponent = match.players.find((p) => p.userId !== userId) ?? null;
  const isMyTurn = match.activePlayerIndex === match.players.findIndex((p) => p.userId === userId);

  const act = async (fn: () => Promise<SerializedMatch>) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await fn();
      onMatchUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDraw = () => act(() => draw(match.id, accessToken));
  const handleStand = () => act(() => stand(match.id, accessToken));
  const handleEndTurn = () => act(() => endTurn(match.id, accessToken));
  const handlePlayCard = (option: SideCardOption) => act(() => playSideCard(match.id, accessToken, option));
  const handleForfeit = () => {
    if (!confirm("Are you sure you want to forfeit this match?")) return;
    act(() => forfeit(match.id, accessToken));
  };

  const cardOptions = myPlayer && (match.phase === "after-draw") && isMyTurn
    ? getSideCardOptions(myPlayer)
    : [];
  const advisorSnapshot = myPlayer ? getAdvisorSnapshot(match, userId, advisorDifficulty) : null;
  const advisor = advisorSnapshot?.recommendation ?? null;

  const isCompleted = match.phase === "completed";

  return (
    <div className="game-board">
      {/* Header */}
      <header className="game-header">
        <span className="game-header__title">Pazaak Table</span>
        <span className="game-header__set">Set {match.setNumber}</span>
        <span className="game-header__wager">⚙ {match.wager} credits</span>
        <div className="game-header__actions">
          {myPlayer && (
            <button className="btn btn--secondary btn--sm" onClick={onOpenWorkshop}>
              Sideboard Workshop
            </button>
          )}
        <button className="btn btn--ghost game-header__exit" onClick={onExit} title="Exit activity">
          ✕
        </button>
        </div>
      </header>

      {/* Status */}
      <div className={`status-bar ${isCompleted ? "status-bar--complete" : isMyTurn ? "status-bar--my-turn" : "status-bar--waiting"}`}>
        {match.statusLine}
      </div>

      {/* Error */}
      {error && (
        <div className="error-toast" role="alert">
          {error}
          <button className="error-toast__close" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {myPlayer && !isCompleted && (
        <QuickSideboardSwitcher accessToken={accessToken} variant="game" onOpenWorkshop={onOpenWorkshop} />
      )}

      {advisor && advisorSnapshot && !isCompleted && (
        <div className="game-advisor" role="status" aria-live="polite">
          <div className="game-advisor__header">
            <span className="game-advisor__eyebrow">PazaakWorld Advisor</span>
            <div className="game-advisor__difficulty-row">
              {(["easy", "hard", "professional"] as const).map((difficulty) => (
                <button
                  key={difficulty}
                  className={`btn btn--sm ${advisorDifficulty === difficulty ? "btn--primary" : "btn--ghost"}`}
                  onClick={() => setAdvisorDifficulty(difficulty)}
                  type="button"
                >
                  {formatAdvisorDifficultyLabel(difficulty)}
                </button>
              ))}
            </div>
          </div>
          <strong className="game-advisor__action">{describeAdvisorAction(advisor)}</strong>
          <span className="game-advisor__rationale">{advisor.rationale}</span>
          <div className="game-advisor__meta">
            <span className={`game-advisor__pill game-advisor__pill--${advisorSnapshot.confidence}`}>{formatAdvisorConfidenceLabel(advisorSnapshot.confidence)} confidence</span>
            <span className="game-advisor__pill">{formatAdvisorCategoryLabel(advisorSnapshot.category)}</span>
            <span className="game-advisor__pill">Next-draw bust risk {Math.round(advisorSnapshot.bustProbability * 100)}%</span>
          </div>
          {advisorSnapshot.alternatives.length > 1 && (
            <div className="game-advisor__alternatives">
              <span className="game-advisor__alternatives-label">Fallbacks</span>
              <div className="game-advisor__alternatives-list">
                {advisorSnapshot.alternatives.slice(1).map((alternative) => (
                  <span key={`${alternative.displayLabel}-${alternative.score}`} className="game-advisor__alternative">
                    {formatAdvisorAlternative(alternative)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Players */}
      <div className="players">
        {opponent && (
          <PlayerPanel
            player={opponent}
            isActive={!isMyTurn && !isCompleted}
            label="Opponent"
          />
        )}
        {myPlayer ? (
          <PlayerPanel
            player={myPlayer}
            isActive={isMyTurn && !isCompleted}
            label="You"
            isMe
          />
        ) : (
          <SpectatorPanel />
        )}
      </div>

      {/* Controls */}
      {!isCompleted && myPlayer && (
        <div className="game-controls">
          {isMyTurn && match.phase === "turn" && !myPlayer.stood && (
            <button className="btn btn--primary" onClick={handleDraw} disabled={busy}>
              Draw
            </button>
          )}

          {isMyTurn && (match.phase === "after-draw" || match.phase === "after-card") && (
            <>
              <button className="btn btn--secondary" onClick={handleEndTurn} disabled={busy}>
                End Turn
              </button>
              <button className="btn btn--secondary" onClick={handleStand} disabled={busy}>
                Stand on {myPlayer.total}
              </button>
            </>
          )}

          {isMyTurn && cardOptions.length > 0 && (
            <div className="side-cards">
              <span className="side-cards__label">Play a side card:</span>
              <div className="side-cards__grid">
                {cardOptions.map((opt, i) => (
                  <button
                    key={`${opt.cardId}-${opt.appliedValue}-${i}`}
                    className="btn btn--card"
                    onClick={() => handlePlayCard(opt)}
                    disabled={busy}
                  >
                    {opt.displayLabel}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!isMyTurn && (
            <p className="waiting-label">Waiting for opponent…</p>
          )}

          <button className="btn btn--danger btn--sm" onClick={handleForfeit} disabled={busy}>
            Forfeit
          </button>
        </div>
      )}

      {/* Completed */}
      {isCompleted && (
        <div className="game-result">
          {match.winnerId === userId ? (
            <p className="game-result__win">🏆 You won!</p>
          ) : match.loserId === userId ? (
            <p className="game-result__lose">💀 You lost.</p>
          ) : (
            <p className="game-result__draw">It's a draw.</p>
          )}
          <p className="game-result__status">{match.statusLine}</p>
          <button className="btn btn--ghost" onClick={onExit}>Close Activity</button>
        </div>
      )}

      {/* Score legend */}
      <footer className="game-footer">
        First to {SETS_TO_WIN} set wins · Target: {WIN_SCORE}
      </footer>
    </div>
  );
}

function describeAdvisorAction(advisor: AdvisorAction): string {
  switch (advisor.action) {
    case "draw":
      return "Draw main deck";
    case "stand":
      return "Stand";
    case "end_turn":
      return "End turn";
    case "play_side":
      return `Play ${advisor.displayLabel}`;
  }
}

function formatAdvisorDifficultyLabel(difficulty: AdvisorDifficulty): string {
  switch (difficulty) {
    case "easy":
      return "Easy";
    case "hard":
      return "Hard";
    case "professional":
      return "Professional";
  }
}

function formatAdvisorConfidenceLabel(confidence: AdvisorConfidence): string {
  switch (confidence) {
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
  }
}

function formatAdvisorCategoryLabel(category: AdvisorCategory): string {
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
}

function formatAdvisorAlternative(alternative: AdvisorAlternative): string {
  return `${alternative.displayLabel} · ${formatAdvisorCategoryLabel(alternative.category)}`;
}

// ---------------------------------------------------------------------------
// PlayerPanel
// ---------------------------------------------------------------------------

interface PlayerPanelProps {
  player: SerializedPlayerState;
  isActive: boolean;
  label: string;
  isMe?: boolean;
}

function PlayerPanel({ player, isActive, label, isMe = false }: PlayerPanelProps) {
  const deckSummary = player.sideDeckLabel
    ? `Deck ${player.sideDeckLabel}${player.sideDeckId !== null ? ` (#${player.sideDeckId})` : ""}`
    : "Deck data unavailable";

  return (
    <div className={`player-panel ${isActive ? "player-panel--active" : ""} ${isMe ? "player-panel--me" : ""}`}>
      <div className="player-panel__header">
        <span className="player-panel__name">{player.displayName}</span>
        <span className="player-panel__badge">{label}</span>
        <span className="player-panel__sets">{player.roundWins} sets</span>
        {player.stood && <span className="player-panel__stood">Standing</span>}
        {isActive && <span className="player-panel__turn-dot" aria-label="Active player" />}
      </div>
      <div className="player-panel__meta">{deckSummary}</div>

      {/* Board */}
      <div className="board">
        {player.board.length === 0 ? (
          <span className="board__empty">No cards yet</span>
        ) : (
          player.board.map((card, i) => (
            <div
              key={`${card.source || 'deck'}-${card.value}-${card.frozen}-${i}`}
              className={`board-card ${card.value < 0 ? "board-card--neg" : ""} ${card.frozen ? "board-card--frozen" : ""}`}
            >
              {card.value > 0 && i > 0 ? `+${card.value}` : card.value}
            </div>
          ))
        )}
        <div className="board__total">{player.total}</div>
      </div>

      {/* Hand (only for current player — shows labels, masks for opponent) */}
      {isMe && player.hand.length > 0 && (
        <div className="player-hand">
          {player.hand.map((card) => {
            const used = player.usedCardIds.includes(card.id);
            return (
              <span key={card.id} className={`hand-card ${used ? "hand-card--used" : ""}`}>
                {card.label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SpectatorPanel() {
  return (
    <div className="player-panel player-panel--spectator">
      <p className="spectator-label">You are spectating this match.</p>
    </div>
  );
}
