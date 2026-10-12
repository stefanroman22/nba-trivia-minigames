// Playwright project `stack-setup` (a dependency of every suite project, never of `selftest`):
// bring the local stack up for UI_CHECK_MODE (default prod), make sure the test accounts exist, and
// prove a minted token is accepted by the running API (same sqlite DB, same signing key).
// Idempotent: whatever already listens is reused and left alone at teardown.
import { test as setup } from '@playwright/test';
import { ensureStack } from './stack.mjs';
import { ensureAccounts, mintTokens, closeMinter, assertLocalApi } from './accounts.mjs';

setup('stack up', async () => {
  setup.setTimeout(20 * 60_000); // a cold prod build takes minutes
  const mode = process.env.UI_CHECK_MODE || 'prod';
  const stack = await ensureStack(mode);
  assertLocalApi(stack.api);
  await ensureAccounts();
  const { testuser3 } = await mintTokens(['testuser3']);
  const res = await fetch(`${stack.api}/me/`, { headers: { Authorization: `Bearer ${testuser3.access}` } });
  closeMinter();
  if (res.status !== 200) {
    throw new Error(`a token minted in backend/db.sqlite3 got HTTP ${res.status} from ${stack.api}/me/ — the running Django is not using the local sqlite DB (or another secret key)`);
  }
});
