// Playwright project `stack-teardown` of Logic Check (the teardown of ui-check's `stack-setup`): the Logic sweep
// (scope 'logic': lgc<digits> throwaways deleted, testuser4/5/6 names and photos restored, friendships / requests /
// blocks among them cleared — local sqlite only, never fails the run), then stop what the stack helper started unless
// UI_CHECK_KEEP_STACK=1 (run.mjs keeps it for its children and stops it itself).
import { test as teardown } from '@playwright/test';
import { readStack, stopStack } from '../../ui-check/lib/stack.mjs';
import { activePorts } from '../../check-core/lib/ports.mjs';
import { closeMinter, sweepAccounts } from '../../check-core/lib/accounts.mjs';

teardown('stack down', async () => {
  if (readStack()) {
    try {
      const r = await sweepAccounts({ scope: 'logic' });
      console.log(`logic sweep: ${JSON.stringify(r)}`);
    } catch (e) {
      console.log(`logic sweep skipped: ${String(e.message).split('\n')[0]}`);
    } finally {
      closeMinter();
    }
  }
  if (process.env.UI_CHECK_KEEP_STACK === '1') {
    console.log('stack: kept (UI_CHECK_KEEP_STACK=1)');
    return;
  }
  await stopStack({ ports: activePorts() });
});
