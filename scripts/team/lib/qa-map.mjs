// Turns "files touched" into "what QA must exercise" via .claude/team/qa-map.json (design §7).
// Map keys are globs (`**` = any depth, `*` = within a segment); values are
// { game?: string, games?: "*", routes?: string[], backend?: boolean }.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../../lib/team-config.mjs";
import { gameIdFor } from "./touched.mjs";

export const QA_MAP_PATH = resolve(ROOT, ".claude/team/qa-map.json");

export function loadQaMap(path = QA_MAP_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { re += ".*"; i++; if (glob[i + 1] === "/") i++; }
      else re += "[^/]*";
    } else if (/[.+?^${}()|[\]\\]/.test(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp("^" + re + "$");
}

/**
 * @returns {{ games: string[]|'*', routes: string[], backend: boolean, unmapped: string[] }}
 */
export function resolveQa(files, map) {
  const entries = Object.entries(map || {}).map(([g, v]) => ({ re: globToRegExp(g), v }));
  let games = [];
  let allGames = false;
  const routes = [];
  const unmapped = [];
  let backend = false;
  const addRoute = (r) => { if (!routes.includes(r)) routes.push(r); };
  const addGame = (g) => { if (g && !games.includes(g)) games.push(g); };

  for (const file of files || []) {
    const f = file.replace(/\\/g, "/");
    const hits = entries.filter((e) => e.re.test(f));
    const rendererId = gameIdFor(f);
    if (rendererId && /^src\/Game Renderers\//.test(f)) { addGame(rendererId); addRoute("/" + rendererId); }
    if (!hits.length) {
      if (!rendererId && /^src\//.test(f)) { unmapped.push(f); addRoute("/"); }
      if (/^backend\//.test(f)) { backend = true; addRoute("/"); }
      continue;
    }
    for (const { v } of hits) {
      if (v.games === "*") allGames = true;
      if (v.game) addGame(v.game);
      if (v.backend) backend = true;
      for (const r of v.routes || []) addRoute(r);
    }
  }
  return { games: allGames ? "*" : games, routes, backend, unmapped };
}
