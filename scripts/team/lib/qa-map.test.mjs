import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveQa, globToRegExp } from "./qa-map.mjs";

const MAP = {
  "src/Game Renderers/CareerPath.tsx": { game: "career-path", routes: ["/career-path"] },
  "src/components/ScorePanel.tsx": { games: "*", routes: ["/"] },
  "src/components/ui/**": { games: "*", routes: ["/"] },
  "backend/users/**": { routes: ["/"], backend: true },
  "src/app/page.tsx": { routes: ["/"] },
};

test("globToRegExp handles ** and *", () => {
  assert.equal(globToRegExp("src/components/ui/**").test("src/components/ui/Button.tsx"), true);
  assert.equal(globToRegExp("src/components/ui/**").test("src/components/ux/Button.tsx"), false);
  assert.equal(globToRegExp("src/views/Leaderboard*").test("src/views/Leaderboard.tsx"), true);
});

test("a renderer maps to its game and route", () => {
  const r = resolveQa(["src/Game Renderers/CareerPath.tsx"], MAP);
  assert.deepEqual(r.games, ["career-path"]);
  assert.deepEqual(r.routes, ["/career-path"]);
  assert.equal(r.backend, false);
});

test("a shared component expands to all games", () => {
  const r = resolveQa(["src/components/ScorePanel.tsx", "src/Game Renderers/CareerPath.tsx"], MAP);
  assert.equal(r.games, "*");
  assert.deepEqual(r.routes, ["/", "/career-path"]);
});

test("backend paths set backend and keep routes", () => {
  const r = resolveQa(["backend/users/views.py"], MAP);
  assert.equal(r.backend, true);
  assert.deepEqual(r.routes, ["/"]);
  assert.deepEqual(r.games, []);
});

test("unmapped frontend files fall back to the home route", () => {
  const r = resolveQa(["src/hooks/useThing.ts"], MAP);
  assert.deepEqual(r.routes, ["/"]);
  assert.deepEqual(r.unmapped, ["src/hooks/useThing.ts"]);
});
