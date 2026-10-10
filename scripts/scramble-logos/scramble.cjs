// Text-free SVG -> scrambled 400px WebP: hue shift (or invert for black/white marks), mirror, rotation.
// Deterministic per team id. usage: node scramble.cjs <cleanSvgDir> <outDir> <originalSvgDir>
// The scrambled mark is sized to the original logo's footprint in a 400px box (geometric mean of the
// visible width and height, so wide and tall marks compare fairly), so the reveal cross-fade swaps
// logos of the same visual size.
const fs = require("fs"), path = require("path"), sharp = require("sharp");
const [src, out, orig] = process.argv.slice(2);
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

// Footprint (px) of the original logo's visible pixels when contained in a 400px square.
async function footprint(file) {
  const png = await sharp(file, { density: 288 }).resize(400, 400, { fit: "contain", background: CLEAR }).png().toBuffer();
  const { info } = await sharp(png).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
  return Math.sqrt(info.width * info.height);
}
fs.mkdirSync(out, { recursive: true });

// Marks that are already mostly gone after text removal keep their colours as the only clue.
const KEEP_COLOUR = new Set(["1610612747", "1610612751", "1610612755", "1610612765"]);
// Black/white/silver marks: hue rotation does nothing, so invert them instead.
const INVERT = new Set(["1610612759"]);

function rng(seed) { let s = seed % 2147483647; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

(async () => {
  const params = {};
  for (const f of fs.readdirSync(src).filter((f) => f.endsWith(".svg")).sort()) {
    const id = f.replace(".svg", ""), r = rng(Number(id));
    r(); r();
    const flip = r() < 0.6;
    const sign = r() < 0.5 ? -1 : 1;
    const angle = sign * Math.round(35 + r() * 130);          // 35°..165° either way
    const hue = Math.round(100 + r() * 160);                    // 100°..260°
    params[id] = { flip, angle, hue: KEEP_COLOUR.has(id) || INVERT.has(id) ? 0 : hue, invert: INVERT.has(id) };

    let img = sharp(path.join(src, f), { density: 288 }).resize(360, 360, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } });
    let buf = await img.png().toBuffer();
    let s = sharp(buf);
    if (params[id].hue) s = s.modulate({ hue: params[id].hue });
    if (params[id].invert) s = s.negate({ alpha: false });
    buf = await s.png().toBuffer();
    s = sharp(buf);
    if (flip) s = s.flop();
    buf = await s.rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const target = await footprint(path.join(orig, f));
    const trimmed = await sharp(buf).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = trimmed.info;
    const k = Math.min(target / Math.sqrt(w * h), 400 / w, 400 / h);
    const mark = await sharp(trimmed.data).resize(Math.round(w * k), Math.round(h * k)).png().toBuffer({ resolveWithObject: true });
    await sharp({ create: { width: 400, height: 400, channels: 4, background: CLEAR } })
      .composite([{ input: mark.data, left: Math.round((400 - mark.info.width) / 2), top: Math.round((400 - mark.info.height) / 2) }])
      .webp({ quality: 88, alphaQuality: 100 }).toFile(path.join(out, `${id}.webp`));
    params[id].footprint = Math.round(target);
  }
  console.log(JSON.stringify(params));
})();
