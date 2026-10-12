// Playwright project `stack-teardown` (the teardown of `stack-setup`): stop what the stack helper
// started, unless the caller keeps the stack (run.mjs sets UI_CHECK_KEEP_STACK=1 for its children
// and stops the stack itself at the end).
import { test as teardown } from '@playwright/test';
import { stopStack, readStack } from './stack.mjs';
import { sweepAccounts, closeMinter } from './accounts.mjs';

teardown('stack down', async () => {
  // Safety net for the account suite: whatever a crashed worker left behind (throwaway users, a friendship with
  // testuser2, a renamed or photographed solo account) is removed here. Local sqlite only; never fails the run.
  if (readStack()) {
    try {
      const r = await sweepAccounts();
      console.log(`account sweep: deleted [${r.deleted}] restored [${r.restored}] photos [${r.photos}] friend rows ${r.friend_rows}`);
    } catch (e) {
      console.log(`account sweep skipped: ${String(e.message).split('\n')[0]}`);
    } finally {
      closeMinter();
    }
  }
  if (process.env.UI_CHECK_KEEP_STACK === '1') {
    console.log('stack: kept (UI_CHECK_KEEP_STACK=1)');
    return;
  }
  await stopStack();
});
