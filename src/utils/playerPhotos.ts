// Where a player's photo comes from. cdn.nba.com has real headshots for roughly every
// player since 2000 but answers a missing id with its own grey silhouette (never a 404),
// so `onError` can't detect a missing photo. scripts/player-photos/build.mjs records the
// exceptions in /photos/player-photos.json: players served from Wikimedia Commons instead,
// and players with no photo anywhere (they get the app's silhouette). An id the map doesn't
// mention uses cdn.nba.com.
import { useEffect, useState } from "react";

interface PhotoMap {
  /** person_id -> ["a/ab/File_name.jpg", original width in px, face x %, face y %] (face optional) */
  commons: Record<string, [string, number] | [string, number, number, number]>;
  /** person_ids with no photo on either source */
  none: number[];
}

/** "sm" for avatar-sized slots (<= ~60px), "lg" for cards and reveals. */
export type PhotoSize = "sm" | "lg";

export interface PhotoSource {
  src: string;
  /** Commons photos are arbitrary crops, so they get a shared fit rule (PlayerPhoto.css). */
  source: "nba" | "commons";
  /** CSS object-position that keeps the face in frame, when the photo's face position is known. */
  focus?: string;
}

const NBA_SIZE: Record<PhotoSize, string> = { sm: "260x190", lg: "1040x760" };
// Commons' standard thumbnail widths (other widths are throttled).
const COMMONS_WIDTH: Record<PhotoSize, number> = { sm: 120, lg: 500 };

let map: PhotoMap | null = null;
let none: Set<number> | null = null;
let mapPromise: Promise<void> | null = null;

/** Fetch the map once per session. A failed fetch means "everything from cdn.nba.com". */
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

function commonsUrl([path, width]: PhotoMap["commons"][string], size: PhotoSize): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const dir = path.slice(0, path.lastIndexOf("/"));
  const base = "https://upload.wikimedia.org/wikipedia/commons";
  const w = COMMONS_WIDTH[size];
  const name = encodeURIComponent(file);
  // Commons can't upscale: a file narrower than the bucket is served as the original.
  return width <= w ? `${base}/${dir}/${name}` : `${base}/thumb/${dir}/${name}/${w}px-${name}`;
}

/** The photo to show, or null for "no photo, use the silhouette". Call after loadPhotoMap. */
export function photoSource(personId: number, size: PhotoSize): PhotoSource | null {
  if (none?.has(personId)) return null;
  const c = map?.commons[String(personId)];
  if (c) return { src: commonsUrl(c, size), source: "commons", focus: c.length === 4 ? `${c[2]}% ${c[3]}%` : undefined };
  return { src: `https://cdn.nba.com/headshots/nba/latest/${NBA_SIZE[size]}/${personId}.png`, source: "nba" };
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
export function usePhotoSource(personId: number | null | undefined, size: PhotoSize): PhotoSource | null | undefined {
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
  return ready && personId !== undefined ? photoSource(personId, size) : undefined;
}
