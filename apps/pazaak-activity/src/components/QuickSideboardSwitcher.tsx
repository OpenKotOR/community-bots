import { useEffect, useState } from "react";
import { fetchSideboards, setActiveSideboard } from "../api.ts";
import type { SavedSideboardCollectionRecord, SavedSideboardRecord } from "../types.ts";

interface QuickSideboardSwitcherProps {
  accessToken: string;
  variant: "lobby" | "game";
  onOpenWorkshop: () => void;
}

export function QuickSideboardSwitcher({ accessToken, variant, onOpenWorkshop }: QuickSideboardSwitcherProps) {
  const [collection, setCollection] = useState<SavedSideboardCollectionRecord | null>(null);
  const [selectedName, setSelectedName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void loadSideboards();
  }, []);

  useEffect(() => {
    const fallbackName = collection?.activeName ?? collection?.sideboards[0]?.name ?? "";

    if (!fallbackName) {
      setSelectedName("");
      return;
    }

    setSelectedName((previous) => {
      if (previous && collection?.sideboards.some((sideboard) => sideboard.name === previous)) {
        return previous;
      }

      return fallbackName;
    });
  }, [collection]);

  const loadSideboards = async () => {
    setLoading(true);
    setError(null);

    try {
      const nextCollection = await fetchSideboards(accessToken);
      setCollection(nextCollection);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const sortedSideboards = [...(collection?.sideboards ?? [])].sort(compareSideboards);
  const activeSideboard = sortedSideboards.find((sideboard) => sideboard.isActive) ?? null;
  const quickChoices = sortedSideboards.filter((sideboard) => sideboard.name !== activeSideboard?.name).slice(0, 3);
  const selectedBoard = sortedSideboards.find((sideboard) => sideboard.name === selectedName) ?? null;
  const selectionDirty = Boolean(selectedBoard && selectedBoard.name !== activeSideboard?.name);

  const handleActivate = async (targetName = selectedName) => {
    if (!targetName || targetName === activeSideboard?.name) {
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const nextCollection = await setActiveSideboard(targetName, accessToken);
      setCollection(nextCollection);
      setSelectedName(targetName);
      setNotice(`Active board switched to ${targetName}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={`quick-switcher quick-switcher--${variant}`}>
      <div className="quick-switcher__header">
        <div>
          <p className="quick-switcher__kicker">{variant === "lobby" ? "Before You Challenge" : "Next Match Setup"}</p>
          <h2 className="quick-switcher__title">Quick Sideboard Switcher</h2>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={onOpenWorkshop}>
          Open Workshop
        </button>
      </div>

      {error && <div className="quick-switcher__alert quick-switcher__alert--error">{error}</div>}
      {notice && <div className="quick-switcher__alert quick-switcher__alert--success">{notice}</div>}

      {loading ? (
        <div className="quick-switcher__empty">Loading saved boards…</div>
      ) : sortedSideboards.length === 0 ? (
        <div className="quick-switcher__empty">
          No saved boards yet. Open the workshop to build, duplicate, and save your first sideboard.
        </div>
      ) : (
        <>
          {activeSideboard && (
            <div className="quick-switcher__active">
              <div>
                <p className="quick-switcher__label">Active Board</p>
                <strong>{activeSideboard.name}</strong>
                <p className="quick-switcher__tokens">{activeSideboard.tokens.join(" ")}</p>
              </div>
              <span className="workshop-badge">Active</span>
            </div>
          )}

          {quickChoices.length > 0 && (
            <div className="quick-switcher__actions">
              <p className="quick-switcher__label">Recent Alternatives</p>
              <div className="quick-switcher__chips">
                {quickChoices.map((sideboard) => (
                  <button
                    key={sideboard.name}
                    className="btn btn--secondary btn--sm"
                    onClick={() => void handleActivate(sideboard.name)}
                    disabled={saving}
                  >
                    Use {sideboard.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="quick-switcher__picker">
            <label className="workshop-field quick-switcher__field">
              <span>Switch To</span>
              <select
                className="workshop-select"
                value={selectedName}
                onChange={(event) => setSelectedName(event.target.value)}
                disabled={saving}
              >
                {sortedSideboards.map((sideboard) => (
                  <option key={sideboard.name} value={sideboard.name}>
                    {sideboard.name}{sideboard.isActive ? " (active)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn btn--primary" onClick={() => void handleActivate()} disabled={saving || !selectionDirty}>
              {saving ? "Switching…" : "Set Active"}
            </button>
          </div>

          <p className="quick-switcher__note">
            {variant === "game"
              ? "This updates your saved active board for future challenges, accepts, and rematches. The deck already in this live match stays unchanged."
              : "Switch here when you just need a different saved board. Use the workshop when you need rename, duplication, filtering, or card edits."}
          </p>
        </>
      )}
    </section>
  );
}

function compareSideboards(left: SavedSideboardRecord, right: SavedSideboardRecord): number {
  if (left.isActive !== right.isActive) {
    return left.isActive ? -1 : 1;
  }

  const timestampDelta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);

  if (!Number.isNaN(timestampDelta) && timestampDelta !== 0) {
    return timestampDelta;
  }

  return left.name.localeCompare(right.name);
}