import { useState, useEffect, useCallback, useRef } from "react";
import { soundManager } from "../utils/soundManager.ts";
import type { PazaakUserSettings } from "../types.ts";

interface SettingsModalProps {
  isOpen: boolean;
  currentSettings: PazaakUserSettings;
  onClose: () => void;
  onSave: (settings: PazaakUserSettings) => Promise<void>;
}

export function SettingsModal({ isOpen, currentSettings, onClose, onSave }: SettingsModalProps) {
  const [settings, setSettings] = useState<PazaakUserSettings>(currentSettings);
  const [isSaving, setIsSaving] = useState(false);
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSettings(currentSettings);
  }, [currentSettings]);

  // Escape to close + focus trap
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const modal = modalRef.current;
      if (!modal) return;

      const focusable = Array.from(
        modal.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex=\"-1\"])"
        )
      );
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (!active || active === first || !modal.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !modal.contains(active ?? document.body)) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    // Auto-focus first focusable element when modal opens
    requestAnimationFrame(() => {
      const modal = modalRef.current;
      if (!modal) return;
      const first = modal.querySelector<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled])"
      );
      first?.focus();
    });

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Lock body scroll while open
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await onSave(settings);
      soundManager.beep("success", 150);
      onClose();
    } catch (error) {
      soundManager.playErrorSound();
      console.error("Failed to save settings:", error);
    } finally {
      setIsSaving(false);
    }
  }, [settings, onSave, onClose]);

  if (!isOpen) return null;

  return (
    <div className="settings-modal-overlay" onClick={onClose} role="presentation">
      <div
        ref={modalRef}
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-modal-header">
          <h2 id="settings-modal-title">Settings</h2>
          <button
            className="settings-modal-close"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className="settings-modal-content">
          {/* Theme Selection */}
          <div className="settings-group">
            <label htmlFor="theme-select">Theme</label>
            <select
              id="theme-select"
              value={settings.theme}
              onChange={(e) => setSettings({ ...settings, theme: e.target.value as any })}
            >
              <option value="kotor">KOTOR Classic</option>
              <option value="dark">Dark Mode</option>
              <option value="light">Light Mode</option>
            </select>
          </div>

          {/* Sound Settings */}
          <div className="settings-group">
            <label>
              <input
                type="checkbox"
                checked={settings.soundEnabled}
                onChange={(e) => {
                  setSettings({ ...settings, soundEnabled: e.target.checked });
                  soundManager.setEnabled(e.target.checked);
                }}
              />
              Enable Sound Effects
            </label>
          </div>

          {/* Reduced Motion */}
          <div className="settings-group">
            <label>
              <input
                type="checkbox"
                checked={settings.reducedMotionEnabled}
                onChange={(e) => setSettings({ ...settings, reducedMotionEnabled: e.target.checked })}
              />
              Reduced Motion (accessibility)
            </label>
          </div>

          {/* Turn Timer */}
          <div className="settings-group">
            <label htmlFor="timer-select">Turn Timer (seconds)</label>
            <select
              id="timer-select"
              value={settings.turnTimerSeconds}
              onChange={(e) => setSettings({ ...settings, turnTimerSeconds: parseInt(e.target.value) })}
            >
              <option value="30">30 seconds</option>
              <option value="45">45 seconds</option>
              <option value="60">60 seconds</option>
              <option value="90">90 seconds</option>
              <option value="120">120 seconds</option>
            </select>
          </div>

          {/* AI Difficulty */}
          <div className="settings-group">
            <label htmlFor="ai-difficulty-select">Default AI Difficulty</label>
            <select
              id="ai-difficulty-select"
              value={settings.preferredAiDifficulty}
              onChange={(e) => setSettings({ ...settings, preferredAiDifficulty: e.target.value as any })}
            >
              <option value="easy">Easy</option>
              <option value="hard">Hard</option>
              <option value="professional">Professional</option>
            </select>
          </div>

          {/* Info Section */}
          <div className="settings-info">
            <h3>About</h3>
            <p>Pazaak Activity v0.1</p>
            <p>The legendary card game from Knights of the Old Republic</p>
          </div>
        </div>

        <div className="settings-modal-footer">
          <button
            className="settings-modal-cancel"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            className="settings-modal-save"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
}
