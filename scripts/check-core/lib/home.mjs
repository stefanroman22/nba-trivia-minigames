// Where the checkers keep everything they write (runs/, latest, stack.json, accounts.json, logs/, pw-output/, adhoc/).
//   UI_CHECK_HOME            explicit override
//   win32 + repo under OneDrive  %LOCALAPPDATA%\nba-ui-check  (OneDrive would sync thousands of JPEGs and slow the machine)
//   otherwise                <repo>/.ui-check  (git-ignored)
// ROOT is the checkout these scripts run from (the harness); the app under test may live elsewhere (a worktree).
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const ROOT = path.resolve(REPO);

export function uicHome() {
  if (process.env.UI_CHECK_HOME) return path.resolve(process.env.UI_CHECK_HOME);
  if (process.platform === 'win32' && /onedrive/i.test(REPO)) {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'nba-ui-check');
  }
  return path.join(REPO, '.ui-check');
}
