import { useState } from "react";

interface AvatarProps {
  initials: string;
  size?: number;
  bg?: string;
  /** Photo URL. The initials show while it is null and again if it fails to load. */
  src?: string | null;
}

export default function Avatar({
  initials,
  size = 28,
  bg = "linear-gradient(140deg, var(--brand), var(--brand-deep))",
  src = null,
}: AvatarProps) {
  // Remember which URL failed, not just "failed": a re-upload bumps the version in the URL,
  // and that new URL deserves a fresh attempt.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showPhoto = !!src && src !== failedSrc;
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.24),
        background: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * 0.42),
        fontWeight: 700,
        color: "#fff",
        flex: "none",
        overflow: "hidden",
      }}
    >
      {showPhoto ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(src)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        initials
      )}
    </span>
  );
}
