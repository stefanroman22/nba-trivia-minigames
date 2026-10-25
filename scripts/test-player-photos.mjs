// Node test for src/utils/playerPhotos.ts photoSource (which photo a player gets):
//   npm run test:player-photos      (node --experimental-strip-types; Node >= 22.6)
import { test } from "node:test";
import assert from "node:assert/strict";

const map = { generated: "2026-10-26", commons: { "2": ["6/65/Byron_Scott_(cropped).jpg", 842, 1311, 49.4, 16.1, 18.1, 16.8] }, none: [26] };

test("Commons entry, none entry, and an id the map does not know", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify(map));
  const { loadPhotoMap, photoSource } = await import("../src/utils/playerPhotos.ts");
  await loadPhotoMap();
  assert.deepEqual(photoSource(2), {
    source: "commons",
    path: "6/65/Byron_Scott_(cropped).jpg",
    width: 842,
    aspect: 1311 / 842,
    face: { cx: 49.4 / 100, cy: 16.1 / 100, fw: 18.1 / 100, fh: 16.8 / 100 },
  });
  assert.equal(photoSource(26), null);
  assert.equal(photoSource(999999), null); // not in the map: the silhouette, never a cdn.nba.com URL
});

test("a failed map fetch puts everyone on the silhouette", async () => {
  globalThis.fetch = async () => { throw new Error("offline"); };
  const { loadPhotoMap, photoSource } = await import("../src/utils/playerPhotos.ts?offline");
  await loadPhotoMap();
  assert.equal(photoSource(2), null);
});
