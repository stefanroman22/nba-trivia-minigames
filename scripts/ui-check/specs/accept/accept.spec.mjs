// Acceptance assertions from findings (project `accept`), run by verify.mjs / probe.mjs / report.mjs --validate.
// UI_CHECK_ASSERT_FILE is a JSON list of { findingId, n, assertion, label }. One test per assertion, titled
// `[ACCEPT <findingId>#<n>] …`, grouped per persona + viewport (one describe each, with that viewport's context options
// and the persona's minted session through the shared fixtures). Each test writes <runDir>/accept/<findingId>-<n>.json
// ({ outcome: pass|fail|error, lines, shot, url }) and fails unless the assertion passes. Without the env: no tests.
// @catalog-family ACCEPT
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '../../lib/fixtures.mjs';
import { contextOptions } from '../../lib/viewports.mjs';
import { runDir } from '../../lib/run-id.mjs';
import { runAssertion } from '../../lib/accept.mjs';

const FILE = process.env.UI_CHECK_ASSERT_FILE;
const items = FILE ? JSON.parse(readFileSync(FILE, 'utf8')) : [];

const groups = new Map();
for (const it of items) {
  const key = `${it.assertion.persona} @ ${it.assertion.viewport}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(it);
}

for (const [key, list] of groups) {
  const { persona, viewport } = list[0].assertion;
  test.describe(key, () => {
    test.use({ ...contextOptions(viewport), vpId: viewport, persona });
    for (const it of list) {
      test(`[ACCEPT ${it.findingId}#${it.n}] ${it.label || ''}`.trim(), async ({ page, audit }) => {
        test.setTimeout(120_000);
        const r = await runAssertion({ page, audit, assertion: it.assertion });
        const out = path.join(runDir(), 'accept', `${it.findingId}-${it.n}.json`);
        mkdirSync(path.dirname(out), { recursive: true });
        writeFileSync(out, JSON.stringify({ findingId: it.findingId, n: it.n, ...r }, null, 2));
        if (r.outcome !== 'pass') throw new Error(`${r.outcome}: ${r.lines.filter((l) => !l.ok).map((l) => l.text).join(' | ')}`);
      });
    }
  });
}
