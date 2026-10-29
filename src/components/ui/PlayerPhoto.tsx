import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { commonsUrl, nbaUrl, placePhoto, usePhotoSource, type PhotoFrame, type PhotoSource } from "../../utils/playerPhotos";
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
  /** How the frame crops the photo (utils/playerPhotos placePhoto). */
  frame?: PhotoFrame;
  /** Class of the frame <span> around the photo. The game's frame size / radius / filter rules
   *  key off it. */
  className?: string;
  /** Class of the silhouette shown when there is no photo. */
  fallbackClassName?: string;
  style?: CSSProperties;
}

/**
 * A player's photo: the NBA headshot, else Wikimedia Commons, else the silhouette — the same
 * order, framing and fallback in every game (see utils/playerPhotos).
 */
export default function PlayerPhoto({
  personId,
  alt,
  frame = "card",
  className,
  fallbackClassName,
  style,
}: PlayerPhotoProps) {
  const photo = usePhotoSource(personId);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [personId]);

  // Map still loading: hold the slot with an invisible silhouette, so the frame keeps its size.
  if (photo === undefined) {
    return <PlayerSilhouette className={`${fallbackClassName ?? ""} player-photo-pending`} />;
  }
  if (!photo || failed) return <PlayerSilhouette className={fallbackClassName} />;
  return <FramedPhoto photo={photo} alt={alt} frame={frame} className={className} style={style} onFail={() => setFailed(true)} />;
}

/**
 * A photo inside a frame <span> that takes the game's class: the span is measured, and the photo
 * is drawn in the headshot-shaped window, at the size and offset placePhoto picks for that exact
 * frame (the face where an NBA headshot has it). The file width follows the drawn size, so it
 * stays sharp without downloading more than needed. Measured in a layout effect, before paint: no
 * jump.
 */
function FramedPhoto({
  photo,
  alt,
  frame,
  className,
  style,
  onFail,
}: {
  photo: PhotoSource;
  alt: string;
  frame: PhotoFrame;
  className?: string;
  style?: CSSProperties;
  onFail: () => void;
}) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  // The widest file asked for so far: a resize never swaps to a smaller (already-loaded) file.
  const needRef = useRef(0);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    // clientWidth/Height: the layout size inside the border, unaffected by transform animations.
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setBox((b) => (b && b.w === w && b.h === h ? b : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  let img = null;
  if (box) {
    const p = placePhoto(box.w, box.h, photo.aspect, photo.face, frame);
    const dpr = typeof window === "undefined" ? 2 : window.devicePixelRatio || 1;
    needRef.current = Math.max(needRef.current, Math.ceil(p.w * dpr));
    img = (
      <span className="player-photo-window" style={{ left: p.win.x, width: p.win.w }}>
        <img
          src={photo.source === "nba" ? nbaUrl(photo.personId, needRef.current) : commonsUrl(photo.path, photo.width, needRef.current)}
          alt={alt}
          decoding="async"
          draggable={false}
          onError={onFail}
          style={{ position: "absolute", left: p.x, top: p.y, width: p.w, height: p.h, maxWidth: "none", objectFit: "fill" }}
        />
      </span>
    );
  }
  return (
    <span ref={boxRef} className={`player-photo-frame ${className ?? ""}`} data-source={photo.source} style={style}>
      {img}
    </span>
  );
}
