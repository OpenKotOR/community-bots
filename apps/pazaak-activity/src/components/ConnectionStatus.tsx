import { useEffect, useState } from "react";

interface ConnectionStatusProps {
  isOnline: boolean;
  socketState?: "connecting" | "connected" | "disconnected" | "reconnecting";
}

/**
 * Monitors connection status and calculates real-time ping
 */
export function ConnectionStatus({ isOnline, socketState = "connecting" }: ConnectionStatusProps) {
  const [ping, setPing] = useState<number | null>(null);
  const [lastUpdate, setLastUpdate] = useState(Date.now());

  useEffect(() => {
    if (!isOnline) {
      setPing(null);
      return;
    }

    let cancelled = false;
    let pongTimer: number;

    const measurePing = async () => {
      const startTime = performance.now();

      try {
        const response = await fetch("/api/ping", {
          method: "HEAD",
          cache: "no-store",
        });

        if (!cancelled && response.ok) {
          const endTime = performance.now();
          const latency = Math.round(endTime - startTime);
          setPing(latency);
          setLastUpdate(Date.now());
        }
      } catch {
        // Network error, ping remains unknown
        if (!cancelled) {
          setPing(null);
        }
      }

      if (!cancelled) {
        pongTimer = window.setTimeout(measurePing, 3000); // Measure every 3 seconds
      }
    };

    measurePing();

    return () => {
      cancelled = true;
      clearTimeout(pongTimer);
    };
  }, [isOnline]);

  // Determine status color and icon
  let statusColor = "var(--text-dim)";
  let statusLabel = "Unknown";

  if (!isOnline) {
    statusColor = "var(--danger)";
    statusLabel = "Offline";
  } else if (socketState === "connected" || socketState === "reconnecting") {
    if (ping === null) {
      statusColor = "var(--warn)";
      statusLabel = "Connected";
    } else if (ping < 100) {
      statusColor = "var(--success)";
      statusLabel = `${ping}ms`;
    } else if (ping < 300) {
      statusColor = "var(--warn)";
      statusLabel = `${ping}ms`;
    } else {
      statusColor = "var(--danger)";
      statusLabel = `${ping}ms`;
    }
  } else if (socketState === "connecting") {
    statusColor = "var(--warn)";
    statusLabel = "Connecting...";
  } else {
    statusColor = "var(--danger)";
    statusLabel = "Disconnected";
  }

  return (
    <div
      className="connection-status"
      title={`Connection: ${statusLabel}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "12px",
        color: statusColor,
      }}
    >
      <span
        className="connection-status-dot"
        style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          backgroundColor: statusColor,
          animation:
            socketState === "connecting"
              ? "pulse 1s infinite"
              : "none",
        }}
        aria-hidden="true"
      />
      <span className="connection-status-label">{statusLabel}</span>
    </div>
  );
}
