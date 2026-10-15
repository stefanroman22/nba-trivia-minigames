// Playwright project `stack-setup` (a dependency of every suite project, never of `selftest`):
// bring the local stack up for UI_CHECK_MODE (default prod) from UI_CHECK_REPO (default the main checkout) on
// UI_CHECK_PORTS (default the mode's ports), make sure the test accounts exist, and prove a minted token is
// accepted by the running API (same sqlite DB, same signing key).
// Idempotent: whatever already listens is reused and left alone at teardown.
import { test as setup } from '@playwright/test';
import { appRepo, ensureStack, readStack, waitForUrl } from './stack.mjs';
import { ensureAccounts, mintTokens, closeMinter, assertLocalApi } from './accounts.mjs';
import { activePorts } from '../../check-core/lib/ports.mjs';

setup('stack up', async () => {
  setup.setTimeout(20 * 60_000); // a cold prod build takes minutes
  const mode = process.env.UI_CHECK_MODE || 'prod';
  const ports = activePorts(mode);
  let stack;
  if (process.env.UI_CHECK_STACK_READY === '1') {
    // run.mjs already ensured the stack in its own process: only verify it, never start anything here.
    const rec = readStack({ ports });
    stack = { api: rec?.api || `http://localhost:${ports.django}/api`, base: rec?.base || `http://localhost:${ports.web}` };
    await waitForUrl(`${stack.api}/health/`, 30_000);
    await waitForUrl(stack.base, 30_000);
  } else {
    stack = await ensureStack(mode, { repo: appRepo(), ports });
  }
  assertLocalApi(stack.api);
  await ensureAccounts();
  const { testuser3 } = await mintTokens(['testuser3']);
  const res = await fetch(`${stack.api}/me/`, { headers: { Authorization: `Bearer ${testuser3.access}` } });
  closeMinter();
  if (res.status !== 200) {
    throw new Error(`a token minted in ${appRepo()}/backend/db.sqlite3 got HTTP ${res.status} from ${stack.api}/me/ — the running Django is not using that sqlite DB (or another secret key)`);
  }
});
