import { useEffect, useRef, useState } from "react";

interface AnimatedTextProps {
  text: string;
  className?: string;
  style?: React.CSSProperties;
  animationType?: "glitch" | "jailbars" | "scan" | "none";
  children?: React.ReactNode;
}

/**
 * Renders text with animated effects (glitch, jailbars, scan lines, etc.)
 */
export function AnimatedText({
  text,
  className = "",
  style = {},
  animationType = "jailbars",
  children,
}: AnimatedTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [displayText, setDisplayText] = useState(text);

  useEffect(() => {
    setDisplayText(text);
  }, [text]);

  const combinedClassName = `animated-text ${className}`;
  const combinedStyle: React.CSSProperties = {
    ...style,
    position: "relative",
    display: "inline-block",
  };

  if (animationType === "none") {
    return (
      <div ref={containerRef} className={combinedClassName} style={combinedStyle}>
        {children ?? displayText}
      </div>
    );
  }

  if (animationType === "jailbars") {
    return (
      <div
        ref={containerRef}
        className={`${combinedClassName} animated-text--jailbars`}
        style={combinedStyle}
      >
        {children ?? displayText}
        <svg
          className="jailbars-overlay"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
          aria-hidden="true"
        >
          <defs>
            <pattern id="jailbars" x="2" y="0" width="4" height="100%">
              <line x1="0" y1="0" x2="0" y2="100%" stroke="rgba(0,0,0,0.2)" strokeWidth="2" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#jailbars)" />
        </svg>
      </div>
    );
  }

  if (animationType === "glitch") {
    return (
      <div ref={containerRef} className={`${combinedClassName} animated-text--glitch`} style={combinedStyle}>
        <span className="glitch-main">{children ?? displayText}</span>
        <span className="glitch-clone" aria-hidden="true">
          {children ?? displayText}
        </span>
        <span className="glitch-clone" aria-hidden="true">
          {children ?? displayText}
        </span>
      </div>
    );
  }

  if (animationType === "scan") {
    return (
      <div
        ref={containerRef}
        className={`${combinedClassName} animated-text--scan`}
        style={combinedStyle}
      >
        {children ?? displayText}
        <div
          className="scan-overlay"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            animation: "scanlines 8s linear infinite",
            background:
              "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)",
          }}
          aria-hidden="true"
        />
      </div>
    );
  }

  return (
    <div ref={containerRef} className={combinedClassName} style={combinedStyle}>
      {children ?? displayText}
    </div>
  );
}
