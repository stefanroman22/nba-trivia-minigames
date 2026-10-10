// Text-free SVG -> scrambled 400px WebP: hue shift (or invert for black/white marks), mirror, rotation.
// Deterministic per team id. usage: node scramble.cjs <cleanSvgDir> <outDir>
const fs = require("fs"), path = require("path"), sharp = require("sharp");
const [src, out] = process.argv.slice(2);
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
    await sharp(buf).trim({ threshold: 1 }).resize(400, 400, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 88, alphaQuality: 100 }).toFile(path.join(out, `${id}.webp`));
  }
  console.log(JSON.stringify(params));
})();
