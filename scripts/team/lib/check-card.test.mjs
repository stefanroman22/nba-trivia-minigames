import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isCheckCard, findingsFileFrom, checkFields, findingsOf, ruleRef, rulesOfFindings,
  renderFinding, renderCheckFindings, withVerifyAssertion, verifyFilesOf, verifyArgs, parseVerifyOutput,
  verifyPlan, shipCommentText,
} from "./check-card.mjs";

const FINDING = {
  id: "UIC-20261014-1153-001",
  title: "Masked stranger \"Player\" still shows a permanent player ID (VS intro)",
  severity: "blocker", owner: "backend",
  where: { route: "/series-winner", viewports: ["pairA", "pairB"] },
  current: "The card prints the #ID.",
  expected: "A masked stranger shows no #ID tag.",
  files: [{ path: "multiplayer_server/src/index.js", line: 206, why: "publicUser still sends the id" }],
  fix: { change: ["send no public tag for a masked user"], reuse: ["maskedForStrangers"], build: [], rules: ["docs/legal/README.md", "MP-3", "RULE 6.2"] },
  acceptance: { checks: [{ id: "MP-MATCH-01", projects: ["mp@pairA"] }], assertions: [], criteria: ["tag lines disappear from MP-MATCH-01"] },
};

test("isCheckCard: ui-check / logic-check Source only", () => {
  assert.equal(isCheckCard({ source: "ui-check fp:abc ids:x run:y" }), true);
  assert.equal(isCheckCard({ source: "logic-check fp:abc" }), true);
  assert.equal(isCheckCard({ source: "" }), false);
  assert.equal(isCheckCard({ source: null }), false);
  assert.equal(isCheckCard({ source: "owner note about ui-check" }), false);
});

test("findingsFileFrom strips the ` (label)` get-spec appends to a File attached line", () => {
  const spec = [
    "intro",
    "[Image attached: C:\\x\\.team\\attachments\\p\\0.jpg]",
    "[File attached: C:\\x\\.team\\attachments\\p\\findings.json (findings.json)]",
  ].join("\n");
  assert.equal(findingsFileFrom(spec), "C:\\x\\.team\\attachments\\p\\findings.json");
  assert.equal(findingsFileFrom("[File attached: /r/.team/attachments/p/findings.json (findings.json)]"), "/r/.team/attachments/p/findings.json");
  // the label names it even when the download fell back to an index name
  assert.equal(findingsFileFrom("[File attached: /r/a/1.bin (findings.json)]"), "/r/a/1.bin");
  assert.equal(findingsFileFrom("[File attached: /r/a/notes.md (notes.md)]"), null);
  assert.equal(findingsFileFrom(""), null);
});

test("checkFields: defaults target dev, findingsFile only when readable", () => {
  const spec = "[File attached: /r/f/findings.json (findings.json)]";
  assert.deepEqual(checkFields({ source: "ui-check fp:a", target: "main" }, spec), { source: "ui-check fp:a", target: "main", findingsFile: "/r/f/findings.json" });
  assert.deepEqual(checkFields({}, spec, () => false), { source: null, target: "dev", findingsFile: null });
  assert.equal(checkFields({ target: "prod" }, "").target, "dev");
});

test("findingsOf accepts an array or { findings }", () => {
  assert.equal(findingsOf({ findings: [FINDING] }).length, 1);
  assert.equal(findingsOf([FINDING]).length, 1);
  assert.equal(findingsOf({ nope: 1 }), null);
  assert.equal(findingsOf([{ title: "no id" }]), null);
});

test("ruleRef maps prefixes to constraint docs; anything else is a plain reference", () => {
  assert.deepEqual(ruleRef("UI-23"), { id: "UI-23", doc: "docs/constraints/UI_SHELL_CONSTRAINTS.md" });
  assert.deepEqual(ruleRef("MP-3"), { id: "MP-3", doc: "docs/constraints/MULTIPLAYER_CONSTRAINTS.md" });
  assert.deepEqual(ruleRef("AUTH-12"), { id: "AUTH-12", doc: "docs/constraints/AUTH_CONSTRAINTS.md" });
  assert.deepEqual(ruleRef("BE-19"), { id: "BE-19", doc: "docs/constraints/BACKEND_CONSTRAINTS.md" });
  assert.deepEqual(ruleRef("RULE 6.2"), { id: "6.2", doc: "docs/GAME_DESIGN_CONSTRAINTS.md" });
  assert.deepEqual(ruleRef("WCAG 2.5.8"), { ref: "WCAG 2.5.8" });
  assert.deepEqual(ruleRef("color-contrast"), { ref: "color-contrast" });
  assert.deepEqual(ruleRef("docs/legal/README.md"), { ref: "docs/legal/README.md" });
});

test("rulesOfFindings groups ids per doc and keeps other references", () => {
  const r = rulesOfFindings([FINDING, { id: "b", fix: { rules: ["MP-3", "UI-7"] } }]);
  assert.deepEqual(r.docs, ["docs/constraints/MULTIPLAYER_CONSTRAINTS.md", "docs/GAME_DESIGN_CONSTRAINTS.md", "docs/constraints/UI_SHELL_CONSTRAINTS.md"]);
  assert.deepEqual([...r.byDoc.get("docs/constraints/MULTIPLAYER_CONSTRAINTS.md")], ["MP-3"]);
  assert.deepEqual(r.refs, ["docs/legal/README.md"]);
});

test("renderFinding: heading, meta line, verbatim fields and acceptance", () => {
  const md = renderFinding(FINDING).join("\n");
  assert.match(md, /^### UIC-20261014-1153-001 · Masked stranger "Player"/);
  assert.match(md, /\nblocker · backend · route \/series-winner · viewports pairA, pairB\n/);
  assert.match(md, /\*\*Current:\*\* The card prints the #ID\./);
  assert.match(md, /\*\*Expected:\*\* A masked stranger shows no #ID tag\./);
  assert.match(md, /- multiplayer_server\/src\/index\.js:206 — publicUser still sends the id/);
  assert.match(md, /- Change: send no public tag for a masked user/);
  assert.match(md, /- Reuse: maskedForStrangers/);
  assert.match(md, /- Rules: docs\/legal\/README\.md, MP-3, RULE 6\.2/);
  assert.match(md, /\*\*Acceptance:\*\*\n- tag lines disappear from MP-MATCH-01\n- check MP-MATCH-01 @ mp@pairA passes/);
});

test("renderFinding caps a long finding at 60 lines", () => {
  const big = { ...FINDING, fix: { ...FINDING.fix, change: Array.from({ length: 100 }, (_, i) => `step ${i}`) } };
  const lines = renderFinding(big);
  assert.equal(lines.length, 60);
  assert.match(lines.at(-1), /more line\(s\) of UIC-20261014-1153-001 in the findings file/);
});

test("renderCheckFindings caps the section at 400 lines and says how many were left out", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ ...FINDING, id: `F-${i}`, fix: { ...FINDING.fix, change: Array.from({ length: 30 }, (_, j) => `c${j}`) } }));
  const md = renderCheckFindings(many, { file: "/r/findings.json" });
  const n = md.split("\n").length;
  assert.ok(n <= 400, `got ${n} lines`);
  assert.match(md, /^Source of truth: `\/r\/findings\.json` \(30 finding\(s\)\)/);
  assert.match(md, /more finding\(s\) not shown/);
  assert.doesNotMatch(renderCheckFindings([FINDING]), /not shown/);
});

test("withVerifyAssertion keeps earlier entries and holds exactly one verify entry", () => {
  const prev = [{ route: "/", selector: "main", expect: "visible" }, { verify: "/old.json" }];
  assert.deepEqual(withVerifyAssertion(prev, "/new.json"), [{ route: "/", selector: "main", expect: "visible" }, { verify: "/new.json" }]);
  assert.deepEqual(withVerifyAssertion(null, "/f.json"), [{ verify: "/f.json" }]);
});

test("verifyFilesOf parses verify assertions only", () => {
  assert.deepEqual(verifyFilesOf([{ route: "/" }, { verify: " /a/findings.json " }, { verify: "" }, null, { flow: "x" }]), ["/a/findings.json"]);
  assert.deepEqual(verifyFilesOf([]), []);
});

test("verifyArgs: --from, dev mode, the worktree and the lane's ports (vite = web)", () => {
  assert.deepEqual(verifyArgs({ root: "/main", file: "/f.json", repo: "/wt", ports: { django: 8101, socket: 4101, vite: 5274 } }),
    ["/main/scripts/ui-check/verify.mjs", "--from", "/f.json", "--mode", "dev", "--repo", "/wt", "--ports", "django=8101,socket=4101,web=5274", "--keep-stack"]);
});

test("parseVerifyOutput: every FAIL line is a failure verbatim", () => {
  const out = [
    "verify: app /wt",
    "FAIL UIC-1 — check MP-MATCH-01 @ mp@pairA: teen-masking `.om-pc-tag` on /series-winner: #G8 (expected none)",
    "PASS UIC-2 — 1 criteria pass",
    "verify: 2 finding(s) · 1 pass · 1 fail · 120s · mode dev · detail /x",
  ].join("\n");
  const r = parseVerifyOutput(out, "", 1);
  assert.deepEqual(r.failures, ["FAIL UIC-1 — check MP-MATCH-01 @ mp@pairA: teen-masking `.om-pc-tag` on /series-winner: #G8 (expected none)"]);
  assert.equal(r.passes.length, 1);
  assert.match(r.summary, /^verify: 2 finding\(s\)/);
});

test("parseVerifyOutput: all PASS and exit 0 is a pass", () => {
  const r = parseVerifyOutput("PASS A — 2 criteria pass\nverify: 1 finding(s) · 1 pass · 0 fail", "", 0);
  assert.deepEqual(r.failures, []);
});

test("parseVerifyOutput: non-zero exit without verdict lines is an infra failure with the last 3 lines", () => {
  const r = parseVerifyOutput("", "one\ntwo\nthree\nverify: stack (dev) did not come up: boom — see /log", 1);
  assert.deepEqual(r.failures, ["verify infra: two | three | verify: stack (dev) did not come up: boom — see /log"]);
});

test("parseVerifyOutput: no verdict line is never a silent pass, even on exit 0", () => {
  assert.equal(parseVerifyOutput("", "", 0).failures.length, 1);
  assert.match(parseVerifyOutput("", "", null).failures[0], /^verify infra: exit \? with no output/);
  assert.match(parseVerifyOutput("PASS A — ok\nverify: 1 finding(s) · 1 pass · 0 fail", "", 1).failures[0], /^verify exit 1 with 1 PASS line/);
});

test("parseVerifyOutput: verdict lines must add up to the summary count", () => {
  const short = parseVerifyOutput("PASS A — ok\nverify: 2 finding(s) · 1 pass · 1 fail", "", 1);
  assert.equal(short.failures.length, 1);
  assert.match(short.failures[0], /^verify infra: 1 PASS \+ 0 FAIL line\(s\) but the summary counts 2/);
  const none = parseVerifyOutput("PASS A — ok", "", 0);
  assert.match(none.failures[0], /^verify infra: 1 PASS \+ 0 FAIL line\(s\) but no summary line/);
  // a FAIL line is still reported verbatim next to the infra line
  const both = parseVerifyOutput("FAIL A — x", "", 1);
  assert.equal(both.failures[0], "FAIL A — x");
  assert.match(both.failures[1], /^verify infra: 0 PASS \+ 1 FAIL/);
});

test("verifyPlan: a check card is known from card.json, not only from the brief", () => {
  const card = { source: "ui-check fp:a", findingsFile: "/att/findings.json" };
  assert.deepEqual(verifyPlan(card, []), { check: true, files: ["/att/findings.json"], error: null });
  assert.deepEqual(verifyPlan(card, [{ verify: "/brief.json" }]), { check: true, files: ["/brief.json"], error: null });
  assert.deepEqual(verifyPlan({ source: "logic-check fp:b", findingsFile: null }, [{ route: "/" }]), { check: true, files: [], error: "check card without findings attachment" });
  assert.deepEqual(verifyPlan({ source: null, findingsFile: "/f.json" }, []), { check: true, files: ["/f.json"], error: null });
  assert.deepEqual(verifyPlan({ source: null }, [{ route: "/" }]), { check: false, files: [], error: null });
  assert.deepEqual(verifyPlan(null, []), { check: false, files: [], error: null });
});

test("shipCommentText: dev, main and the relay PR", () => {
  assert.equal(shipCommentText({ sha: "abcdef1234", devUrl: "https://dev" }), "✅ on dev (abcdef1) — check https://dev");
  assert.match(shipCommentText({ sha: "abcdef1234", target: "main" }), /^✅ on main \(abcdef1\) — production/);
  const pr = shipCommentText({ sha: "abcdef1234", target: "main", pr: "https://github.com/o/r/pull/9" });
  assert.ok(pr.includes("PR to main: https://github.com/o/r/pull/9"));
  assert.match(pr, /Merge the PR and run `cd multiplayer_server && railway up` in the same window; do not untick Needs human/);
});
