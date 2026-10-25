// node --test scripts/seo/export.test.mjs — the Drive upload (multipart create, then a media PATCH of the same name) and
// export.mjs: the three files, --dry-run (written to the run dir, no request), the skipped degradations and that no
// token or Search Analytics value reaches the console. A fake Drive behind an injected fetch; never hits the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILES_URL, UPLOAD_URL, driveUpload } from './lib/drive.mjs';
import { cli } from './export.mjs';

const SITE = 'https://swishquest.com';
const FOLDER = 'folder-123';
const TOKEN = 'ya29.SECRET-ACCESS-TOKEN';
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'seo-export-'));
const EXPORT = fileURLToPath(new URL('./export.mjs', import.meta.url));

/** The multipart/related body → [{ headers, content }] (the boundary from the content-type header). */
function parts(contentType, body) {
  const boundary = /boundary=([^;]+)/.exec(contentType)[1];
  return body.split(`--${boundary}`).slice(1, -1).map((p) => {
    const [head, ...rest] = p.replace(/^\r\n/, '').split('\r\n\r\n');
    return { headers: head, content: rest.join('\r\n\r\n').replace(/\r\n$/, '') };
  });
}

/** A fake Drive: files kept in memory; every call recorded as { method, url, headers, body }. */
function fakeDrive() {
  const files = [];
  const calls = [];
  let next = 1;
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  const f = async (url, init = {}) => {
    const u = new URL(String(url));
    calls.push({ method: init.method ?? 'GET', url: String(url), headers: init.headers ?? {}, body: init.body });
    if ((init.method ?? 'GET') === 'GET' && `${u.origin}${u.pathname}` === FILES_URL) {
      const q = u.searchParams.get('q');
      const name = /^name='((?:\\.|[^'])*)'/.exec(q)[1].replace(/\\(.)/g, '$1');
      const parent = /'([^']+)' in parents/.exec(q)[1];
      return json({ files: files.filter((x) => x.name === name && x.parents.includes(parent)).map(({ id, name: n }) => ({ id, name: n })) });
    }
    if (init.method === 'POST' && `${u.origin}${u.pathname}` === UPLOAD_URL && u.searchParams.get('uploadType') === 'multipart') {
      const [meta, content] = parts(init.headers['content-type'], init.body);
      const m = JSON.parse(meta.content);
      const file = { id: `id-${next++}`, ...m, content: content.content };
      files.push(file);
      return json({ id: file.id, name: file.name });
    }
    if (init.method === 'PATCH' && u.pathname.startsWith(new URL(UPLOAD_URL).pathname + '/') && u.searchParams.get('uploadType') === 'media') {
      const id = u.pathname.split('/').at(-1);
      const file = files.find((x) => x.id === id);
      if (!file) return json({ error: 'not found' }, 404);
      file.content = init.body;
      return json({ id: file.id, name: file.name });
    }
    return json({ error: 'unexpected' }, 400);
  };
  return Object.assign(f, { files, calls });
}

test('driveUpload: the first call creates the file (multipart, parents [folderId]); the same name again patches it', async () => {
  const drive = fakeDrive();
  const token = { access: async () => TOKEN };
  const name = "ledger-2026-10-26.csv";
  const first = await driveUpload({ token, folderId: FOLDER, name, mimeType: 'text/csv', body: 'url\n/a\n', fetch: drive });
  assert.deepEqual(first, { id: 'id-1', name });
  assert.deepEqual(drive.calls.map((c) => c.method), ['GET', 'POST']);
  const [find, create] = drive.calls;
  assert.equal(new URL(find.url).searchParams.get('q'), `name='${name}' and '${FOLDER}' in parents and trashed=false`);
  assert.equal(new URL(find.url).searchParams.get('fields'), 'files(id,name)');
  assert.equal(create.url, `${UPLOAD_URL}?uploadType=multipart`);
  assert.equal(UPLOAD_URL, 'https://www.googleapis.com/upload/drive/v3/files');
  assert.ok(drive.calls.every((c) => c.headers.authorization === `Bearer ${TOKEN}`));
  assert.match(create.headers['content-type'], /^multipart\/related; boundary=/);
  const [meta, content] = parts(create.headers['content-type'], create.body);
  assert.match(meta.headers, /application\/json/i);
  assert.deepEqual(JSON.parse(meta.content), { name, parents: [FOLDER], mimeType: 'text/csv' });
  assert.match(content.headers, /text\/csv/);
  assert.equal(content.content, 'url\n/a\n');

  const second = await driveUpload({ token, folderId: FOLDER, name, mimeType: 'text/csv', body: 'url\n/b\n', fetch: drive });
  assert.deepEqual(second, { id: 'id-1', name });
  assert.deepEqual(drive.calls.map((c) => c.method), ['GET', 'POST', 'GET', 'PATCH']);
  const patch = drive.calls[3];
  assert.equal(patch.url, `${UPLOAD_URL}/id-1?uploadType=media`);
  assert.equal(patch.headers['content-type'], 'text/csv');
  assert.equal(drive.files.length, 1);
  assert.equal(drive.files[0].content, 'url\n/b\n');
});

test("driveUpload: a quote in the name is escaped in the query; a failed call throws the status only", async () => {
  const drive = fakeDrive();
  await driveUpload({ token: TOKEN, folderId: FOLDER, name: "it's.md", mimeType: 'text/markdown', body: '# x', fetch: drive });
  assert.equal(new URL(drive.calls[0].url).searchParams.get('q'), `name='it\\'s.md' and '${FOLDER}' in parents and trashed=false`);
  const denied = async () => new Response(JSON.stringify({ error: { message: `token ${TOKEN} denied` } }), { status: 403 });
  await assert.rejects(driveUpload({ token: TOKEN, folderId: FOLDER, name: 'a.csv', mimeType: 'text/csv', body: 'x', fetch: denied }), (e) => {
    assert.equal(e.message, 'drive find: 403');
    return true;
  });
  const down = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); };
  await assert.rejects(driveUpload({ token: TOKEN, folderId: FOLDER, name: 'a.csv', mimeType: 'text/csv', body: 'x', fetch: down }), /^Error: drive find: request failed \(ECONNRESET\)$/);
});

/** A run dir with REPORT.md and gsc-analytics.json, and a ledger file; → { runDir, ledgerFile }. */
function runFixture({ analytics = true } = {}) {
  const dir = tmp();
  const runDir = path.join(dir, 'runs', '20261026-0600-seo');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, 'REPORT.md'), '# SEO run 20261026-0600-seo\n\nAll good.\n');
  if (analytics) {
    writeFileSync(path.join(runDir, 'gsc-analytics.json'), JSON.stringify({ rows: [
      { keys: [`${SITE}/wordle`], clicks: 4242, impressions: 98765, ctr: 0.0429, position: 7.31 },
      { keys: [`${SITE}/`], clicks: 17, impressions: 3011, ctr: 0.0056, position: 12.5 },
    ] }));
  }
  const ledgerFile = path.join(dir, 'ledger.json');
  writeFileSync(ledgerFile, JSON.stringify({ dataAsOf: {}, urls: {
    [`${SITE}/wordle`]: { inSitemap: true, audit: { runId: 'r', pass: [], fail: ['IX-04'] }, gsc: { verdict: 'PASS', coverageState: 'Submitted and indexed' }, requests: [], decision: { kind: 'card' } },
  }, history: [] }));
  return { runDir, ledgerFile };
}
const capture = () => {
  const out = [];
  return { out, log: (s) => out.push(String(s)), err: (s) => out.push(`ERR ${s}`) };
};
const NOW = Date.parse('2026-10-26T04:20:00Z');
const NAMES = ['REPORT-2026-10-26.md', 'gsc-analytics-2026-10-26.csv', 'ledger-2026-10-26.csv'];

test('export.mjs --dry-run writes the three files into the run dir and makes no request', async () => {
  const { runDir, ledgerFile } = runFixture();
  const drive = fakeDrive();
  const io = capture();
  const code = await cli(['--run-dir', runDir, '--ledger', ledgerFile, '--dry-run'],
    { ...io, fetch: drive, now: NOW, config: { site: SITE, driveFolderId: FOLDER }, credentials: () => { throw new Error('dry run must not read credentials'); } });
  assert.equal(code, 0);
  assert.deepEqual(drive.calls, []);
  assert.deepEqual(io.out, [`export: dry · 3 files → ${runDir}`]);
  assert.deepEqual(readdirSync(runDir).filter((f) => NAMES.includes(f)).sort(), NAMES);
  const ledgerCsv = readFileSync(path.join(runDir, 'ledger-2026-10-26.csv'), 'utf8');
  assert.match(ledgerCsv, /^url,inSitemap,auditFail,/);
  assert.match(ledgerCsv, /wordle,true,IX-04,PASS,Submitted and indexed/);
  const analytics = readFileSync(path.join(runDir, 'gsc-analytics-2026-10-26.csv'), 'utf8');
  assert.equal(analytics, `page,clicks,impressions,ctr,position\n${SITE}/wordle,4242,98765,0.0429,7.31\n${SITE}/,17,3011,0.0056,12.5\n`);
  assert.equal(readFileSync(path.join(runDir, 'REPORT-2026-10-26.md'), 'utf8'), '# SEO run 20261026-0600-seo\n\nAll good.\n');
});

test('export.mjs --dry-run as a process: --run-dir and --ledger overrides, exit 0, the three files', () => {
  const { runDir, ledgerFile } = runFixture();
  const r = spawnSync(process.execPath, [EXPORT, '--run-dir', runDir, '--ledger', ledgerFile, '--dry-run'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^export: dry · 3 files → /);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  assert.equal(readdirSync(runDir).filter((f) => /^(ledger|gsc-analytics|REPORT)-\d{4}-\d{2}-\d{2}\.(csv|md)$/.test(f)).length, 3);
});

test('export.mjs: no gsc-analytics.json → two files; the analytics json may also be a bare row array', async () => {
  const { runDir, ledgerFile } = runFixture({ analytics: false });
  const io = capture();
  assert.equal(await cli(['--run-dir', runDir, '--ledger', ledgerFile, '--dry-run'], { ...io, now: NOW, config: { site: SITE, driveFolderId: FOLDER } }), 0);
  assert.deepEqual(io.out, [`export: dry · 2 files → ${runDir}`]);

  writeFileSync(path.join(runDir, 'gsc-analytics.json'), JSON.stringify([{ keys: [`${SITE}/a,b`], clicks: 1, impressions: 2, ctr: 0.5, position: 3 }]));
  const io2 = capture();
  assert.equal(await cli(['--run-dir', runDir, '--ledger', ledgerFile, '--dry-run'], { ...io2, now: NOW, config: { site: SITE, driveFolderId: FOLDER } }), 0);
  assert.equal(readFileSync(path.join(runDir, 'gsc-analytics-2026-10-26.csv'), 'utf8'), `page,clicks,impressions,ctr,position\n"${SITE}/a,b",1,2,0.5,3\n`);
});

test('export.mjs: no driveFolderId or no credentials → one skipped line, exit 0, no request', async () => {
  const { runDir, ledgerFile } = runFixture();
  const drive = fakeDrive();
  const io = capture();
  assert.equal(await cli(['--run-dir', runDir, '--ledger', ledgerFile], { ...io, fetch: drive, now: NOW, config: { site: SITE, driveFolderId: null }, credentials: () => ({ clientId: 'c', clientSecret: 's', refreshToken: 'r' }) }), 0);
  assert.deepEqual(io.out, ['export: skipped (no driveFolderId in config.json)']);
  const io2 = capture();
  assert.equal(await cli(['--run-dir', runDir, '--ledger', ledgerFile], { ...io2, fetch: drive, now: NOW, config: { site: SITE, driveFolderId: FOLDER }, credentials: () => null }), 0);
  assert.deepEqual(io2.out, ['export: skipped (no Google credentials)']);
  assert.deepEqual(drive.calls, []);
});

test('export.mjs live: uploads the three files to the folder and prints the count line only (no token, no analytics value)', async () => {
  const { runDir, ledgerFile } = runFixture();
  const drive = fakeDrive();
  const tokenFetch = async (url, init) => {
    if (String(url) === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: TOKEN, expires_in: 3600 }), { status: 200 });
    return drive(url, init);
  };
  const io = capture();
  const config = { site: SITE, driveFolderId: FOLDER };
  const credentials = () => ({ clientId: 'cid', clientSecret: 'csecret', refreshToken: 'rtoken' });
  assert.equal(await cli(['--run-dir', runDir, '--ledger', ledgerFile], { ...io, fetch: tokenFetch, now: NOW, config, credentials }), 0);
  assert.deepEqual(io.out, [`export: 3 files → ${FOLDER}`]);
  assert.deepEqual(drive.files.map((f) => f.name).sort(), NAMES);
  assert.ok(drive.files.every((f) => f.parents[0] === FOLDER));
  assert.match(drive.files.find((f) => f.name.startsWith('gsc-analytics')).content, /4242/);

  // The same day again: the files are patched, not duplicated.
  const io2 = capture();
  assert.equal(await cli(['--run-dir', runDir, '--ledger', ledgerFile], { ...io2, fetch: tokenFetch, now: NOW, config, credentials }), 0);
  assert.equal(drive.files.length, 3);
  assert.equal(drive.calls.filter((c) => c.method === 'PATCH').length, 3);

  // A Drive refusal: exit 1, the status only.
  const denied = async (url) => (String(url).includes('oauth2') ? tokenFetch(url) : new Response(JSON.stringify({ error: `${TOKEN} 4242` }), { status: 403 }));
  const io3 = capture();
  assert.equal(await cli(['--run-dir', runDir, '--ledger', ledgerFile], { ...io3, fetch: denied, now: NOW, config, credentials }), 1);
  assert.deepEqual(io3.out, ['ERR export: drive find: 403']);
  for (const line of [...io.out, ...io2.out, ...io3.out]) {
    for (const secret of [TOKEN, 'csecret', 'rtoken', '4242', '98765']) assert.ok(!line.includes(secret), `${line} leaks ${secret}`);
  }
});

test('export.mjs: bad arguments or a run dir without REPORT.md exit 2', async () => {
  const io = capture();
  assert.equal(await cli(['--bogus'], { ...io, config: { site: SITE, driveFolderId: FOLDER } }), 2);
  assert.equal(await cli([], { ...io, config: { site: SITE, driveFolderId: FOLDER } }), 2);
  const io2 = capture();
  const empty = tmp();
  assert.equal(await cli(['--run-dir', empty, '--dry-run'], { ...io2, now: NOW, config: { site: SITE, driveFolderId: FOLDER } }), 2);
  assert.deepEqual(io2.out, [`ERR export: no REPORT.md in ${empty}`]);
});
