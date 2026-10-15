// Shared helpers for the game-card pipeline (see README.md in this folder).
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DIR = path.join(ROOT, "scripts", "game-cards");
export const OUT = path.join(DIR, "out");
export const RAW = path.join(OUT, "raw");
export const CARDS = path.join(OUT, "cards");
export const BACKUP = path.join(OUT, "backup");
export const SOURCES = path.join(DIR, "sources");
export const CANDIDATES = path.join(SOURCES, "candidates");
export const ASSETS = path.join(ROOT, "src", "assets", "Games Backrounds");
/** The card every other card is matched to. */
export const STYLE_REF = path.join(ASSETS, "playoff_series.jpg");

// Output size matches the existing tile JPGs (the tile is 206px tall, object-fit: cover).
export const WIDTH = 800;
export const HEIGHT = 450;

export const BRAND = "#ff6a1a";

/**
 * Luminance -> brand colour ramp. Every finished card goes through this, so a photo, a
 * 3D render and a flat icon all land on the same charcoal-to-orange palette.
 *   0.00 near-black  ->  0.32 warm charcoal  ->  0.58 burnt orange-brown
 *   -> 0.82 brand orange  ->  1.00 warm highlight
 */
export const RAMP = [
  [0.0, "#0b0b0b"],
  [0.32, "#1a1411"],
  [0.58, "#6e2e0c"],
  [0.82, BRAND],
  [1.0, "#ffc9a3"],
];

const hexToRgb = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export function buildLut(ramp = RAMP) {
  const stops = ramp.map(([t, c]) => [t, hexToRgb(c)]);
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k];
    const [t1, c1] = stops[k + 1];
    const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(c0[c] + (c1[c] - c0[c]) * u);
  }
  return lut;
}

export async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function findFile(dir, base, exts = ["png", "jpg", "jpeg", "webp"]) {
  for (const e of exts) {
    const p = path.join(dir, `${base}.${e}`);
    if (await exists(p)) return p;
  }
  return null;
}

export function mimeOf(p) {
  const e = path.extname(p).toLowerCase();
  return e === ".png" ? "image/png" : e === ".webp" ? "image/webp" : "image/jpeg";
}

/** Minimal CLI flag parser: --a b --c --ids x,y  ->  { a: "b", c: true, ids: "x,y" } */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}

/** Loads KEY=value lines from .env.local (repo root) and scripts/game-cards/.env into process.env, never overriding. */
export async function loadEnv() {
  for (const file of [path.join(ROOT, ".env.local"), path.join(DIR, ".env")]) {
    if (!(await exists(file))) continue;
    const text = await fs.readFile(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

function overlaySvg(width, height, { glow, vignette, floor }) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <radialGradient id="g" cx="88%" cy="8%" r="62%">
      <stop offset="0" stop-color="${BRAND}" stop-opacity="${glow}"/>
      <stop offset="1" stop-color="${BRAND}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="v" cx="50%" cy="48%" r="72%">
      <stop offset="0.42" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="${vignette}"/>
    </radialGradient>
    <linearGradient id="f" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.52" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="${floor}"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect width="100%" height="100%" fill="url(#v)"/>
  <rect width="100%" height="100%" fill="url(#f)"/>
</svg>`);
}

function grainLayer(width, height, amount) {
  const n = width * height;
  const buf = Buffer.alloc(n * 4);
  const a = Math.round(255 * amount);
  for (let i = 0; i < n; i++) {
    const v = 128 + Math.round((Math.random() - 0.5) * 120);
    buf[i * 4] = v;
    buf[i * 4 + 1] = v;
    buf[i * 4 + 2] = v;
    buf[i * 4 + 3] = a;
  }
  return { input: buf, raw: { width, height, channels: 4 }, blend: "overlay" };
}

/**
 * Turns any input image into a finished card:
 *   cover-crop to 800x450 -> greyscale + normalise -> exposure (<1 darkens a bright source)
 *   -> brand gradient map
 *   -> optional blend of the original colour (mix) -> orange glow top-right
 *   -> vignette + darker bottom third (text sits there) -> film grain -> JPEG.
 */
export async function finishCard(inputPath, outPath, opts = {}) {
  const {
    width = WIDTH,
    height = HEIGHT,
    position = "attention",
    exposure = 1,
    ramp = true,
    mix = 0,
    glow = 0.32,
    vignette = 0.72,
    floor = 0.45,
    grain = 0.05,
    quality = 82,
  } = opts;

  const base = sharp(inputPath).rotate().resize(width, height, { fit: "cover", position });
  let rgb;
  if (ramp) {
    const { data, info } = await base.clone().greyscale().normalise().raw().toBuffer({ resolveWithObject: true });
    const lut = buildLut();
    rgb = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      const v = Math.min(255, Math.round(data[i * info.channels] * exposure));
      rgb[i * 3] = lut[v * 3];
      rgb[i * 3 + 1] = lut[v * 3 + 1];
      rgb[i * 3 + 2] = lut[v * 3 + 2];
    }
  } else {
    // Input is already on-brand (our own SVG renders): keep its colours, only add the finish.
    rgb = (await base.clone().removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true })).data;
  }

  const layers = [];
  if (mix > 0) {
    const orig = await base.clone().removeAlpha().ensureAlpha(mix).png().toBuffer();
    layers.push({ input: orig, blend: "over" });
  }
  layers.push({ input: overlaySvg(width, height, { glow, vignette, floor }), blend: "over" });
  if (grain > 0) layers.push(grainLayer(width, height, grain));

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await sharp(rgb, { raw: { width, height, channels: 3 } })
    .composite(layers)
    .jpeg({ quality, mozjpeg: true })
    .toFile(outPath);
  return outPath;
}
