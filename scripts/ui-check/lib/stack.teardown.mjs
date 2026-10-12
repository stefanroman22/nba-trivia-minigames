// Playwright project `stack-teardown` (the teardown of `stack-setup`): stop what the stack helper
// started, unless the caller keeps the stack (run.mjs sets UI_CHECK_KEEP_STACK=1 for its children
// and stops the stack itself at the end).
import { test as teardown } from '@playwright/test';
import { stopStack } from './stack.mjs';

teardown('stack down', async () => {
  if (process.env.UI_CHECK_KEEP_STACK === '1') {
    console.log('stack: kept (UI_CHECK_KEEP_STACK=1)');
    return;
  }
  await stopStack();
});
