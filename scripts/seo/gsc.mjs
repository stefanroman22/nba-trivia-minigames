// Search Console from the command line (the weekly run calls lib/gsc-client.mjs directly; this is for a manual check).
//
//   node scripts/seo/gsc.mjs inspect <url> --out <file>
//   node scripts/seo/gsc.mjs sitemaps --out <file>
//   node scripts/seo/gsc.mjs submit-sitemap [<feedpath>] --out <file>     (default feedpath <config.site>/sitemap.xml)
//   node scripts/seo/gsc.mjs analytics [--days 28] --out <file>
//
// Credentials from lib/google-auth.mjs credentialsFromEnv(); the property and the inspect budget from config.json. The
// result is written as JSON to --out; stdout gets one count line, never a value. Exit 0 ok, 1 the inspection returned
// an error, 2 bad arguments, no credentials or a failed request.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { credentialsFromEnv, tokenSource } from './lib/google-auth.mjs';
import { gscClient } from './lib/gsc-client.mjs';

const COMMANDS = ['inspect', 'sitemaps', 'submit-sitemap', 'analytics'];

/** CLI args → { command, target, days, out }; throws on a bad command, a missing value or an unknown flag. */
export function parseArgs(argv) {
  const opts = { command: null, target: null, days: 28, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--out') opts.out = value();
    else if (a === '--days') {
      opts.days = Number(value());
      if (!Number.isInteger(opts.days) || opts.days < 1) throw new Error('--days must be a positive integer');
    } else if (a.startsWith('--')) throw new Error(`unknown argument ${a}`);
    else if (!opts.command) opts.command = a;
    else if (!opts.target) opts.target = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (!COMMANDS.includes(opts.command)) throw new Error(`command must be one of ${COMMANDS.join(', ')}`);
  if (opts.command === 'inspect' && !opts.target) throw new Error('inspect needs a <url>');
  if (!['inspect', 'submit-sitemap'].includes(opts.command) && opts.target) throw new Error(`${opts.command} takes no <url>`);
  if (!opts.out) throw new Error('--out <file> is required');
  return opts;
}

async function main(argv) {
  let opts;
  try { opts = parseArgs(argv); } catch (e) {
    console.error(`gsc: ${e.message}`);
    return 2;
  }
  try {
    const creds = credentialsFromEnv();
    if (!creds) {
      console.error('gsc: no Google credentials (set GOOGLE_SEO_CLIENT_ID, GOOGLE_SEO_CLIENT_SECRET, GOOGLE_SEO_REFRESH_TOKEN or run node scripts/seo/auth.mjs)');
      return 2;
    }
    const config = loadConfig();
    const client = gscClient({ token: tokenSource(creds), property: config.property, budget: config.inspectBudget });
    const out = path.resolve(opts.out);
    const write = (doc) => { mkdirSync(path.dirname(out), { recursive: true }); writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`); };
    if (opts.command === 'inspect') {
      const result = await client.inspect(opts.target);
      write({ url: opts.target, ...result });
      console.log(`gsc: inspect · 1 url · ${result.error ? '1 error' : '0 errors'} → ${out}`);
      return result.error ? 1 : 0;
    }
    if (opts.command === 'sitemaps') {
      const list = await client.sitemaps();
      write(list);
      console.log(`gsc: sitemaps · ${list.length} sitemap(s) → ${out}`);
      return 0;
    }
    if (opts.command === 'submit-sitemap') {
      const feedpath = opts.target ?? `${config.site}/sitemap.xml`;
      await client.submitSitemap(feedpath);
      write({ feedpath, submittedAt: new Date().toISOString() });
      console.log(`gsc: submit-sitemap · 1 sitemap submitted → ${out}`);
      return 0;
    }
    const rows = await client.analytics({ days: opts.days });
    write(rows);
    console.log(`gsc: analytics · ${opts.days} days · ${rows.length} row(s) → ${out}`);
    return 0;
  } catch (e) {
    console.error(`gsc: ${e.message}`); // every client and auth error is "<what>: <status>", never a secret or a value
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
