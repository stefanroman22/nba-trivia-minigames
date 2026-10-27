// Where a player's photo comes from: Wikimedia Commons (free licences, credited on /credits),
// else the app's silhouette. scripts/player-photos/build.mjs lists every player in
// /photos/player-photos.json, as a Commons file (with its face box) or in `none`. An id the
// map doesn't mention gets the silhouette too; `npm run check:photos` makes sure there is none.
// No photo comes from the NBA CDN (its headshots are NBA property).
import { useEffect, useState } from "react";

/** A Commons entry: ["a/ab/File_name.jpg", original width, original height, then optionally the
 *  face centre x, y and (when the detector measured it) the face box width, height — all in % of
 *  the image]. Written by scripts/player-photos/build.mjs from faces.json. */
type CommonsEntry =
  | [string, number, number]
  | [string, number, number, number, number]
  | [string, number, number, number, number, number, number];

interface PhotoMap {
  commons: Record<string, CommonsEntry>;
  /** person_ids with no usable free photo (the silhouette) */
  none: number[];
}

/** How a frame crops a Commons photo (see placePhoto): a small `avatar` (circle or tiny square)
 *  zooms onto the face, a `card` keeps the head in view, a wide `strip` shows the whole photo. */
export type PhotoFrame = "avatar" | "card" | "strip";

/** Face in a Commons photo, as fractions of the image (cx, cy = centre; fw, fh = box size). */
export interface PhotoFace {
  cx: number;
  cy: number;
  fw?: number;
  fh?: number;
}

export type PhotoSource = { source: "commons"; path: string; width: number; aspect: number; face?: PhotoFace };

// Commons' standard thumbnail widths (other widths are throttled), smallest first.
const COMMONS_BUCKETS = [120, 250, 330, 500, 960, 1280];

let map: PhotoMap | null = null;
let none: Set<number> | null = null;
let mapPromise: Promise<void> | null = null;

/** Fetch the map once per session. A failed fetch means "everyone on the silhouette". */
export function loadPhotoMap(): Promise<void> {
  if (!mapPromise) {
    mapPromise = fetch("/photos/player-photos.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((m: PhotoMap) => {
        map = m;
        none = new Set(m.none);
      })
      .catch(() => {
        map = { commons: {}, none: [] };
        none = new Set();
      });
  }
  return mapPromise;
}

/** The Commons file at the smallest standard width that covers `needPx` device pixels. Commons
 *  can't upscale, so a file narrower than that bucket is served as the original. */
export function commonsUrl(path: string, width: number, needPx: number): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const dir = path.slice(0, path.lastIndexOf("/"));
  const base = "https://upload.wikimedia.org/wikipedia/commons";
  const name = encodeURIComponent(file);
  const w = COMMONS_BUCKETS.find((b) => b >= needPx) ?? COMMONS_BUCKETS[COMMONS_BUCKETS.length - 1];
  return width <= w ? `${base}/${dir}/${name}` : `${base}/thumb/${dir}/${name}/${w}px-${name}`;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Target face height as a share of the frame height, per frame kind. */
const FACE_SHARE: Record<PhotoFrame, number> = { avatar: 0.42, card: 0.3, strip: 0.42 };
/** A strip shows the whole photo unless that leaves it covering less than this share of the frame. */
const STRIP_MIN_COVERAGE = 0.55;
/** Never zoom past this multiple of a plain cover fit (the photo gets soft and loses context);
 *  avatars go further because a 32–44px circle needs the face to fill it. */
const MAX_ZOOM: Record<PhotoFrame, number> = { avatar: 4.5, card: 3, strip: 3 };

/**
 * Where to draw a Commons photo inside a W x H frame (css px): its drawn size and offset.
 * Cover the frame, zoom so the face reaches the frame's FACE_SHARE (but the whole head — crown
 * ~0.45 face-heights above the detector's box, chin just below it — still fits), centre the head,
 * then clamp so the photo covers the frame. A close-up whose head is taller than the frame even at
 * a plain cover is drawn smaller instead (down to the whole photo), with bars at the sides rather
 * than a cut face. Without a face: cover, top-biased (5%).
 * scripts/player-photos/check_fit.py reproduces this exactly; change both together.
 */
export function placePhoto(W: number, H: number, aspect: number, face: PhotoFace | undefined, frame: PhotoFrame) {
  if (frame === "strip") {
    const cw = Math.min(W, H / aspect);
    const ch = cw * aspect;
    if ((cw * ch) / (W * H) >= STRIP_MIN_COVERAGE || !face) return { w: cw, h: ch, x: (W - cw) / 2, y: (H - ch) / 2 };
  }
  const cover = Math.max(W, H / aspect);
  let w = cover;
  if (face?.fh && face.fw) {
    const want = (FACE_SHARE[frame] * H) / (face.fh * aspect);
    const headFits = Math.min((0.92 * H) / (face.fh * 1.5 * aspect), (0.95 * W) / (face.fw * 1.24));
    const least = headFits >= cover ? cover : Math.max(headFits, Math.min(W, H / aspect));
    w = clamp(Math.min(want, headFits), least, cover * MAX_ZOOM[frame]);
  }
  const h = w * aspect;
  let x = (W - w) / 2;
  let y = frame === "avatar" ? 0 : -(h - H) * 0.05;
  if (face) {
    x = W / 2 - face.cx * w;
    if (face.fh) {
      const headTop = (face.cy - 0.95 * face.fh) * h;
      const headBottom = (face.cy + 0.55 * face.fh) * h;
      y = H * (frame === "avatar" ? 0.5 : 0.47) - (headTop + headBottom) / 2;
    } else {
      y = H * 0.42 - face.cy * h;
    }
  }
  // Keep the photo over the whole frame (or, when it is smaller, inside it).
  return { w, h, x: clamp(x, Math.min(0, W - w), Math.max(0, W - w)), y: clamp(y, Math.min(0, H - h), Math.max(0, H - h)) };
}

/** The photo to show, or null for "no photo, use the silhouette". Call after loadPhotoMap. */
export function photoSource(personId: number): PhotoSource | null {
  if (none?.has(personId)) return null;
  const c = map?.commons[String(personId)];
  if (c) {
    const [path, width, height, cx, cy, fw, fh] = c;
    const face = cx == null || cy == null ? undefined : { cx: cx / 100, cy: cy / 100, fw: fw == null ? undefined : fw / 100, fh: fh == null ? undefined : fh / 100 };
    return { source: "commons", path, width, aspect: height / width, face };
  }
  return null;
}

let ids: Record<string, number> | null = null;
let idsPromise: Promise<void> | null = null;

/** Name -> person_id, for data that carries only names (Starting Five). Fetched on first use. */
function loadPlayerIds(): Promise<void> {
  if (!idsPromise) {
    idsPromise = fetch("/photos/player-ids.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((m: Record<string, number>) => {
        ids = m;
      })
      .catch(() => {
        ids = {};
      });
  }
  return idsPromise;
}

/** Warm both files for a game that shows photos by name, so a reveal never waits on them. */
export function preloadPhotosByName(): void {
  void loadPlayerIds();
  void loadPhotoMap();
}

/** person_id for a player name: undefined while loading, null if the name is unknown. */
export function usePersonIdByName(name: string | null | undefined): number | null | undefined {
  const [ready, setReady] = useState(ids !== null);
  useEffect(() => {
    if (ready) return;
    let live = true;
    void loadPlayerIds().then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [ready]);
  if (!name) return null;
  return ready ? (ids?.[name] ?? null) : undefined;
}

/** undefined while the map (or an undefined = still-resolving personId) loads; render nothing
 *  yet, so there is no silhouette -> photo swap. null personId = unknown player. */
export function usePhotoSource(personId: number | null | undefined): PhotoSource | null | undefined {
  const [ready, setReady] = useState(map !== null);
  useEffect(() => {
    if (ready) return;
    let live = true;
    void loadPhotoMap().then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [ready]);
  if (personId === null) return null;
  return ready && personId !== undefined ? photoSource(personId) : undefined;
}
