#!/usr/bin/env node
// Check-ID catalogue of both checkers: every `[ID]` test title under scripts/ui-check/specs/ and
// scripts/logic-check/specs/ appears once across all specs, carries its suite's prefix (LC- for every logic spec), and
// is documented in its checker's CHECKS.md, whose rows all carry a `services` column (check-core/lib/services.mjs).
// Generated tests (titles built at runtime) are declared as families with a `// @catalog-family GM-<game>-<scenario>`
// comment, documented the same way. The no-overlap lint (spec §5): an LC- spec never calls audit.layout/motion/a11y/perf,
// a ui-check spec never imports scripts/logic-check/lib. A missing scripts/logic-check/CHECKS.md means no logic checks yet.
// Prints counts per suite; exits 1 on duplicates, wrong prefixes, undocumented ids, missing services or overlap.
//   node scripts/ui-check/catalog.mjs
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { overlapErrors, parseServices } from '../check-core/lib/services.mjs';

const UIC = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.dirname(UIC);
const CHECKERS = [
  { name: 'ui', dir: UIC, prefix: { guest: 'G-', account: 'AC-', games: 'GM-', multiplayer: 'MP-', selftest: 'ST-', accept: 'ACCEPT' } },
  { name: 'logic', dir: path.join(SCRIPTS, 'logic-check'), prefix: null, all: 'LC-' },
];

const TITLE = /\btest(?:\.(?:only|skip|fixme|fail|slow))?\s*\(\s*(['"`])\[([A-Za-z][\w.-]*)\]/g;
const FAMILY = /\/\/\s*@catalog-family\s+(\S+)/g;

function walk(dir) {
  let out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (/\.spec\.m?js$/.test(name)) out.push(p);
  }
  return out;
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/** IDs and families documented in a CHECKS.md (the backticked first cell of every table row), with services checked. */
function documented(checker, errors) {
  const file = path.join(checker.dir, 'CHECKS.md');
  if (!existsSync(file)) return { ids: new Set(), present: false };
  const md = readFileSync(file, 'utf8');
  const ids = new Set();
  for (const line of md.split('\n')) {
    const m = /^\|\s*`([^`]+)`\s*\|/.exec(line);
    if (m) ids.add(m[1]);
  }
  try { parseServices(md, { file: `${path.basename(checker.dir)}/CHECKS.md` }); } catch (e) { errors.push(...e.message.split('\n').slice(1).map((l) => l.replace(/^- /, ''))); }
  return { ids, present: true };
}

function main() {
  const seen = new Map(); // id → [locations], across both checkers
  const perSuite = new Map();
  const errors = [];
  const stale = [];
  for (const checker of CHECKERS) {
    const docs = documented(checker, errors);
    const specs = walk(path.join(checker.dir, 'specs'));
    const local = new Set();
    for (const file of specs) {
      const rel = path.relative(SCRIPTS, file).split(path.sep).join('/');
      const suite = rel.split('/')[2];
      const src = readFileSync(file, 'utf8');
      errors.push(...overlapErrors(src, { checker: checker.name, file: rel }));
      const found = [];
      for (const m of src.matchAll(TITLE)) found.push({ id: m[2], kind: 'id', at: `${rel}:${lineOf(src, m.index)}` });
      for (const m of src.matchAll(FAMILY)) found.push({ id: m[1], kind: 'family', at: `${rel}:${lineOf(src, m.index)}` });
      for (const f of found) {
        local.add(f.id);
        if (!seen.has(f.id)) seen.set(f.id, []);
        seen.get(f.id).push(f.at);
        const key = `${checker.name}/${suite}`;
        const c = perSuite.get(key) || { ids: 0, families: 0 };
        c[f.kind === 'id' ? 'ids' : 'families']++;
        perSuite.set(key, c);
        const prefix = checker.all || checker.prefix[suite];
        if (prefix && !f.id.startsWith(prefix)) errors.push(`${f.id} (${f.at}) does not start with ${prefix}, the ${checker.all ? `${checker.name}-check` : suite} prefix`);
        if (!docs.ids.has(f.id)) errors.push(`${f.id} (${f.at}) is not documented in ${path.basename(checker.dir)}/CHECKS.md${docs.present ? '' : ' (the file does not exist)'}`);
      }
    }
    const known = checker.name === 'ui' ? /^(G|AC|GM|MP|ST)-|^ACCEPT/ : /^LC-/;
    stale.push(...[...docs.ids].filter((d) => !local.has(d) && known.test(d)));
  }
  for (const [id, at] of seen) if (at.length > 1) errors.push(`${id} appears ${at.length} times: ${at.join(', ')}`);

  console.log('| suite | ids | families |');
  console.log('|---|---|---|');
  let ids = 0, fams = 0;
  for (const [suite, c] of [...perSuite].sort()) { console.log(`| ${suite} | ${c.ids} | ${c.families} |`); ids += c.ids; fams += c.families; }
  console.log(`| total | ${ids} | ${fams} |`);
  if (stale.length) console.log(`\nnote: documented but not in any spec: ${stale.join(', ')}`);
  if (errors.length) {
    console.error(`\ncatalog: ${errors.length} problem(s)`);
    for (const e of errors) console.error(`- ${e}`);
    return 1;
  }
  console.log('\ncatalog: ok');
  return 0;
}

process.exitCode = main();
