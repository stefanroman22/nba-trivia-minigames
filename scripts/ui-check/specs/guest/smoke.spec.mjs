// Temporary stack smoke check (Task 2); the guest suite proper replaces it in Task 3.
import { test } from '../../lib/fixtures.mjs';

test('[G-SMOKE] home page loads for a guest on the local stack', async ({ audit }) => {
  await audit.goto('/');
  await audit.layout();
  await audit.console();
  await audit.done();
});
