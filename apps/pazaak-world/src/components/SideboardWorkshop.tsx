import { useCallback, useDeferredValue, useEffect, useState } from "react";
import type { SavedSideboardCollectionRecord } from "../types.ts";
import { deleteSideboard, fetchSideboards, saveSideboard, setActiveSideboard } from "../api.ts";

const DEFAULT_TOKENS = ["+1", "-2", "*3", "$$", "TT", "F1", "F2", "VV", "+4", "-5"];
const SUPPORTED_TOKENS = [
  "+1", "+2", "+3", "+4", "+5", "+6",
  "-1", "-2", "-3", "-4", "-5", "-6",
  "*1", "*2", "*3", "*4", "*5", "*6",
  "$$", "TT", "F1", "F2", "VV",
];
const TOKEN_DESCRIPTIONS: Record<string, string> = {
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
  "$$": "Copy previous",
  "TT": "Tiebreaker",
  "F1": "Flip 2 and 4",
  "F2": "Flip 3 and 6",
  "VV": "Value change",
};

interface SideboardWorkshopProps {
  accessToken: string;
  username: string;
  onBack: () => void;
}

export function SideboardWorkshop({ accessToken, username, onBack }: SideboardWorkshopProps) {
  const [collection, setCollection] = useState<SavedSideboardCollectionRecord | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [draftTokens, setDraftTokens] = useState<string[]>([...DEFAULT_TOKENS]);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const selectedSideboard = collection?.sideboards.find((sideboard) => sideboard.name === selectedName) ?? null;
  const normalizedDraftName = normalizeBoardName(draftName);
  const normalizedSearchQuery = deferredSearchQuery.trim().toLocaleLowerCase();
  const filteredSideboards = collection?.sideboards.filter((sideboard) => {
    return normalizedSearchQuery.length === 0 || sideboard.name.toLocaleLowerCase().includes(normalizedSearchQuery);
  }) ?? [];
  const tokenDirty = selectedSideboard === null
    ? draftTokens.join("|") !== DEFAULT_TOKENS.join("|")
    : draftTokens.join("|") !== selectedSideboard.tokens.join("|");
  const contentDirty = selectedSideboard === null
    ? normalizedDraftName.length > 0 || tokenDirty
    : tokenDirty;
  const renameDirty = selectedSideboard !== null && normalizedDraftName.length > 0 && normalizedDraftName !== selectedSideboard.name;
  const hasUnsavedChanges = contentDirty || renameDirty;
  const selectedBoardVisible = selectedSideboard !== null
    ? filteredSideboards.some((sideboard) => sideboard.name === selectedSideboard.name)
    : false;

  const syncDraft = useCallback((nextCollection: SavedSideboardCollectionRecord, nextSelectedName: string | null) => {
    setSelectedName(nextSelectedName);

    const selected = nextCollection.sideboards.find((sideboard) => sideboard.name === nextSelectedName) ?? null;

    if (selected) {
      setDraftName(selected.name);
      setDraftTokens([...selected.tokens]);
      return;
    }

    setDraftName("");
    setDraftTokens([...DEFAULT_TOKENS]);
  }, []);

  const loadSideboards = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const nextCollection = await fetchSideboards(accessToken);
      setCollection(nextCollection);
      const fallback = nextCollection.sideboards.find((sideboard) => sideboard.isActive)?.name
        ?? nextCollection.sideboards[0]?.name
        ?? null;
      syncDraft(nextCollection, fallback);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [accessToken, syncDraft]);

  useEffect(() => {
    void loadSideboards();
  }, [loadSideboards]);

  useEffect(() => {
    if (!collection) {
      return;
    }

    const fallback = collection.sideboards.find((sideboard) => sideboard.isActive)?.name
      ?? collection.sideboards[0]?.name
      ?? null;

    if (!selectedName || !collection.sideboards.some((sideboard) => sideboard.name === selectedName)) {
      syncDraft(collection, fallback);
    }
  }, [collection, selectedName, syncDraft]);

  const updateDraftToken = (index: number, token: string) => {
    setDraftTokens((prev) => prev.map((entry, entryIndex) => entryIndex === index ? token : entry));
  };

  const createBoardName = (baseName: string): string => {
    const existingNames = new Set((collection?.sideboards ?? []).map((sideboard) => sideboard.name.toLocaleLowerCase()));

    if (!existingNames.has(baseName.toLocaleLowerCase())) {
      return baseName;
    }

    let suffix = 2;
    while (existingNames.has(`${baseName} ${suffix}`.toLocaleLowerCase())) {
      suffix += 1;
    }

    return `${baseName} ${suffix}`;
  };

  const hasNameConflict = (name: string, ignoreName?: string | null): boolean => {
    const ignoredName = ignoreName?.toLocaleLowerCase();

    return (collection?.sideboards ?? []).some((sideboard) => {
      const nextName = sideboard.name.toLocaleLowerCase();
      return nextName === name.toLocaleLowerCase() && nextName !== ignoredName;
    });
  };

  const handleCreate = async () => {
    const nextName = createBoardName(selectedSideboard ? `${selectedSideboard.name} Copy` : "Workshop Board");
    const nextTokens = selectedSideboard ? [...selectedSideboard.tokens] : [...DEFAULT_TOKENS];
    await persistBoard(nextName, nextTokens, false, null);
    setNotice(`Created ${nextName}.`);
  };

  const handleSave = async (makeActive: boolean) => {
    const targetName = selectedSideboard?.name ?? normalizedDraftName;

    if (!targetName) {
      setError("Sideboard name cannot be empty.");
      return;
    }

    if (!selectedSideboard && hasNameConflict(targetName)) {
      setError(`A saved sideboard named ${targetName} already exists.`);
      return;
    }

    await persistBoard(targetName, draftTokens, makeActive, null);
    setNotice(makeActive ? `Saved and activated ${targetName}.` : `Saved ${targetName}.`);
  };

  const handleRename = async () => {
    if (!selectedSideboard) {
      return;
    }

    if (!normalizedDraftName) {
      setError("Sideboard name cannot be empty.");
      return;
    }

    if (normalizedDraftName === selectedSideboard.name) {
      setError("Rename the board to a new name before saving the rename.");
      return;
    }

    if (hasNameConflict(normalizedDraftName, selectedSideboard.name)) {
      setError(`A saved sideboard named ${normalizedDraftName} already exists.`);
      return;
    }

    const previousName = selectedSideboard.name;
    await persistBoard(normalizedDraftName, draftTokens, selectedSideboard.isActive, previousName);
    setNotice(`Renamed ${previousName} to ${normalizedDraftName}.`);
  };

  const persistBoard = async (
    nextName: string,
    nextTokens: string[],
    makeActive: boolean,
    previousName: string | null,
  ) => {
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      let nextCollection = await saveSideboard(nextName, nextTokens, accessToken, makeActive);

      if (previousName && previousName !== nextName) {
        nextCollection = await deleteSideboard(previousName, accessToken);
        if (makeActive || previousName === collection?.activeName) {
          nextCollection = await setActiveSideboard(nextName, accessToken);
        }
      }

      setCollection(nextCollection);
      syncDraft(nextCollection, nextName);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async () => {
    if (!selectedSideboard) {
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const nextCollection = await setActiveSideboard(selectedSideboard.name, accessToken);
      setCollection(nextCollection);
      syncDraft(nextCollection, selectedSideboard.name);
      setNotice(`Activated ${selectedSideboard.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedSideboard) {
      return;
    }

    if (!confirm(`Delete ${selectedSideboard.name}?`)) {
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const nextCollection = await deleteSideboard(selectedSideboard.name, accessToken);
      setCollection(nextCollection);
      const fallback = nextCollection.sideboards.find((sideboard) => sideboard.isActive)?.name
        ?? nextCollection.sideboards[0]?.name
        ?? null;
      syncDraft(nextCollection, fallback);
      setNotice(`Deleted ${selectedSideboard.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDrop = (toIndex: number) => {
    if (draggingIndex === null || draggingIndex === toIndex) {
      setDraggingIndex(null);
      return;
    }

    setDraftTokens((prev) => {
      const next = [...prev];
      const [movedToken] = next.splice(draggingIndex, 1);
      next.splice(toIndex, 0, movedToken!);
      return next;
    });
    setDraggingIndex(null);
  };

  const moveToken = (fromIndex: number, direction: -1 | 1) => {
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= draftTokens.length) {
      return;
    }

    setDraftTokens((prev) => {
      const next = [...prev];
      [next[fromIndex], next[toIndex]] = [next[toIndex]!, next[fromIndex]!];
      return next;
    });
  };

  const handleBack = () => {
    if (hasUnsavedChanges && !confirm("Discard unsaved sideboard changes and go back?")) {
      return;
    }

    onBack();
  };

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeoutId = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!saving && contentDirty) {
          void handleSave(false);
        }
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [contentDirty, saving]);

  const validation = buildValidationSummary(draftTokens);

  return (
    <div className="screen screen--workshop">
      <div className="workshop-shell">
        <header className="workshop-header">
          <div>
            <p className="workshop-kicker">Pazaak World</p>
            <h1 className="workshop-title">Sideboard Workshop</h1>
            <p className="workshop-sub">{username}, shape your saved 10-card boards here and keep Discord for match flow.</p>
          </div>
          <button className="btn btn--ghost" onClick={handleBack}>Back</button>
        </header>

        {error && <div className="workshop-alert workshop-alert--error" role="alert">{error}</div>}
        {notice && <div className="workshop-alert workshop-alert--success" role="status" aria-live="polite">{notice}</div>}

        {loading ? (
          <div className="workshop-loading">Loading sideboards…</div>
        ) : (
          <div className="workshop-grid">
            <aside className="workshop-sidebar">
              <div className="workshop-sidebar__header">
                <h2>Saved Boards</h2>
                <button className="btn btn--secondary btn--sm" onClick={() => void handleCreate()} disabled={saving}>Duplicate</button>
              </div>
              <div className="workshop-sidebar__filters">
                <label className="workshop-field">
                  <span>Find Board</span>
                  <div className="workshop-search">
                    <input
                      className="workshop-input"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value.slice(0, 32))}
                      onKeyDown={(event) => {
                        if (event.key === "Escape" && searchQuery.length > 0) {
                          event.preventDefault();
                          setSearchQuery("");
                        }
                      }}
                      placeholder="ranked, doubles, anti-burst..."
                    />
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => setSearchQuery("")}
                      disabled={searchQuery.trim().length === 0}
                    >
                      Clear
                    </button>
                  </div>
                </label>
                <p className="workshop-sidebar__count">
                  {normalizedSearchQuery.length > 0
                    ? `${filteredSideboards.length} of ${collection?.sideboards.length ?? 0} boards match.`
                    : `${collection?.sideboards.length ?? 0} saved boards available.`}
                </p>
                {selectedSideboard && normalizedSearchQuery.length > 0 && !selectedBoardVisible && (
                  <p className="workshop-sidebar__count workshop-sidebar__count--muted">
                    Still editing {selectedSideboard.name} outside the current filter.
                  </p>
                )}
              </div>
              <div className="workshop-board-list">
                {collection && filteredSideboards.length > 0 ? filteredSideboards.map((sideboard) => (
                  <button
                    key={sideboard.name}
                    className={`workshop-board-list__item ${sideboard.name === selectedName ? "workshop-board-list__item--selected" : ""}`}
                    onClick={() => syncDraft(collection, sideboard.name)}
                  >
                    <span>{sideboard.name}</span>
                    {sideboard.isActive && <span className="workshop-badge">Active</span>}
                  </button>
                )) : collection && collection.sideboards.length > 0 ? (
                  <div className="workshop-empty">No saved boards match this filter yet.</div>
                ) : (
                  <div className="workshop-empty">No saved boards yet. Duplicate the default starter to begin.</div>
                )}
              </div>
            </aside>

            <section className="workshop-main">
              <div className="workshop-toolbar">
                <label className="workshop-field">
                  <span>Board Name</span>
                  <input
                    className="workshop-input"
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value.slice(0, 32))}
                    placeholder="aggressive, ladder, doubles..."
                  />
                  <p className="workshop-toolbar__hint">
                    {selectedSideboard
                      ? "Rename uses this field. Save only updates the current board's card layout."
                      : "Name the board here before saving it for the first time."}
                  </p>
                </label>

                <div className="workshop-actions">
                  <button className="btn btn--secondary" onClick={() => void handleRename()} disabled={saving || !renameDirty}>Rename</button>
                  <button className="btn btn--secondary" onClick={() => void handleActivate()} disabled={saving || !selectedSideboard || selectedSideboard.isActive}>Set Active</button>
                  <button className="btn btn--secondary" onClick={() => void handleSave(false)} disabled={saving || !contentDirty}>Save</button>
                  <button className="btn btn--primary" onClick={() => void handleSave(true)} disabled={saving || !contentDirty}>Save and Activate</button>
                  <button className="btn btn--danger" onClick={() => void handleDelete()} disabled={saving || !selectedSideboard}>Delete</button>
                </div>
              </div>

              <div className="workshop-validation">
                <div>
                  <strong>Validation</strong>
                  <p>{validation.summary}</p>
                </div>
                <div className="workshop-validation__chips">
                  <span>{validation.fixed} fixed</span>
                  <span>{validation.flip} flip</span>
                  <span>{validation.special} special</span>
                  <span>{validation.unique} unique</span>
                </div>
              </div>

              <div className="workshop-slots">
                {draftTokens.map((token, index) => (
                  <div
                    key={`${index}-${token}`}
                    className={`workshop-slot ${draggingIndex === index ? "workshop-slot--dragging" : ""}`}
                    draggable
                    onDragStart={() => setDraggingIndex(index)}
                    onDragEnd={() => setDraggingIndex(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => handleDrop(index)}
                  >
                    <div className="workshop-slot__meta">
                      <span className="workshop-slot__label">Slot {index + 1}</span>
                      <span className="workshop-slot__token">{token}</span>
                    </div>
                    <div className="workshop-slot__reorder" role="group" aria-label={`Reorder slot ${index + 1}`}>
                      <button
                        className="btn btn--ghost btn--sm"
                        type="button"
                        onClick={() => moveToken(index, -1)}
                        disabled={index === 0}
                        aria-label={`Move slot ${index + 1} up`}
                      >
                        Move Up
                      </button>
                      <button
                        className="btn btn--ghost btn--sm"
                        type="button"
                        onClick={() => moveToken(index, 1)}
                        disabled={index === draftTokens.length - 1}
                        aria-label={`Move slot ${index + 1} down`}
                      >
                        Move Down
                      </button>
                    </div>
                    <label className="workshop-field">
                      <span>Card</span>
                      <select
                        className="workshop-select"
                        value={token}
                        onChange={(event) => updateDraftToken(index, event.target.value)}
                      >
                        {SUPPORTED_TOKENS.map((supportedToken) => (
                          <option key={supportedToken} value={supportedToken}>
                            {supportedToken} · {TOKEN_DESCRIPTIONS[supportedToken]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="workshop-slot__help">Drag this card onto another slot to reorder the board.</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function normalizeBoardName(name: string): string {
  return name.trim().replace(/\s+/gu, " ");
}

function buildValidationSummary(tokens: string[]) {
  const counts = tokens.reduce((state, token) => {
    if (/^[+-][1-6]$/u.test(token)) {
      state.fixed += 1;
    } else if (/^[*][1-6]$/u.test(token)) {
      state.flip += 1;
    } else {
      state.special += 1;
    }

    return state;
  }, { fixed: 0, flip: 0, special: 0 });

  return {
    ...counts,
    unique: new Set(tokens).size,
    summary: `All ${tokens.length} slots are valid for the bot's custom-sideboard rules.`,
  };
}