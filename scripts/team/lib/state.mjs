// Per-card run state under .team/run/<slug>/ — the files every v2 node reads and writes
// (card.json, classify.json, brief.md, build-report.json, verify.json, review-package.md, state.json).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../../lib/team-config.mjs";

export const RUN_ROOT = resolve(ROOT, ".team/run");

export function runDir(slug) {
  const dir = resolve(RUN_ROOT, slug);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n");
  return obj;
}

const FRESH = (slug) => ({
  slug, pageId: null, stage: "intake", tier: "standard", lane: 1, baseSha: null, branch: `team/${slug}`,
  startedAt: new Date().toISOString(), fixRounds: { verify: 0, qa: 0, review: 0 }, replanned: false,
  engineAgentIds: {}, lastFirstError: null,
});

export function readState(slug) {
  return readJson(resolve(runDir(slug), "state.json"), FRESH(slug));
}

export function writeState(slug, patch) {
  const next = { ...readState(slug), ...patch, updatedAt: new Date().toISOString() };
  return writeJson(resolve(runDir(slug), "state.json"), next);
}

/**
 * kebab-case title, ≤30 chars, unique against existing run dirs: a dir is reused only when its
 * card.json belongs to the same Notion card (a resume); any other occupant gets a -2/-3 suffix.
 */
export function slugFor(title, cardId = null) {
  let base = String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (base.length > 30) { base = base.slice(0, 30); const cut = base.lastIndexOf("-"); if (cut > 12) base = base.slice(0, cut); }
  base = base.replace(/-+$/g, "");
  if (!base) base = "card";
  let slug = base;
  let i = 2;
  const taken = (s) => {
    if (!existsSync(resolve(RUN_ROOT, s))) return false;
    const owner = readJson(resolve(RUN_ROOT, s, "card.json"));
    return !(owner && cardId && owner.id === cardId);
  };
  while (taken(slug)) slug = `${base.slice(0, 27)}-${i++}`;
  return slug;
}
