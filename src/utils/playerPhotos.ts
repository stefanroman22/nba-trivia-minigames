// Where a player's photo comes from: the official NBA headshot (cdn.nba.com) when the NBA has
// one, else Wikimedia Commons (free licences, credited on /credits), else the app's silhouette.
// scripts/player-photos/build.mjs lists every player in /photos/player-photos.json: in `nba`,
// as a Commons file (with its face box) or in `none`. An id the map doesn't mention gets the
// silhouette too; `npm run check:photos` makes sure there is none.
import { useEffect, useState } from "react";

/** A Commons entry: ["a/ab/File_name.jpg", original width, original height, then optionally the
 *  face centre x, y and (when the detector measured it) the face box width, height — all in % of
 *  the image]. Written by scripts/player-photos/build.mjs from faces.json. */
type CommonsEntry =
  | [string, number, number]
  | [string, number, number, number, number]
  | [string, number, number, number, number, number, number];

interface PhotoMap {
  /** person_ids with an official NBA headshot */
  nba: number[];
  commons: Record<string, CommonsEntry>;
  /** person_ids with no usable photo (the silhouette) */
  none: number[];
}

/** How small the game's frame is (see placePhoto): an `avatar` (circle or tiny square) may zoom a
 *  Commons photo further; a `card` or a wide `strip` show the photo in a headshot-shaped window. */
export type PhotoFrame = "avatar" | "card" | "strip";

/** Face in a photo, as fractions of the image (cx, cy = centre; fw, fh = box size). */
export interface PhotoFace {
  cx: number;
  cy: number;
  fw?: number;
  fh?: number;
}

export type PhotoSource =
  | { source: "nba"; personId: number; aspect: number; face: PhotoFace }
  | { source: "commons"; path: string; width: number; aspect: number; face?: PhotoFace };

/** The NBA headshot template (1040 x 760, every era the same): its face box (brows to chin), the
 *  median of 1,701 headshots. Every photo is framed like it (see placePhoto). */
const NBA_ASPECT = 760 / 1040;
const NBA_FACE: PhotoFace = { cx: 0.4962, cy: 0.3708, fw: 0.261, fh: 0.4838 };

// Commons' standard thumbnail widths (other widths are throttled), smallest first.
const COMMONS_BUCKETS = [120, 250, 330, 500, 960, 1280];

let map: PhotoMap | null = null;
let nba: Set<number> | null = null;
let none: Set<number> | null = null;
let mapPromise: Promise<void> | null = null;

/** Fetch the map once per session. A failed fetch means "everyone on the silhouette". */
export function loadPhotoMap(): Promise<void> {
  if (!mapPromise) {
    mapPromise = fetch("/photos/player-photos.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((m: PhotoMap) => {
        map = m;
        nba = new Set(m.nba ?? []);
        none = new Set(m.none);
      })
      .catch(() => {
        map = { nba: [], commons: {}, none: [] };
        nba = new Set();
        none = new Set();
      });
  }
  return mapPromise;
}

/** The NBA headshot at 260px when that covers `needPx` device pixels, else at 1040px. */
export function nbaUrl(personId: number, needPx: number): string {
  const size = needPx <= 260 ? "260x190" : "1040x760";
  return `https://cdn.nba.com/headshots/nba/latest/${size}/${personId}.png`;
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

/** Never zoom past this multiple of a plain cover fit (the photo gets soft and loses context);
 *  avatars go further because a 32–44px circle needs the face to fill it. */
const MAX_ZOOM: Record<PhotoFrame, number> = { avatar: 4.5, card: 3, strip: 3 };

/**
 * Where to draw a photo inside a W x H frame (css px). Every photo is framed like an NBA headshot,
 * so every player looks the same in every game: the frame shows a window of the headshot's shape
 * (the whole frame when the frame is narrower; full height and centred when it is wider), and the
 * photo is drawn so its face box is NBA_FACE.fh of the window's height, centred across, its centre
 * NBA_FACE.cy down. An NBA headshot lands exactly on its own template. A Commons photo is zoomed to
 * that (up to MAX_ZOOM x a plain cover) and clamped to cover the window; a close-up whose head is
 * taller than the window even at a plain cover is drawn smaller, with bars at the sides rather than
 * a cut face. Without a face: cover, top-biased (5%).
 * Returns the window (x, w in the frame) and the photo's size and offset inside the window.
 * scripts/player-photos/check_fit.py reproduces this exactly; change both together.
 */
export function placePhoto(W: number, H: number, aspect: number, face: PhotoFace | undefined, frame: PhotoFrame) {
  const ww = Math.min(W, H / NBA_ASPECT);
  const win = { x: (W - ww) / 2, w: ww };
  const cover = Math.max(ww, H / aspect);
  let w = cover;
  if (face?.fh && face.fw) {
    const want = (NBA_FACE.fh! * H) / (face.fh * aspect);
    const headFits = Math.min((0.92 * H) / (face.fh * 1.5 * aspect), (0.95 * ww) / (face.fw * 1.24));
    const least = headFits >= cover ? cover : Math.max(headFits, Math.min(ww, H / aspect));
    w = clamp(Math.min(want, headFits), least, cover * MAX_ZOOM[frame]);
  }
  const h = w * aspect;
  let x = (ww - w) / 2;
  let y = -(h - H) * 0.05;
  if (face) {
    x = ww / 2 - face.cx * w;
    y = H * NBA_FACE.cy - face.cy * h;
  }
  // Keep the photo over the whole window (or, when it is smaller, inside it).
  return { win, w, h, x: clamp(x, Math.min(0, ww - w), Math.max(0, ww - w)), y: clamp(y, Math.min(0, H - h), Math.max(0, H - h)) };
}

/** The photo to show, or null for "no photo, use the silhouette". Call after loadPhotoMap. */
export function photoSource(personId: number): PhotoSource | null {
  if (nba?.has(personId)) return { source: "nba", personId, aspect: NBA_ASPECT, face: NBA_FACE };
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
