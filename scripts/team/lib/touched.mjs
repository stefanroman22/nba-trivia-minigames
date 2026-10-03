// Classifies the files a card touched so the orchestrator can pick gates and reviewers from data
// instead of judgment (design §4–§5): which checks verify runs, whether QA runs at all, whether the
// motion reviewer wakes, whether the review needs the heavy model.
import { execFileSync } from "node:child_process";

// Renderer file name (without .tsx) -> catalogue id in src/utils/GameUtils.tsx.
const RENDERER_TO_ID = {
  BingoGame: "bingo",
  CareerPath: "career-path",
  ConnectionsGame: "connections",
  Contexto: "contexto",
  FanFavorites: "fan-favorites",
  GuessMvps: "guess-mvps",
  HeatmapGame: "heatmap",
  ImposterGame: "imposter",
  NameLogo: "name-logo",
  NbaGrid: "nba-grid",
  PackFive: "pack-five",
  PlayOffSeries: "series-winner",
  StartingFive: "starting-five",
  SuperDraft: "superdraft",
  TicTacToe: "tictactoe",
  WhoAreYa: "who-are-ya",
  WhoWouldWin: "who-would-win",
  Wordle: "wordle",
};

const PROTECTED_RES = [
  /^backend\/users\//,
  /^backend\/[^/]+\/settings\.py$/,
  /^backend\/trivia\/data_pipeline\//,
  /^multiplayer_server\/src\//,
  /^src\/utils\/Api\.tsx$/,
  /^src\/app\/providers\.tsx$/,
  /^\.github\/workflows\//,
];

const MOTION_PATH_RE = /^src\/(motion\/|components\/motion\/)/;
const MOTION_DIFF_RE = /^\+.*(framer-motion|\btransition\s*:|\banimation\s*:|@keyframes)/m;
const DOC_RE = /^(docs\/|[^/]+\.md$|\.claude\/|infra\/|\.team\/)/;

export function gameIdFor(fileName) {
  const base = String(fileName).replace(/^.*[\\/]/, "").replace(/\.tsx$/, "");
  return RENDERER_TO_ID[base] || null;
}

/**
 * @param {string[]} files repo-relative, forward slashes
 * @param {string} [diffText] unified diff; only "+" lines are inspected for motion markers
 */
export function classifyTouched(files, diffText = "") {
  const norm = (files || []).map((f) => f.replace(/\\/g, "/"));
  const games = [];
  for (const f of norm) {
    const m = f.match(/^src\/Game Renderers\/([^/]+)\.tsx$/);
    if (m && RENDERER_TO_ID[m[1]] && !games.includes(RENDERER_TO_ID[m[1]])) games.push(RENDERER_TO_ID[m[1]]);
  }
  const frontend = norm.some((f) => /^(src\/|package\.json$|next\.config|tsconfig|eslint\.config|tailwind|postcss)/.test(f));
  const backend = norm.some((f) => /^backend\//.test(f));
  const multiplayer = norm.some((f) => /^multiplayer_server\//.test(f));
  const scripts = norm.some((f) => /^scripts\//.test(f));
  const docsOnly = norm.length > 0 && norm.every((f) => DOC_RE.test(f));
  const motion = norm.some((f) => MOTION_PATH_RE.test(f)) || MOTION_DIFF_RE.test(String(diffText || ""));
  const isProtected = norm.some((f) => PROTECTED_RES.some((re) => re.test(f)));
  return { frontend, backend, multiplayer, scripts, docsOnly, motion, protected: isProtected, games, files: norm };
}

function git(repoDir, args) {
  return execFileSync("git", ["-C", repoDir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

/** Committed (base...HEAD) + uncommitted + untracked files, deduplicated. */
export function touchedFiles(repoDir, baseSha) {
  const out = new Set();
  const add = (txt) => txt.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).forEach((f) => out.add(f.replace(/\\/g, "/")));
  try { add(git(repoDir, ["diff", "--name-only", `${baseSha}...HEAD`])); } catch { /* base may equal HEAD */ }
  try { add(git(repoDir, ["diff", "--name-only", "HEAD"])); } catch { /* no commits */ }
  try { add(git(repoDir, ["ls-files", "--others", "--exclude-standard"])); } catch { /* ignore */ }
  return [...out].filter((f) => !/^\.team\//.test(f));
}

/** Unified diff text for the same range, used for the motion marker check. */
export function diffText(repoDir, baseSha) {
  let txt = "";
  try { txt += git(repoDir, ["diff", `${baseSha}...HEAD`]); } catch { /* ignore */ }
  try { txt += git(repoDir, ["diff", "HEAD"]); } catch { /* ignore */ }
  return txt;
}
