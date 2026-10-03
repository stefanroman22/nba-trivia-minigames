import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTouched, gameIdFor } from "./touched.mjs";

test("docs-only diff", () => {
  const c = classifyTouched(["docs/team/RETRO.md", "README.md"]);
  assert.equal(c.docsOnly, true);
  assert.equal(c.frontend, false);
  assert.equal(c.backend, false);
  assert.equal(c.motion, false);
});

test("renderer diff names its game", () => {
  const c = classifyTouched(["src/Game Renderers/CareerPath.tsx", "src/styles/CareerPath.css"]);
  assert.equal(c.frontend, true);
  assert.deepEqual(c.games, ["career-path"]);
  assert.equal(c.docsOnly, false);
});

test("motion paths and framer-motion imports flag motion", () => {
  assert.equal(classifyTouched(["src/motion/tokens.ts"]).motion, true);
  assert.equal(classifyTouched(["src/components/motion/SwapText.tsx"]).motion, true);
  const withDiff = classifyTouched(["src/components/FriendsPanel.tsx"], '+import SwapText from "../components/motion/SwapText";\n+import { motion } from "framer-motion";');
  assert.equal(withDiff.motion, true);
  assert.equal(classifyTouched(["src/components/FriendsPanel.tsx"], "+const x = 1;").motion, false);
  assert.equal(classifyTouched(["src/styles/Friends.css"], "+.a { transition: opacity .2s; }").motion, true);
});

test("protected backend paths", () => {
  const c = classifyTouched(["backend/users/views.py"]);
  assert.equal(c.backend, true);
  assert.equal(c.protected, true);
  assert.equal(classifyTouched(["backend/trivia/games/contexto.py"]).protected, false);
  assert.equal(classifyTouched(["multiplayer_server/src/index.js"]).multiplayer, true);
});

test("gameIdFor maps renderer names", () => {
  assert.equal(gameIdFor("PlayOffSeries.tsx"), "series-winner");
  assert.equal(gameIdFor("GuessMvps.tsx"), "guess-mvps");
  assert.equal(gameIdFor("RenderGame.tsx"), null);
});
