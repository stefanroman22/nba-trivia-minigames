// Stage B without any API: renders the hand-built SVG scenes (scenes.mjs) with the Playwright
// Chromium that ui-check already installs, then finishes them (no palette ramp: they are
// already on-brand) into out/cards/<id>.jpg. The raw 1600x900 PNG stays in out/raw/.
//
//   node scripts/game-cards/render.mjs [--ids a,b] [--raw-only]
import path from "node:path";
import fs from "node:fs/promises";
import { chromium } from "@playwright/test";
import { CARDS, RAW, ROOT, finishCard, parseArgs } from "./lib.mjs";
import { pick } from "./manifest.mjs";
import { H, W, scenes } from "./scenes.mjs";

// The brand display font, embedded so scenes with text (Fan Favorites' board) render in it.
const russo = (await fs.readFile(path.join(ROOT, "public", "fonts", "russo-one-400-latin.woff2"))).toString("base64");
const FONT_CSS = `@font-face{font-family:"Russo One";src:url(data:font/woff2;base64,${russo}) format("woff2")}`;

const args = parseArgs();
const games = pick(args.ids);
await fs.mkdir(RAW, { recursive: true });
await fs.mkdir(CARDS, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
let n = 0;
for (const g of games) {
  const scene = scenes[g.id];
  if (!scene) {
    console.log(`skip   ${g.id.padEnd(16)} no scene in scenes.mjs`);
    continue;
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${FONT_CSS}html,body{margin:0;background:#0b0b0b;overflow:hidden}svg{display:block}</style></head><body>${scene()}</body></html>`;
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(async () => {
    await document.fonts.load('40px "Russo One"');
    await document.fonts.ready;
  });
  const raw = path.join(RAW, `${g.id}.png`);
  await page.screenshot({ path: raw, clip: { x: 0, y: 0, width: W, height: H } });
  if (!args["raw-only"]) {
    const out = path.join(CARDS, `${g.id}.jpg`);
    await finishCard(raw, out, { ramp: false, glow: 0.22, vignette: 0.6, floor: 0.4, grain: 0.04 });
    console.log(`render ${g.id.padEnd(16)} -> out/cards/${g.id}.jpg (${Math.round((await fs.stat(out)).size / 1024)} KB)`);
  } else console.log(`render ${g.id.padEnd(16)} -> out/raw/${g.id}.png`);
  n++;
}
await browser.close();
console.log(`\n${n}/${games.length} scene(s) rendered. Review: node scripts/game-cards/sheet.mjs`);
