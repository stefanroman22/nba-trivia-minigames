// Where ui-check keeps everything it writes (runs/, latest, stack.json, accounts.json, logs/, pw-output/).
//   UI_CHECK_HOME            explicit override
//   win32 + repo under OneDrive  %LOCALAPPDATA%\nba-ui-check  (OneDrive would sync thousands of JPEGs and slow the machine)
//   otherwise                <repo>/.ui-check  (git-ignored)
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

export function uicHome() {
  if (process.env.UI_CHECK_HOME) return path.resolve(process.env.UI_CHECK_HOME);
  if (process.platform === 'win32' && /onedrive/i.test(REPO)) {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'nba-ui-check');
  }
  return path.join(REPO, '.ui-check');
}
