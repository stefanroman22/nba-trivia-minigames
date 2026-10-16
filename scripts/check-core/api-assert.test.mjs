// node --test scripts/check-core/api-assert.test.mjs — API acceptance assertions: DSL validation, json paths, the
// evaluator, and runApiAssertion against a throwaway local http server (no Django).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { apiAssertionErrors, describeApiAssertion, evaluateApi, getPath, jsonPathParts, runApiAssertion } from './lib/api-assert.mjs';

const A = {
  api: { persona: 'guest', method: 'POST', path: '/api/signup/', body: { username: 'lgc1234', password: '1' } },
  expect: { status: 400, json: [['error', '==', 'password_too_short'], ['fields[0]', 'exists']] },
};

test('valid assertion has no errors; every bad field is named', () => {
  assert.deepEqual(apiAssertionErrors(A), []);
  const e = (a) => apiAssertionErrors(a).join('\n');
  assert.match(e({ ...A, route: '/' }), /unknown key "route"/);
  assert.match(e({ ...A, api: { ...A.api, persona: 'solo' } }), /api\.persona: must be one of guest, logic\.actor, logic\.peer, logic\.admin/);
  assert.match(e({ ...A, api: { ...A.api, method: 'post' } }), /api\.method/);
  assert.match(e({ ...A, api: { ...A.api, path: 'https://swishquest.com/api/' } }), /api\.path: must be a path on the Django origin/);
  assert.match(e({ ...A, api: { ...A.api, method: 'GET' } }), /a GET request has no body/);
  assert.match(e({ ...A, expect: { status: 99 } }), /expect\.status/);
  assert.match(e({ ...A, expect: { status: 400, json: [['error', '~=', 'x']] } }), /json\[0\]: operator must be one of/);
  assert.match(e({ ...A, expect: { status: 400, json: [['items[x]', '==', 1]] } }), /json\[0\]: invalid json path/);
  assert.match(e({ ...A, expect: { status: 400, json: [['n', '>', '3']] } }), /> needs a number/);
  assert.match(e({ ...A, expect: { status: 400, json: [['n', '==']] } }), /== needs a value/);
  assert.match(e({ ...A, expect: { status: 400, body: 'x' } }), /expect: unknown key "body"/);
});

test('json paths: dot, bracket, quoted', () => {
  assert.deepEqual(jsonPathParts('items[0].rank'), ['items', 0, 'rank']);
  assert.deepEqual(jsonPathParts('user.username'), ['user', 'username']);
  assert.deepEqual(jsonPathParts('[1]["a b"]'), [1, 'a b']);
  for (const bad of ['', '.a', 'a..b', 'a[', 'a b']) assert.throws(() => jsonPathParts(bad), /path/, bad);
  const body = { user: { username: 'x' }, items: [{ rank: 1 }, { rank: 2 }], n: null };
  assert.deepEqual(getPath(body, 'items[1].rank'), { found: true, value: 2 });
  assert.deepEqual(getPath(body, 'n'), { found: true, value: null });
  assert.equal(getPath(body, 'items[5].rank').found, false);
  assert.equal(getPath(body, 'user.username.length').found, false);
});

test('evaluateApi: every op; status mismatch and path miss are clean fails with one line each', () => {
  const res = (status, body, headers = {}) => ({ status, headers, text: typeof body === 'string' ? body : JSON.stringify(body) });
  const body = { error: 'password_too_short', total: 12, items: [{ rank: 1 }, { rank: 2 }], tags: ['a', 'b'], msg: 'Too short here' };
  const ok = evaluateApi({ status: 400, json: [['error', '==', 'password_too_short'], ['error', '!=', 'x'], ['total', '>', 11], ['total', '>=', 12], ['total', '<', 13],
    ['total', '<=', 12], ['tags', 'contains', 'b'], ['msg', 'contains', 'short'], ['items', 'contains', { rank: 2 }], ['items[0]', 'exists'], ['nope', 'exists', false]],
    headers: { 'Content-Type': 'json', 'X-Gone': null } }, res(400, body, { 'content-type': 'application/json' }));
  assert.equal(ok.outcome, 'pass', JSON.stringify(ok.lines));
  const bad = evaluateApi({ status: 201, json: [['error', '==', 'x'], ['user.id', '>', 0]] }, res(400, body));
  assert.equal(bad.outcome, 'fail');
  assert.match(bad.lines[0].text, /^status 400 \(expected 201\) — body \{"error"/);
  assert.equal(bad.lines[1].text, 'error: "password_too_short" (expected == "x")');
  assert.equal(bad.lines[2].text, 'user.id: missing (expected > 0)');
  assert.ok(bad.lines.every((l) => l.error === false));
  const html = evaluateApi({ status: 500, json: [['error', 'exists']] }, res(500, '<html>Server Error</html>'));
  assert.match(html.lines[1].text, /body is not JSON/);
  assert.match(describeApiAssertion(A), /^api guest · POST `\/api\/signup\/` \{.*\} ⇒ status 400; error == "password_too_short"; fields\[0\] exists$/);
});

test('runApiAssertion against a local server: token, body, pass, fail, error', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (d) => { data += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || null, body: data });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/me/') { res.statusCode = req.headers.authorization === 'Bearer T4' ? 200 : 401; res.end(JSON.stringify({ username: 'testuser4' })); return; }
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'password_too_short', fields: ['password'] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const pass = await runApiAssertion(A, { origin });
    assert.equal(pass.outcome, 'pass', JSON.stringify(pass.lines));
    assert.equal(pass.url, `${new URL(origin).origin}/api/signup/`);
    assert.deepEqual(JSON.parse(seen[0].body), A.api.body);
    assert.equal(seen[0].auth, null);
    const me = { api: { persona: 'logic.actor', method: 'GET', path: '/api/me/' }, expect: { status: 200, json: [['username', '==', 'testuser4']] } };
    assert.equal((await runApiAssertion(me, { origin, token: 'T4' })).outcome, 'pass');
    const wrong = await runApiAssertion(me, { origin, token: 'nope' });
    assert.equal(wrong.outcome, 'fail');
    assert.match(wrong.lines[0].text, /^status 401 \(expected 200\)/);
  } finally {
    await new Promise((r) => server.close(r));
  }
  const down = await runApiAssertion(A, { origin: 'http://127.0.0.1:9/', timeoutMs: 3000 });
  assert.equal(down.outcome, 'error');
  assert.match(down.lines[0].text, /could not be sent/);
});
