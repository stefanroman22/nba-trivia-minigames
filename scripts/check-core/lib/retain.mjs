#!/usr/bin/env node
// Retention (spec §7), end of every nightly run. Each checker prunes its own data:
// - runs (<home>/runs/<id>): keep the newest `keepRuns` per checker (run-meta.json `checker`, else the id: `-logic` →
//   logic, anything else → ui) plus every run in `openRunIds` or named by a non-Done entry of <home>/notion-cards.json;
//   older runs lose their shots/ first, then the whole directory. Only names that are run ids count (YYYYMMDD-HHmm[x|-<suffix>]):
//   any other directory under runs/ (`explore`, `fix1-selftest`, …) is never touched and never counts as the newest run. The newest run of each checker is never deleted.
// - notes (scripts/{ui,logic}-check/notes/*.md): a bullet dated `(YYYY-MM-DD)` (or a run id `(YYYYMMDD-HHmm…)`) older
//   than `notesDays` that names no open finding id moves to notes/archive/<file>.md; a file still over `notesMax` lines
//   then moves its oldest dated bullets (same open-id rule) until it fits, else it is reported as over the cap.
// - channel.json: resolved blocks and resolved deferred items older than `channelDays` are dropped.
// - notion-cards.json: Done entries older than `cardsDays` are dropped. Notion itself is never pruned.
// dryRun: reports (and prints) what would go, changes nothing.
//   node scripts/check-core/lib/retain.mjs [--dry-run] [--keep 5] [--home <dir>]   (prints every kept run and ignored dir too)
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, uicHome } from './home.mjs';
import { channelPath, readChannel, writeChannel } from './channel.mjs';
import { ledgerPath, readLedger } from './cards-ledger.mjs';

const DAY = 86_400_000;
export const NOTES_DIRS = [path.join(ROOT, 'scripts', 'ui-check', 'notes'), path.join(ROOT, 'scripts', 'logic-check', 'notes')];
const FINDING_ID = /\b[A-Z]{2,5}-\d{8}-\d{4}[\w-]*?-\d{3,}\b/g;

const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return d; } };

/** A run directory name: YYYYMMDD-HHmm, optionally `x` (copied run) or `-<suffix>` (`-live`, `-logic`). Nothing else is a run. */
export const isRunDirName = (name) => /^\d{8}-\d{4}(x|-[a-z]+)?$/.test(String(name));

/** The checker a run belongs to: run-meta.json `checker`, else `-logic` in the id → logic, else ui. */
export function runChecker(home, id) {
  const meta = readJson(path.join(home, 'runs', id, 'run-meta.json'), null);
  if (meta && (meta.checker === 'ui' || meta.checker === 'logic')) return meta.checker;
  return /-logic(\b|$)/.test(id) ? 'logic' : 'ui';
}

/** Date (ms) a notes bullet carries: `(YYYY-MM-DD)` or a run id `(YYYYMMDD-HHmm…)`; null when undated. */
export function bulletDate(text) {
  const d = /\((\d{4})-(\d{2})-(\d{2})\)/.exec(text) || /\((\d{4})(\d{2})(\d{2})-\d{4}[\w-]*\)/.exec(text);
  if (!d) return null;
  const t = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]));
  return Number.isFinite(t) ? t : null;
}

/** A notes file → its lines grouped: bullets ("- " / "* " at column 0 plus indented continuation lines) and other lines. */
function blocksOf(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const out = [];
  for (const line of lines) {
    const last = out.at(-1);
    if (/^[-*] /.test(line)) out.push({ bullet: true, lines: [line] });
    else if (last && last.bullet && /^\s+\S/.test(line)) last.lines.push(line);
    else out.push({ bullet: false, lines: [line] });
  }
  return out;
}

/** Prune one notes file's text → { text, archived: [bullet text], overCap }. Pure. */
export function pruneNotes(text, { now = Date.now(), notesMax = 150, notesDays = 90, openIds = new Set() } = {}) {
  const blocks = blocksOf(text);
  const bulletText = (b) => b.lines.join('\n');
  const movable = (b) => b.bullet && bulletDate(bulletText(b)) !== null && ![...bulletText(b).matchAll(FINDING_ID)].some((m) => openIds.has(m[0]));
  const archived = new Set();
  for (const b of blocks) if (movable(b) && now - bulletDate(bulletText(b)) > notesDays * DAY) archived.add(b);
  const count = () => blocks.filter((b) => !archived.has(b)).reduce((n, b) => n + b.lines.length, 0);
  const oldest = blocks.filter((b) => movable(b) && !archived.has(b)).sort((a, b) => bulletDate(bulletText(a)) - bulletDate(bulletText(b)));
  while (count() > notesMax && oldest.length) archived.add(oldest.shift());
  const kept = blocks.filter((b) => !archived.has(b)).flatMap((b) => b.lines).join('\n');
  return { text: kept, archived: blocks.filter((b) => archived.has(b)).map(bulletText), overCap: count() > notesMax };
}

/**
 * → report { dryRun, runs: { deleted: [{ id, checker }], kept: [{ id, checker, why }], ignored: [dir names that are not run ids] }, notes: [{ file, archived, overCap }],
 *   channel: { blocks, deferred }, cards: [fingerprint] }
 */
export async function retain({ home = uicHome(), keepRuns = 5, openRunIds = new Set(), openFindingIds = new Set(), notesMax = 150, notesDays = 90,
  channelDays = 30, cardsDays = 60, dryRun = false, notesDirs = NOTES_DIRS, now = Date.now(), log = console.log } = {}) {
  const t = now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : now;
  const say = (m) => log(`retain${dryRun ? ' (dry run)' : ''}: ${m}`);
  const report = { dryRun, runs: { deleted: [], kept: [] }, notes: [], channel: { blocks: 0, deferred: 0 }, cards: [] };

  // Open work from the ledger (non-Done entries), on top of what the caller knows from Notion.
  const ledgerFile = ledgerPath(home);
  const ledger = readLedger(ledgerFile);
  const openRuns = new Set(openRunIds);
  const openIds = new Set(openFindingIds);
  for (const e of Object.values(ledger)) if (e && e.status !== 'Done') { if (e.run) openRuns.add(e.run); if (e.id) openIds.add(e.id); }

  // 1. Runs.
  const runsDir = path.join(home, 'runs');
  let ids = [];
  // Only real run ids count (newest-per-checker included); scratch dirs such as `explore` or `fix1-selftest` are ignored.
  try { ids = readdirSync(runsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && isRunDirName(d.name)).map((d) => d.name).sort().reverse(); } catch { /* no runs yet */ }
  report.runs.ignored = (() => { try { return readdirSync(runsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && !isRunDirName(d.name)).map((d) => d.name); } catch { return []; } })();
  const seen = new Map(); // checker → count kept as newest
  for (const id of ids) {
    const checker = runChecker(home, id);
    const n = seen.get(checker) || 0;
    if (n < Math.max(1, keepRuns)) { seen.set(checker, n + 1); report.runs.kept.push({ id, checker, why: n === 0 ? 'newest' : 'recent' }); continue; }
    if (openRuns.has(id)) { report.runs.kept.push({ id, checker, why: 'open card' }); continue; }
    report.runs.deleted.push({ id, checker });
    say(`delete run ${id} (${checker})`);
    if (!dryRun) {
      rmSync(path.join(runsDir, id, 'shots'), { recursive: true, force: true });
      rmSync(path.join(runsDir, id), { recursive: true, force: true });
    }
  }

  // 2. Notes.
  for (const dir of notesDirs) {
    let files = [];
    try { files = readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { continue; }
    for (const name of files) {
      const file = path.join(dir, name);
      const src = readFileSync(file, 'utf8');
      const r = pruneNotes(src, { now: t, notesMax, notesDays, openIds });
      if (!r.archived.length && !r.overCap) continue;
      report.notes.push({ file, archived: r.archived.length, overCap: r.overCap });
      if (r.archived.length) say(`archive ${r.archived.length} bullet(s) of ${file} → archive/${name}`);
      if (r.overCap) say(`${file} is still over ${notesMax} lines (undated bullets or open findings) — left as is`);
      if (!dryRun && r.archived.length) {
        const arch = path.join(dir, 'archive', name);
        mkdirSync(path.dirname(arch), { recursive: true });
        const head = existsSync(arch) ? '' : `# ${name} — archived notes (retain.mjs)\n`;
        appendFileSync(arch, `${head}\n## archived ${new Date(t).toISOString().slice(0, 10)}\n\n${r.archived.join('\n')}\n`);
        writeFileSync(file, r.text);
      }
    }
  }

  // 3. Channel: resolved blocks and resolved deferred items older than channelDays.
  const cfile = channelPath(home);
  if (existsSync(cfile)) {
    const c = readChannel({ file: cfile });
    const old = (x) => x.resolvedAt && t - Date.parse(x.resolvedAt) > channelDays * DAY;
    const blocks = c.resolved.filter(old).length, deferred = c.deferred.filter(old).length;
    report.channel = { blocks, deferred };
    if (blocks || deferred) {
      say(`channel: drop ${blocks} resolved block(s), ${deferred} resolved deferred item(s)`);
      if (!dryRun) writeChannel({ ...c, resolved: c.resolved.filter((x) => !old(x)), deferred: c.deferred.filter((x) => !old(x)) }, { file: cfile });
    }
  }

  // 4. Cards ledger: Done entries older than cardsDays.
  const drop = Object.entries(ledger).filter(([, e]) => e && e.status === 'Done' && e.at && t - Date.parse(e.at) > cardsDays * DAY).map(([fp]) => fp);
  report.cards = drop;
  if (drop.length) {
    say(`notion-cards.json: drop ${drop.length} Done entr${drop.length === 1 ? 'y' : 'ies'}`);
    if (!dryRun) {
      const keep = Object.fromEntries(Object.entries(ledger).filter(([fp]) => !drop.includes(fp)));
      writeFileSync(ledgerFile, JSON.stringify(keep, null, 2) + '\n');
    }
  }
  say(`${report.runs.deleted.length} run(s) ${dryRun ? 'would be ' : ''}deleted, ${report.runs.kept.length} kept`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const arg = (name) => { const i = a.indexOf(name); return i >= 0 ? a[i + 1] : undefined; };
  const home = arg('--home') ? path.resolve(arg('--home')) : uicHome();
  console.log(`retain: home ${home}`);
  const r = await retain({ home, dryRun: a.includes('--dry-run'), keepRuns: arg('--keep') !== undefined ? Number(arg('--keep')) : 5 });
  for (const k of r.runs.kept) console.log(`  keep ${k.id} (${k.checker}, ${k.why})`);
  for (const d of r.runs.ignored) console.log(`  ignore ${d} (not a run id)`);
}
