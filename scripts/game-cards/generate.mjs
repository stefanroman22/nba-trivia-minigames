// Stage B (AI, costs money or a free-tier quota): render each game's concept in the
// Series Winner style. DRY RUN BY DEFAULT - prints prompts and a cost estimate and exits.
//
//   node scripts/game-cards/generate.mjs                       # dry run, all games
//   node scripts/game-cards/generate.mjs --ids wordle --yes    # really call the API
//   --provider gemini|openai   (default: IMAGE_PROVIDER env, else gemini)
//   --model <id>               (default: GEMINI_IMAGE_MODEL / OPENAI_IMAGE_MODEL env)
//   --variants 2               (files become out/raw/<id>.png, <id>-2.png ...)
//   --no-style-ref             (don't attach playoff_series.jpg as the style anchor)
//   --quality low|medium|high  (openai only; default medium)
//
// Keys: GEMINI_API_KEY or OPENAI_API_KEY in the environment, .env.local, or scripts/game-cards/.env.
// Outputs go to out/raw/; run finish.mjs afterwards to palette-lock and size them.
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { RAW, SOURCES, STYLE_REF, exists, findFile, loadEnv, mimeOf, parseArgs } from "./lib.mjs";
import { pick } from "./manifest.mjs";
import { NEGATIVE, REF_NOTE, STYLE_PROMPT } from "./style.mjs";

await loadEnv();
const args = parseArgs();
const games = pick(args.ids);
const provider = (args.provider || process.env.IMAGE_PROVIDER || "gemini").toLowerCase();
const variants = Number(args.variants || 1);
const useStyleRef = !args["no-style-ref"];
const quality = args.quality || "medium";

// Estimated list prices per image, from third-party pricing roundups read 2026-10-16.
// Re-check the provider's own pricing page before relying on them.
const PRICE = {
  gemini: { model: process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image", perImage: 0.039, note: "free tier with a daily quota exists" },
  openai: {
    model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1.5",
    perImage: { low: 0.015, medium: 0.05, high: 0.2 }[quality] ?? 0.05,
    note: `16:9 at quality=${quality}`,
  },
};
if (!PRICE[provider]) throw new Error(`unknown provider ${provider}`);
const model = args.model || PRICE[provider].model;

const jobs = [];
for (const g of games) {
  const refs = [];
  if (useStyleRef) refs.push(STYLE_REF);
  const source = await findFile(SOURCES, g.id);
  if (source) refs.push(source);
  const prompt = [STYLE_PROMPT, `Subject: ${g.concept}`, NEGATIVE, refs.length ? REF_NOTE : ""].filter(Boolean).join("\n\n");
  for (let v = 1; v <= variants; v++) jobs.push({ g, v, refs, prompt, out: path.join(RAW, v === 1 ? `${g.id}.png` : `${g.id}-${v}.png`) });
}

const est = jobs.length * PRICE[provider].perImage;
console.log(`provider ${provider}  model ${model}  images ${jobs.length}  est. cost ~$${est.toFixed(2)} (${PRICE[provider].note})\n`);
for (const j of jobs) console.log(`${j.g.id.padEnd(16)} refs: ${j.refs.map((r) => path.basename(r)).join(", ") || "none"}`);

if (!args.yes) {
  console.log(`\nDry run. Add --yes to generate (${jobs.length} image(s), est. ~$${est.toFixed(2)}).`);
  process.exit(0);
}

const key = provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY;
if (!key) {
  console.error(`\nMissing ${provider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY"}. Put it in .env.local or scripts/game-cards/.env.`);
  process.exit(1);
}

async function gemini({ prompt, refs }) {
  const parts = [{ text: prompt }];
  for (const r of refs) parts.push({ inline_data: { mime_type: mimeOf(r), data: (await fs.readFile(r)).toString("base64") } });
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "16:9" } },
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const json = await res.json();
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData || p.inline_data);
  if (!part) throw new Error(`no image in response: ${JSON.stringify(json).slice(0, 400)}`);
  return Buffer.from((part.inlineData || part.inline_data).data, "base64");
}

async function openai({ prompt, refs }) {
  let res;
  if (refs.length) {
    const fd = new FormData();
    fd.append("model", model);
    fd.append("prompt", prompt);
    fd.append("size", "1536x1024");
    fd.append("quality", quality);
    for (const r of refs) fd.append("image[]", new Blob([await fs.readFile(r)], { type: mimeOf(r) }), path.basename(r));
    res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { authorization: `Bearer ${key}` }, body: fd });
  } else {
    res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model, prompt, size: "1536x1024", quality, n: 1 }),
    });
  }
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const json = await res.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error(`no image in response: ${JSON.stringify(json).slice(0, 400)}`);
  return Buffer.from(b64, "base64");
}

await fs.mkdir(RAW, { recursive: true });
const call = provider === "gemini" ? gemini : openai;
let ok = 0;
for (const j of jobs) {
  if (await exists(j.out) && !args.force) {
    console.log(`keep   ${path.basename(j.out)} (exists; --force to redo)`);
    continue;
  }
  try {
    const buf = await call(j);
    await sharp(buf).png().toFile(j.out);
    console.log(`made   ${path.basename(j.out)}`);
    ok++;
  } catch (e) {
    console.error(`FAIL   ${j.g.id}: ${e.message.slice(0, 300)}`);
  }
}
console.log(`\n${ok} image(s) in ${path.relative(process.cwd(), RAW)}. Next: node scripts/game-cards/finish.mjs`);
