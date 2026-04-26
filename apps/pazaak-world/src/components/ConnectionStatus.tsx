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
  const [hadRecentFailure, setHadRecentFailure] = useState(false);

  useEffect(() => {
    if (!isOnline) {
      setPing(null);
      setHadRecentFailure(false);
      return;
    }

    let cancelled = false;
    let pongTimer = 0;

    const measurePing = async () => {
      if (document.visibilityState === "hidden") {
        if (!cancelled) {
          pongTimer = window.setTimeout(measurePing, 5000);
        }
        return;
      }

      const startTime = performance.now();

      try {
        const response = await fetch(`/api/ping?ts=${Date.now()}`, {
          method: "GET",
          cache: "no-store",
        });

        if (!cancelled && response.ok) {
          const endTime = performance.now();
          const latency = Math.round(endTime - startTime);
          setPing(latency);
          setHadRecentFailure(false);
        } else if (!cancelled) {
          setPing(null);
          setHadRecentFailure(true);
        }
      } catch {
        // Network error, ping remains unknown
        if (!cancelled) {
          setPing(null);
          setHadRecentFailure(true);
        }
      }

      if (!cancelled) {
        pongTimer = window.setTimeout(measurePing, hadRecentFailure ? 5000 : 3000);
      }
    };

    measurePing();

    return () => {
      cancelled = true;
      clearTimeout(pongTimer);
    };
  }, [hadRecentFailure, isOnline]);

  // Determine status color and icon
  let statusColor = "var(--text-dim)";
  let statusLabel = "Unknown";

  const canShowLatency = ping !== null && isOnline;

  if (!isOnline) {
    statusColor = "var(--danger)";
    statusLabel = "Offline";
  } else if (canShowLatency) {
    if (ping < 100) {
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
  } else if (socketState === "reconnecting") {
    statusColor = "var(--warn)";
    statusLabel = "Reconnecting...";
  } else if (socketState === "connected") {
    statusColor = "var(--success)";
    statusLabel = "Connected";
  } else {
    statusColor = "var(--warn)";
    statusLabel = "Online";
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
            (socketState === "connecting" || socketState === "reconnecting") && ping === null
              ? "pulse 1s infinite"
              : "none",
        }}
        aria-hidden="true"
      />
      <span className="connection-status-label">{statusLabel}</span>
    </div>
  );
}
