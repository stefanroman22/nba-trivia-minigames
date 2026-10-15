import { useEffect, useId, useState, type CSSProperties } from "react";
import { usePhotoSource, type PhotoSize } from "../../utils/playerPhotos";
import "../../styles/PlayerPhoto.css";

/** The one "no photo" figure every game shows: an orange player silhouette. */
export function PlayerSilhouette({ className }: { className?: string }) {
  const gid = useId();
  return (
    <svg viewBox="0 0 64 72" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--brand)" />
          <stop offset="1" stopColor="var(--brand-deep)" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="26" r="13" fill={`url(#${gid})`} />
      <path d="M8 72 C8 54 22 47 32 47 C42 47 56 54 56 72 Z" fill={`url(#${gid})`} />
    </svg>
  );
}

interface PlayerPhotoProps {
  /** null when the player isn't known (an unresolved name): the silhouette.
   *  undefined while it is still being resolved: an invisible placeholder. */
  personId: number | null | undefined;
  alt: string;
  size?: PhotoSize;
  /** Class of the <img>; the game's own frame/fit rules key off it. */
  className?: string;
  /** Class of the silhouette shown when there is no photo. */
  fallbackClassName?: string;
  style?: CSSProperties;
}

/**
 * A player's photo: cdn.nba.com, else Wikimedia Commons, else the silhouette — the same
 * order and the same fallback in every game (see utils/playerPhotos). Commons photos are
 * marked data-source="commons" so PlayerPhoto.css can crop them to the face.
 */
export default function PlayerPhoto({
  personId,
  alt,
  size = "lg",
  className,
  fallbackClassName,
  style,
}: PlayerPhotoProps) {
  const photo = usePhotoSource(personId, size);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  useEffect(() => setFailedSrc(null), [personId]);

  // Map still loading: hold the slot with an invisible silhouette, so the frame keeps its size.
  if (photo === undefined) {
    return <PlayerSilhouette className={`${fallbackClassName ?? ""} player-photo-pending`} />;
  }
  if (!photo || photo.src === failedSrc) return <PlayerSilhouette className={fallbackClassName} />;
  return (
    <img
      className={className}
      src={photo.src}
      alt={alt}
      data-source={photo.source}
      style={style}
      decoding="async"
      draggable={false}
      onError={() => setFailedSrc(photo.src)}
    />
  );
}
