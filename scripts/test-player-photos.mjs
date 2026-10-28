// Node test for src/utils/playerPhotos.ts photoSource (which photo a player gets):
//   npm run test:player-photos      (node --experimental-strip-types; Node >= 22.6)
import { test } from "node:test";
import assert from "node:assert/strict";

const map = { generated: "2026-10-26", nba: [2544], commons: { "2": ["6/65/Byron_Scott_(cropped).jpg", 842, 1311, 49.4, 16.1, 18.1, 16.8] }, none: [26] };

test("NBA entry, Commons entry, none entry, and an id the map does not know", async () => {
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
  assert.equal(photoSource(2544).source, "nba");
  assert.equal(photoSource(26), null);
  assert.equal(photoSource(999999), null); // not in the map: the silhouette, never a guessed cdn.nba.com URL
});

test("every photo is framed like an NBA headshot: same face size and position in a headshot-shaped window", async () => {
  const { loadPhotoMap, photoSource, placePhoto, nbaUrl } = await import("../src/utils/playerPhotos.ts");
  await loadPhotoMap();
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} vs ${b}`);
  const nba = photoSource(2544);
  // A frame of the headshot's own shape shows the headshot whole.
  const own = placePhoto(130, 95, nba.aspect, nba.face, "card");
  near(own.win.w, 130); near(own.w, 130); near(own.x, 0); near(own.y, 0);
  // A wide strip shows a centred window of that shape, full height.
  const strip = placePhoto(540, 158, nba.aspect, nba.face, "strip");
  near(strip.win.w, 158 / nba.aspect); near(strip.win.x, (540 - 158 / nba.aspect) / 2); near(strip.h, 158);
  // A Commons photo gets its face where the headshot has it: same height, centred, same height down.
  const c = photoSource(2);
  for (const [W, H, frame] of [[540, 158, "strip"], [126, 91.5, "card"], [42, 42, "avatar"]]) {
    const p = placePhoto(W, H, c.aspect, c.face, frame);
    const n = placePhoto(W, H, nba.aspect, nba.face, frame);
    near((c.face.fh * p.h) / H, (nba.face.fh * n.h) / H);
    near(p.x + c.face.cx * p.w, p.win.w / 2);
    near(p.y + c.face.cy * p.h, n.y + nba.face.cy * n.h);
  }
  assert.match(nbaUrl(2544, 200), /\/260x190\/2544\.png$/);
  assert.match(nbaUrl(2544, 400), /\/1040x760\/2544\.png$/);
});

test("the photo pipeline covers the live pool: curated rows with a team stint", async () => {
  const { playablePlayers, PLAYERS_SOURCE } = await import("./player-photos/players.mjs");
  const rows = [
    { person_id: 1, full_name: "Has Stints", teams: [{ abbr: "BOS" }] },
    { person_id: 2, full_name: "2026 Draftee", teams: [] },
    { person_id: 3, full_name: "No Teams Key" },
  ];
  assert.deepEqual(playablePlayers(rows).map((p) => p.person_id), [1]);
  // The data refresh commits players_curated.json (data-refresh.yml); players-index.json is not refreshed.
  assert.match(PLAYERS_SOURCE.replace(/\\/g, "/"), /backend\/trivia\/data_static\/players_curated\.json$/);
});

test("credits: author once, the licence's required attribution, the source when the author is unknown", async () => {
  const { creditFields } = await import("./player-photos/credit.mjs");
  const v = (value) => ({ value });
  // Commons repeats "Unknown author" in a hidden span; public domain needs no more.
  assert.deepEqual(creditFields({ Artist: v('Unknown author<span style="display: none;">Unknown author</span>'), AttributionRequired: v("false") }), { artist: "Unknown author" });
  // CC BY with no named author: credit the source Commons gives.
  assert.deepEqual(
    creditFields({
      Artist: v('Unknown author<span style="display: none;">Unknown author</span>'),
      Credit: v('<a rel="nofollow" class="external free" href="http://www.pallacanestrovarese.it/squadra/roster/">http://www.pallacanestrovarese.it/squadra/roster/</a>'),
      AttributionRequired: v("true"),
    }),
    { artist: "Unknown author", source: "http://www.pallacanestrovarese.it/squadra/roster/" },
  );
  // A licence that names the attribution to use ("Attribution", CC BY with an attribution line).
  assert.deepEqual(
    creditFields({
      Artist: v("臺北市政府"),
      Attribution: v('<a href="https://www.wikidata.org/wiki/Q19853359" class="extiw" title="d:Q19853359">Department of Sports, Taipei City Government</a>'),
    }),
    { artist: "臺北市政府", attribution: "Department of Sports, Taipei City Government" },
  );
  assert.deepEqual(creditFields({ Artist: v("<a href='//commons.wikimedia.org/wiki/User:Keith'>Keith Allison</a> &amp; friends") }), { artist: "Keith Allison & friends" });
  // An author Commons states only in the page text (no infobox), set by hand in credit-overrides.json.
  assert.deepEqual(creditFields({ AttributionRequired: v("true") }, { artist: "Massimo Finizio" }), { artist: "Massimo Finizio" });
});

test("a failed map fetch puts everyone on the silhouette", async () => {
  globalThis.fetch = async () => { throw new Error("offline"); };
  const { loadPhotoMap, photoSource } = await import("../src/utils/playerPhotos.ts?offline");
  await loadPhotoMap();
  assert.equal(photoSource(2), null);
});
