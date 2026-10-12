#!/usr/bin/env node
// Check-ID catalogue: every `[ID]` test title under specs/ appears once across all specs, carries its
// suite's prefix, and is documented in CHECKS.md. Generated tests (titles built at runtime) are
// declared as families with a `// @catalog-family GM-<game>-<scenario>` comment, documented the same way.
// Prints counts per suite; exits 1 on duplicates, wrong prefixes or undocumented ids.
//   node scripts/ui-check/catalog.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UIC = path.dirname(fileURLToPath(import.meta.url));
const SPECS = path.join(UIC, 'specs');
const PREFIX = { guest: 'G-', account: 'AC-', games: 'GM-', multiplayer: 'MP-', selftest: 'ST-', accept: 'ACCEPT' };

const TITLE = /\btest(?:\.(?:only|skip|fixme|fail|slow))?\s*\(\s*(['"`])\[([A-Za-z][\w.-]*)\]/g;
const FAMILY = /\/\/\s*@catalog-family\s+(\S+)/g;

function walk(dir) {
  let out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (/\.spec\.m?js$/.test(name)) out.push(p);
  }
  return out;
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/** IDs and families documented in CHECKS.md: the backticked first cell of every table row. */
function documented() {
  const md = readFileSync(path.join(UIC, 'CHECKS.md'), 'utf8');
  const ids = new Set();
  for (const line of md.split('\n')) {
    const m = /^\|\s*`([^`]+)`\s*\|/.exec(line);
    if (m) ids.add(m[1]);
  }
  return ids;
}

function main() {
  const docs = documented();
  const seen = new Map(); // id → [locations]
  const perSuite = new Map();
  const errors = [];
  for (const file of walk(SPECS)) {
    const rel = path.relative(UIC, file).split(path.sep).join('/');
    const suite = rel.split('/')[1];
    const src = readFileSync(file, 'utf8');
    const found = [];
    for (const m of src.matchAll(TITLE)) found.push({ id: m[2], kind: 'id', at: `${rel}:${lineOf(src, m.index)}` });
    for (const m of src.matchAll(FAMILY)) found.push({ id: m[1], kind: 'family', at: `${rel}:${lineOf(src, m.index)}` });
    for (const f of found) {
      if (!seen.has(f.id)) seen.set(f.id, []);
      seen.get(f.id).push(f.at);
      const c = perSuite.get(suite) || { ids: 0, families: 0 };
      c[f.kind === 'id' ? 'ids' : 'families']++;
      perSuite.set(suite, c);
      const prefix = PREFIX[suite];
      if (prefix && !f.id.startsWith(prefix)) errors.push(`${f.id} (${f.at}) does not start with ${prefix}, the ${suite} prefix`);
      if (!docs.has(f.id)) errors.push(`${f.id} (${f.at}) is not documented in CHECKS.md`);
    }
  }
  for (const [id, at] of seen) if (at.length > 1) errors.push(`${id} appears ${at.length} times: ${at.join(', ')}`);

  console.log('| suite | ids | families |');
  console.log('|---|---|---|');
  let ids = 0, fams = 0;
  for (const [suite, c] of [...perSuite].sort()) { console.log(`| ${suite} | ${c.ids} | ${c.families} |`); ids += c.ids; fams += c.families; }
  console.log(`| total | ${ids} | ${fams} |`);
  const stale = [...docs].filter((d) => !seen.has(d) && /^(G|AC|GM|MP|ST)-|^ACCEPT/.test(d));
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
