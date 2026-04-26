import { useState, useEffect, useCallback, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { SettingsModal } from "./SettingsModal.tsx";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
import type { PazaakUserSettings } from "../types.ts";
import type { MatchSocketConnectionState } from "../api.ts";
import { soundManager } from "../utils/soundManager.ts";

const menuIcon = (icon: string): string => {
  const MENU_ICON_MAP: Record<string, string> = {
    rocket: "◆",
    robot: "◈",
    seedling: "◇",
    brain: "◉",
    crown: "★",
    bolt: "⚡",
    search: "⌕",
    users: "◎",
    plus: "+",
    signin: "↦",
    scroll: "▤",
    target: "◎",
    layers: "▦",
    star: "✶",
    settings: "⚙",
    user: "◌",
  };
  return MENU_ICON_MAP[icon] ?? "•";
};

interface GlobalAccountCornerProps {
  username: string;
  mmr: number | null;
  isOnline: boolean;
  canLogout: boolean;
  canJumpToLobby: boolean;
  busy: boolean;
  currentSettings: PazaakUserSettings;
  socketState?: MatchSocketConnectionState;
  onRefresh: () => void;
  onJumpToLobby: () => void;
  onLogout: () => void;
  onSignIn: () => void;
  onSettingsSave?: (settings: PazaakUserSettings) => Promise<void>;
}

export function GlobalAccountCorner({
  username,
  mmr,
  isOnline,
  canLogout,
  canJumpToLobby,
  busy,
  currentSettings,
  socketState = "disconnected",
  onRefresh,
  onJumpToLobby,
  onLogout,
  onSignIn,
  onSettingsSave,
}: GlobalAccountCornerProps) {
  const [identityMenuOpen, setIdentityMenuOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const identityMenuRef = useRef<HTMLDivElement | null>(null);
  const identityButtonRef = useRef<HTMLButtonElement | null>(null);
  const gearButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);
  const wasOpenRef = useRef(false);

  const getMenuItems = () => {
    if (!identityMenuRef.current) {
      return [];
    }
    return Array.from(identityMenuRef.current.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)"));
  };

  const closeIdentityMenu = useCallback(() => {
    setIdentityMenuOpen(false);
  }, []);

  const toggleIdentityMenu = () => {
    lastTriggerRef.current = identityButtonRef.current;
    setIdentityMenuOpen((prev) => !prev);
  };

  useEffect(() => {
    if (!identityMenuOpen) {
      return;
    }

    const handlePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        closeIdentityMenu();
      }
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeIdentityMenu();
      }
    };

    window.addEventListener("pointerdown", handlePointer);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("pointerdown", handlePointer);
      window.removeEventListener("keydown", handleKey);
    };
  }, [closeIdentityMenu, identityMenuOpen]);

  const handleIdentityTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" && !identityMenuOpen) {
      event.preventDefault();
      lastTriggerRef.current = identityButtonRef.current;
      setIdentityMenuOpen(true);
    }
  };

  useEffect(() => {
    if (identityMenuOpen) {
      const firstItem = getMenuItems()[0];
      firstItem?.focus();
    } else if (wasOpenRef.current) {
      lastTriggerRef.current?.focus();
    }

    wasOpenRef.current = identityMenuOpen;
  }, [identityMenuOpen]);

  const handleIdentityMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = getMenuItems();
    if (items.length === 0) {
      return;
    }

    const activeIndex = items.findIndex((item) => item === document.activeElement);
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        const nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % items.length;
        items[nextIndex]?.focus();
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        const nextIndex = activeIndex < 0 ? items.length - 1 : (activeIndex - 1 + items.length) % items.length;
        items[nextIndex]?.focus();
        break;
      }
      case "Home": {
        event.preventDefault();
        items[0]?.focus();
        break;
      }
      case "End": {
        event.preventDefault();
        items[items.length - 1]?.focus();
        break;
      }
      case "Tab":
      case "Escape": {
        event.preventDefault();
        closeIdentityMenu();
        break;
      }
      default:
        break;
    }
  };

  const copyLabel = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      soundManager.beep("success", 100);
    } catch {
      // Ignore clipboard failures in restricted contexts.
    }
  };

  const handleGearClick = () => {
    soundManager.beep("warning", 150);
    setSettingsModalOpen(true);
  };

  const handleSignIn = () => {
    soundManager.playErrorSound();
    onSignIn();
  };

  return (
    <div ref={rootRef} className="activity-global-corner" aria-label="Global account controls">
      <div className="activity-global-corner__pill">
        <button
          ref={identityButtonRef}
          className="activity-global-corner__identity"
          type="button"
          onClick={toggleIdentityMenu}
          aria-haspopup="menu"
          aria-expanded={identityMenuOpen}
          aria-controls="global-identity-menu"
          onKeyDown={handleIdentityTriggerKeyDown}
          title="Open account menu"
        >
          <span className="activity-global-corner__icon" aria-hidden="true">◌</span>
          <span className="activity-global-corner__copy">
            <strong>{username}</strong>
            <small>{mmr === null ? "Guest" : `MMR: ${mmr}`}</small>
          </span>
        </button>
        <button
          ref={gearButtonRef}
          className="activity-global-corner__gear"
          type="button"
          onClick={handleGearClick}
          aria-label="Open settings"
          title="Open settings"
        >
          {menuIcon("settings")}
        </button>
      </div>

      {identityMenuOpen ? (
        <div
          ref={identityMenuRef}
          id="global-identity-menu"
          className="activity-global-corner__menu"
          role="menu"
          aria-label="Account menu"
          aria-orientation="vertical"
          onKeyDown={handleIdentityMenuKeyDown}
        >
          <div className="activity-global-corner__status" role="presentation">
            <ConnectionStatus isOnline={isOnline} socketState={socketState} />
          </div>
          <button
            className="activity-global-corner__item"
            type="button"
            onClick={() => {
              void copyLabel(username);
              closeIdentityMenu();
            }}
            role="menuitem"
          >
            Copy username
          </button>
          {canJumpToLobby ? (
            <button
              className="activity-global-corner__item"
              type="button"
              onClick={() => {
                onJumpToLobby();
                closeIdentityMenu();
              }}
              role="menuitem"
            >
              Return to lobby
            </button>
          ) : null}
          {canLogout ? (
            <button
              className="activity-global-corner__item"
              type="button"
              onClick={() => {
                void onRefresh();
                closeIdentityMenu();
              }}
              disabled={busy}
              role="menuitem"
            >
              {busy ? "Refreshing..." : "Refresh profile"}
            </button>
          ) : null}
          <button
            className="activity-global-corner__item activity-global-corner__item--danger"
            type="button"
            onClick={() => {
              if (canLogout) {
                void onLogout();
              } else {
                handleSignIn();
              }
              closeIdentityMenu();
            }}
            disabled={busy}
            role="menuitem"
          >
            {canLogout ? (busy ? "Signing out..." : "Log out") : "Sign in"}
          </button>
        </div>
      ) : null}

      <SettingsModal
        isOpen={settingsModalOpen}
        currentSettings={currentSettings}
        onClose={() => setSettingsModalOpen(false)}
        onSave={onSettingsSave || (async () => {})}
      />
    </div>
  );
}
