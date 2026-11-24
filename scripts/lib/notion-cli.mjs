// The one way a script talks to the Notion board: through scripts/notion.mjs, one process per call (that file
// holds the only Notion HTTP client and the token). Shipped-ness comes from git. `spawn` is injectable for tests.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT } from './team-config.mjs';

export function cliClient({ root = ROOT, spawn = spawnSync } = {}) {
  const notion = (...a) => {
    const r = spawn(process.execPath, [path.join(root, 'scripts', 'notion.mjs'), ...a], { cwd: root, encoding: 'utf8', maxBuffer: 32 << 20 });
    if (r.status !== 0) throw new Error(`notion.mjs ${a[0]} failed: ${(r.stderr || r.stdout || '').trim().split('\n').pop()}`);
    return r.stdout.trim();
  };
  let fetched = false;
  return {
    notion,
    findCards: (keys) => JSON.parse(notion('find-cards', ...keys.flatMap((k) => ['--source-fp', k])) || '[]'),
    listComments: (id) => JSON.parse(notion('list-comments', id) || '[]'),
    comment: (id, text) => notion('comment', id, text),
    /** m: { title, category, priority, source, difficulty?, target? (dev), status? (To Do) } → the new page id. */
    createCard: (m, bodyFile, attach = []) => notion('create-card', m.title, '--category', m.category, '--priority', m.priority,
      ...(m.difficulty ? ['--difficulty', m.difficulty] : []), '--source', m.source, '--target', m.target || 'dev',
      ...(m.status ? ['--status', m.status] : []), '--body-file', bodyFile, ...attach.flatMap((f) => ['--attach', f])).split(/\r?\n/).pop(),
    isShipped: (sha) => {
      if (!fetched) { spawn('git', ['fetch', '--quiet', 'origin', 'main'], { cwd: root }); fetched = true; }
      return spawn('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], { cwd: root }).status === 0;
    },
  };
}
