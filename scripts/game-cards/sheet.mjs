// Contact sheet of out/cards (or any folder) for review: out/contact-sheet.jpg
//   node scripts/game-cards/sheet.mjs [--dir out/raw] [--cols 4]
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { CARDS, OUT, parseArgs } from "./lib.mjs";

const args = parseArgs();
const dir = args.dir ? path.resolve(args.dir) : CARDS;
const cols = Number(args.cols || 4);
const W = 400;
const H = 225;
const LABEL = 26;
const GAP = 12;

const files = (await fs.readdir(dir)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
if (!files.length) {
  console.error(`no images in ${dir}`);
  process.exit(1);
}
const rows = Math.ceil(files.length / cols);
const width = cols * W + (cols + 1) * GAP;
const height = rows * (H + LABEL) + (rows + 1) * GAP;

const layers = [];
for (let i = 0; i < files.length; i++) {
  const x = GAP + (i % cols) * (W + GAP);
  const y = GAP + Math.floor(i / cols) * (H + LABEL + GAP);
  const img = await sharp(path.join(dir, files[i])).resize(W, H, { fit: "cover" }).png().toBuffer();
  layers.push({ input: img, left: x, top: y });
  const label = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${LABEL}"><text x="0" y="18" font-family="Segoe UI, Arial, sans-serif" font-size="14" fill="#f5f3ef">${files[i]}</text></svg>`,
  );
  layers.push({ input: label, left: x, top: y + H + 4 });
}

const out = path.join(OUT, `contact-sheet${args.dir ? "-" + path.basename(dir) : ""}.jpg`);
await sharp({ create: { width, height, channels: 3, background: "#101010" } })
  .composite(layers)
  .jpeg({ quality: 85 })
  .toFile(out);
console.log(`${files.length} images -> ${path.relative(process.cwd(), out)}`);
