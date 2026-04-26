import { useState } from "react";

interface PazaakAssetProps {
  src?: string;
  fallback?: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  size?: "sm" | "md" | "lg" | "xl";
  type?: "card" | "character" | "background" | "avatar" | "icon";
}

/**
 * PazaakAsset renders game assets with fallback support
 * Assets can be:
 * - Real images from CDN or local assets
 * - Generated via AI (placeholder URLs for now)
 * - Unicode/CSS-based fallbacks for instant display
 */
export function PazaakAsset({
  src,
  fallback = "◆",
  alt,
  className = "",
  style = {},
  size = "md",
  type = "icon",
}: PazaakAssetProps) {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  const shouldShowImage = src && !imageError;
  const sizePx: Record<string, number> = {
    sm: 32,
    md: 64,
    lg: 128,
    xl: 256,
  };
  const px = sizePx[size];

  const combinedClassName = `pazaak-asset pazaak-asset--${type} pazaak-asset--${size} ${className}`;
  const combinedStyle: React.CSSProperties = {
    ...style,
    width: px,
    height: px,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  };

  if (shouldShowImage && !imageError) {
    return (
      <div className={combinedClassName} style={combinedStyle}>
        <img
          src={src}
          alt={alt}
          onError={() => setImageError(true)}
          onLoad={() => setImageLoaded(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            borderRadius: "inherit",
            opacity: imageLoaded ? 1 : 0,
            transition: "opacity 0.3s ease-out",
          }}
        />
        {!imageLoaded && (
          <div
            style={{
              position: "absolute",
              fontSize: `${px * 0.5}px`,
              opacity: 0.3,
            }}
            aria-hidden="true"
          >
            {fallback}
          </div>
        )}
      </div>
    );
  }

  // Fallback: Unicode or CSS-based display
  return (
    <div
      className={combinedClassName}
      style={{
        ...combinedStyle,
        fontSize: `${px * 0.6}px`,
        color: "var(--accent)",
        backgroundColor: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
      }}
      title={alt}
    >
      {fallback}
    </div>
  );
}

/**
 * Generate an AI-powered image placeholder URL
 * In production, this would call an AI image generation API
 */
export function generateAiImageUrl(prompt: string, options?: { size?: string; seed?: number }): string {
  // Placeholder: in production, call OpenAI DALL-E, Replicate, or similar
  // For now, return a placeholder service URL
  const encodedPrompt = encodeURIComponent(prompt);
  const size = options?.size || "256x256";
  const seed = options?.seed || Math.floor(Math.random() * 10000);

  // Using DiceBear API as a free placeholder (will need to be replaced with actual AI service)
  return `https://api.dicebear.com/9.x/pixel-art/svg?seed=${seed}&scale=80&mood=content`;
}

/**
 * Card asset with KOTOR-themed styling
 */
export function CardAsset({ cardValue, variant }: { cardValue: number; variant?: "main" | "side" }) {
  return (
    <div
      className="card-asset"
      style={{
        width: "80px",
        height: "120px",
        backgroundColor: variant === "side" ? "var(--warn)" : "var(--accent)",
        border: "2px solid var(--text)",
        borderRadius: "var(--radius-lg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "32px",
        fontWeight: "bold",
        color: "#0c0906",
        textShadow: "1px 1px 2px rgba(255,255,255,0.3)",
        boxShadow: "0 4px 8px rgba(0,0,0,0.3)",
      }}
    >
      {cardValue > 0 ? `+${cardValue}` : cardValue}
    </div>
  );
}

/**
 * Character portrait with fallback
 */
export function CharacterPortrait({
  name,
  difficulty,
  src,
}: {
  name: string;
  difficulty: string;
  src?: string;
}) {
  const difficultyEmoji: Record<string, string> = {
    novice: "⭐",
    advanced: "⭐⭐",
    expert: "⭐⭐⭐",
    master: "⭐⭐⭐⭐",
    professional: "🏆",
  };

  return (
    <div className="character-portrait">
      <PazaakAsset
        src={src}
        fallback="◌"
        alt={name}
        type="character"
        size="lg"
        style={{
          borderRadius: "var(--radius-lg)",
          border: "2px solid var(--accent)",
        }}
      />
      <div className="character-info">
        <h4>{name}</h4>
        <p className="character-difficulty">{difficultyEmoji[difficulty] || "⭐"} {difficulty}</p>
      </div>
    </div>
  );
}
