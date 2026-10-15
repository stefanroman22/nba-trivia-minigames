// node --test scripts/check-core/verify-api.test.mjs — verify-core's API assertions and `lc` criteria without a real
// stack: a throwaway UI_CHECK_HOME whose stack.json points the prod ports' api at a local http server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = mkdtempSync(path.join(os.tmpdir(), 'verify-api-'));
process.env.UI_CHECK_HOME = home;
process.env.UI_CHECK_MODE = 'prod';
delete process.env.UI_CHECK_PORTS;

const { verifyFindings } = await import('../ui-check/lib/verify-core.mjs');
const { LOGIC_RUN } = await import('../ui-check/lib/runner.mjs');

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/health/') { res.end(JSON.stringify({ status: 'ok', db: true })); return; }
  res.statusCode = 404;
  res.end(JSON.stringify({ detail: 'Not found.' }));
});

async function withServer(fn) {
  await new Promise((r) => server.listen(0, 'localhost', r));
  const api = `http://localhost:${server.address().port}/api`;
  mkdirSync(home, { recursive: true });
  writeFileSync(path.join(home, 'stack.json'), JSON.stringify({ stacks: { '8200-4200-5374': { mode: 'prod', ports: { django: 8200, socket: 4200, web: 5374 }, api } }, started: [] }));
  try { return await fn(); } finally { await new Promise((r) => server.close(r)); }
}

const finding = (id, acceptance) => ({ id, acceptance: { criteria: ['x'], ...acceptance } });
const health = (expect) => ({ api: { persona: 'guest', method: 'GET', path: '/api/health/' }, expect });

test('API assertions: pass, clean fail, persona mint error; lc without the runner is an error, never a verdict', async () => {
  await withServer(async () => {
    const out = await verifyFindings([
      finding('F-PASS', { assertions: [health({ status: 200, json: [['status', '==', 'ok'], ['db', '==', true]] })] }),
      finding('F-FAIL', { assertions: [health({ status: 200, json: [['status', '==', 'degraded']] }), health({ status: 503 })] }),
      finding('F-MINT', { assertions: [{ api: { persona: 'logic.actor', method: 'GET', path: '/api/me/' }, expect: { status: 200 } }] }),
      ...(existsSync(LOGIC_RUN) ? [] : [finding('F-LC', { checks: [{ lc: 'LC-AUTH-01', projects: ['api'] }] })]),
    ], { runId: 'adhoc/test', log: path.join(home, 'verify.log'), mode: 'prod', say: () => {} });
    const by = Object.fromEntries(out.map((r) => [r.id, r]));
    assert.equal(by['F-PASS'].outcome, 'pass', JSON.stringify(by['F-PASS'].criteria));
    assert.equal(by['F-FAIL'].outcome, 'fail');
    assert.deepEqual(by['F-FAIL'].criteria.map((c) => c.outcome), ['fail', 'fail']);
    assert.equal(by['F-FAIL'].criteria[0].lines[1].text, 'status: "ok" (expected == "degraded")');
    assert.match(by['F-FAIL'].criteria[1].lines[0].text, /^status 200 \(expected 503\)/);
    assert.equal(by['F-FAIL'].firstLine, 'assertion #1: status: "ok" (expected == "degraded")');
    assert.equal(by['F-MINT'].outcome, 'error');
    assert.match(by['F-MINT'].criteria[0].lines[0].text, /^token for logic\.actor: /);
    if (by['F-LC']) {
      assert.equal(by['F-LC'].outcome, 'error');
      assert.deepEqual(by['F-LC'].criteria.map((c) => [c.label, c.lines[0].text]), [['check LC-AUTH-01 @ api', 'logic-check runner not installed (scripts/logic-check/run.mjs)']]);
    }
  });
});

test('expect-fail verdict: a clean API fail reproduces; an error never does', async () => {
  await withServer(async () => {
    const [r] = await verifyFindings([finding('F-REPRO', { assertions: [health({ status: 503 }), health({ status: 200 })] })],
      { runId: 'adhoc/test2', expectFail: true, log: path.join(home, 'verify.log'), mode: 'prod', say: () => {} });
    assert.equal(r.asExpected, true);
    assert.deepEqual(r.guards, ['assertion #2']);
  });
});

test('a non-local API base is an error, not a request', async () => {
  writeFileSync(path.join(home, 'stack.json'), JSON.stringify({ stacks: { '8200-4200-5374': { mode: 'prod', ports: { django: 8200, socket: 4200, web: 5374 }, api: 'https://swishquest.com/api' } }, started: [] }));
  const [r] = await verifyFindings([finding('F-REMOTE', { assertions: [health({ status: 200 })] })], { runId: 'adhoc/test3', log: path.join(home, 'verify.log'), mode: 'prod', say: () => {} });
  assert.equal(r.outcome, 'error');
  assert.match(r.criteria[0].lines[0].text, /refusing to use test accounts — API base is "https:\/\/swishquest\.com\/api"/);
});
