import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOG_FORMAT, ESTIMATE_NOTE, parseLog, readCommits, isoWeek, rowOf, rowsOf, summarize, renderMarkdown, renderHtml, esc } from "./cost-report.mjs";
import { inputRates } from "./cost.mjs";

const REGISTRY = {
  aliases: {
    fable: { id: "claude-fable-5-2", name: "Fable 5.2", usdPerMTok: { input: 8, output: 40 } },
    opus: { id: "claude-opus-5-5", name: "Opus 5.5", usdPerMTok: { input: 4, output: 20 } },
    sonnet: { id: "claude-sonnet-5-5", name: "Sonnet 5.5", usdPerMTok: { input: 2, output: 10 } },
    haiku: { id: "claude-haiku-5-5", name: "Haiku 5.5", usdPerMTok: { input: 0.1, output: 0.5 } },
  },
};
const OPTS = { registry: REGISTRY, rates: inputRates(REGISTRY) };

// The real commit d518383 (git log -1 --format=%B d518383): shipped before the ledger, so it has no Cost line.
const REAL = {
  sha: "d518383c345c0b0878e919e83329ff97cba304e0", date: "2026-11-01T09:17:10+00:00",
  subject: "fix: [ui-check] Friend lobby game name 'Guess the Series Winner' is truncated at desktop-1366",
  body: `Notion: https://app.notion.com/p/ui-check-Friend-lobby-game-name-Guess-the-Series-Winner-is-truncated-at-desktop-1366-40b2cfb1c59581e09b27fd889cb7f6ef
Category: frontend

## Agent notes
- agent: frontend-engine
  did: FriendPlay.css .fp-meta-name wraps (overflow-wrap anywhere) instead of nowrap/ellipsis; .fp-meta column-gap 12px -> 8px
  assumed: card may grow one line for long names; title attribute kept as fallback

## Review notes (nits, not blocking)
- FriendPlay.tsx:204 comment still says the name "truncates"; it now wraps
- column-gap 12px -> 8px is not required for the fix
- title fallback on .fp-meta-game is now redundant but harmless

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Y3SCU1DfBXwjsoyEvW3UC2`,
};
const WITH_COST = {
  sha: "1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", date: "2026-11-24T09:00:00+01:00",
  subject: "feat: Daily streak <b>badge</b> on the profile | header",
  body: `Notion: https://app.notion.com/p/Daily-streak-badge-4202cfb1c595813aa44bf3d1f73b8836
Category: fullstack
Cost: tier=standard engine=sonnet effort=high plan=sonnet review=fable spawns=6 tokens=812345 models=sonnet:612345,fable:200000 fix=verify:1,qa:0,review:1 minutes=23

## Agent notes
- agent: backend-engine
  did: streak endpoint
  assumed: none
- agent: frontend-engine
  did: badge
  assumed: none

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`,
};
const CLEAN = {
  sha: "2222222aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", date: "2026-11-20T22:00:00+00:00",
  subject: "fix(ui-check): close the Rank up! modal before Close game in GM-LATENCY",
  body: `Notion: https://app.notion.com/p/check-bug-GM-LATENCY-wordle-4122cfb1c59581fba9a5fa4bc0fcf861
Category: pipeline
Cost: tier=trivial engine=haiku effort=low review=sonnet spawns=3 tokens=90000 models=haiku:50000,sonnet:40000 fix=verify:0,qa:0,review:0 minutes=6

## Agent notes
- agent: backend-engine
  did: x
  assumed: none

Co-Authored-By: Claude <noreply@anthropic.com>`,
};
const NOT_A_CARD = { sha: "3333333aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", date: "2026-11-22T10:00:00+00:00", subject: "docs(team): retro for hero-pill", body: "The card https://app.notion.com/p/x failed.\nSee Notion: later." };
const COMMITS = [WITH_COST, CLEAN, NOT_A_CARD, REAL];
const rawLog = (commits) => commits.map((c) => `${c.sha}\x1f${c.date}\x1f${c.subject}\x1f${c.body}\n\x1e`).join("\n");

/** A stand-in for git: answers rev-parse for the refs it knows and `log` with the fixture, and records the calls. */
function fakeGit(refs, commits = COMMITS) {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    if (args[0] === "rev-parse") { if (refs.includes(args[args.length - 1].replace("^{commit}", ""))) return "abc\n"; throw new Error("unknown ref"); }
    if (args[0] === "log") return rawLog(commits);
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
  return { git, calls };
}

test("parseLog splits records and keeps multi-line bodies", () => {
  const parsed = parseLog(rawLog(COMMITS));
  assert.equal(parsed.length, 4);
  assert.deepEqual(parsed[3], REAL);
  assert.equal(parsed[0].subject, WITH_COST.subject);
  assert.deepEqual(parseLog(""), []);
});

test("readCommits reads the ref, falls back when asked to, and passes --since", () => {
  const a = fakeGit(["origin/dev", "HEAD"]);
  const got = readCommits({ since: "2 weeks ago", fallback: "HEAD", git: a.git });
  assert.equal(got.ref, "origin/dev");
  assert.equal(got.commits.length, 4);
  assert.deepEqual(a.calls[a.calls.length - 1], ["log", "origin/dev", `--format=${LOG_FORMAT}`, "--since=2 weeks ago"]);
  const b = fakeGit(["HEAD"]);
  assert.equal(readCommits({ fallback: "HEAD", git: b.git }).ref, "HEAD");
  assert.deepEqual(b.calls[b.calls.length - 1], ["log", "HEAD", `--format=${LOG_FORMAT}`]);
  assert.throws(() => readCommits({ ref: "origin/nope", git: fakeGit(["HEAD"]).git }), /origin\/nope does not exist/);
  assert.throws(() => readCommits({ fallback: "HEAD", git: fakeGit([]).git }), /does not exist/);
});

test("the real pre-ledger commit: what the commit says, and null for the rest", () => {
  const row = rowOf(REAL, OPTS);
  assert.equal(row.date, "2026-11-01");
  assert.equal(row.week, "2026-W44");
  assert.equal(row.type, "fix");
  assert.equal(row.title, "[ui-check] Friend lobby game name 'Guess the Series Winner' is truncated at desktop-1366");
  assert.equal(row.source, "ui-check");
  assert.equal(row.category, "frontend");
  assert.deepEqual(row.engines, ["frontend-engine"]);
  assert.equal(row.orchestrator, "Fable 5.1");
  assert.equal(row.cost, null);
  assert.equal(row.tokens, null);
  assert.equal(row.fixRounds, null);
  assert.equal(row.estimateUsd, null);
});

test("a commit with a Cost line", () => {
  const row = rowOf(WITH_COST, OPTS);
  assert.equal(row.title, "Daily streak <b>badge</b> on the profile | header");
  assert.equal(row.source, "card");
  assert.equal(row.category, "fullstack");
  assert.deepEqual(row.engines, ["backend-engine", "frontend-engine"]);
  assert.equal(row.orchestrator, "sonnet");
  assert.equal(row.week, "2026-W48");
  assert.equal(row.cost.engine, "sonnet");
  assert.equal(row.tokens, 812345);
  assert.equal(row.fixRounds, 2);
  assert.ok(Math.abs(row.estimateUsd - 2.82469) < 1e-9);
});

test("source kind: the subject tag, else the card's name in the Notion URL, else card", () => {
  const src = (subject, url = "https://app.notion.com/p/Some-card-0123") => rowOf({ sha: "a", date: "2026-11-01", subject, body: `Notion: ${url}\n` }).source;
  assert.equal(src("fix: [check-bug] LC-SIGNUP-03: numeric only"), "check-bug");
  assert.equal(src("fix: [security] Weekly scan 2026-11-20: 2 high"), "security");
  assert.equal(src("feat: [seo] Sitemap lastmod"), "seo");
  assert.equal(src("fix: [logic-check] Sign-up answers 500 for a non-string password"), "logic-check");
  assert.equal(src("[ui-check] no type prefix"), "ui-check");
  assert.equal(src("fix: Hero pill wraps"), "card");
  assert.equal(src("fix: [wip] Hero pill"), "card");
  assert.equal(rowOf(CLEAN, OPTS).source, "check-bug");
  assert.equal(rowOf(CLEAN, OPTS).orchestrator, null);
  assert.equal(src("fix: Hero pill", "https://app.notion.com/p/40b2cfb1c595819580a6c0fee09c78a9"), "card");
  assert.equal(rowOf(NOT_A_CARD, OPTS), null);
  assert.equal(rowOf({ sha: "a", date: "", subject: "fix: x", body: "Notion: https://n/p/x-1" }).category, null);
});

test("a cherry-pick -x copy of a card in the list is one ship, not two", () => {
  const copy = { ...WITH_COST, sha: "9999999aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", body: `${WITH_COST.body}\n(cherry picked from commit ${WITH_COST.sha})` };
  assert.deepEqual(rowsOf([copy, WITH_COST, REAL], OPTS).map((r) => r.sha), [WITH_COST.sha, REAL.sha]);
  assert.equal(summarize(rowsOf([copy, WITH_COST], OPTS)).tokens, 812345);
  // the original is outside the range read: the copy is the only record of that ship, so it stays
  assert.deepEqual(rowsOf([copy, REAL], OPTS).map((r) => r.sha), [copy.sha, REAL.sha]);
});

test("isoWeek follows ISO 8601 at year boundaries", () => {
  assert.deepEqual(isoWeek("2026-11-25"), { key: "2026-W48", monday: "2026-11-23" });
  assert.equal(isoWeek("2027-01-01").key, "2026-W53");
  assert.equal(isoWeek("2024-12-30").key, "2025-W01");
  assert.equal(isoWeek("2026-01-04T23:00:00+01:00").key, "2026-W01");
  assert.equal(isoWeek("soon"), null);
});

test("totals: per category, per engine model, per ISO week", () => {
  const rows = rowsOf(COMMITS, OPTS);
  assert.equal(rows.length, 3);
  const sum = summarize(rows);
  assert.equal(sum.cards, 3);
  assert.equal(sum.withCost, 2);
  assert.equal(sum.tokens, 902345);
  assert.ok(Math.abs(sum.estimateUsd - (2.82469 + (50000 * 0.1 + 40000 * 2) / 1e6)) < 1e-9);
  assert.equal(sum.fixShare, 0.5);
  assert.equal(sum.meanFix, 1);
  assert.deepEqual(sum.byCategory.map((g) => g.key).sort(), ["frontend", "fullstack", "pipeline"]);
  const frontend = sum.byCategory.find((g) => g.key === "frontend");
  assert.deepEqual([frontend.cards, frontend.withCost, frontend.tokens, frontend.estimateUsd, frontend.fixShare, frontend.meanFix], [1, 0, null, null, null, null]);
  assert.deepEqual(sum.byModel.map((g) => [g.key, g.cards]).sort(), [["haiku", 1], ["n/a", 1], ["sonnet", 1]]);
  assert.deepEqual(sum.byWeek.map((g) => g.key), ["2026-W48", "2026-W47", "2026-W44"]);
  assert.deepEqual(sum.tokensByModel, [{ key: "sonnet", tokens: 652345 }, { key: "fable", tokens: 200000 }, { key: "haiku", tokens: 50000 }]);
  const empty = summarize([]);
  assert.deepEqual([empty.cards, empty.tokens, empty.estimateUsd, empty.fixShare], [0, null, null, null]);
});

test("markdown: one line per card, n/a where the commit says nothing, the estimate caveat", () => {
  const rows = rowsOf(COMMITS, OPTS);
  const md = renderMarkdown(rows, { ref: "origin/dev", since: "2 weeks ago" });
  assert.ok(md.includes(ESTIMATE_NOTE));
  assert.ok(md.includes("3 cards shipped, 2 with a `Cost:` line, 902,345 tokens, $2.91"));
  const cardLines = md.split("\n").filter((l) => /^\| 2026-\d\d-\d\d \|/.test(l));
  assert.equal(cardLines.length, 3);
  assert.ok(cardLines[0].includes("| sonnet | 6 | 812,345 | v1 q0 r1 | 23 | $2.82 |"));
  assert.ok(cardLines[0].includes("\\| header"), "a pipe in a title cannot break the table");
  assert.ok(cardLines[2].endsWith("| ui-check | frontend | frontend-engine | n/a | n/a | n/a | n/a | n/a | n/a | n/a |"));
  for (const h of ["## Per category", "## Per engine model", "## Per ISO week"]) assert.ok(md.includes(h), h);
  assert.ok(md.includes("| frontend | 1 | 0 | n/a | n/a | n/a | n/a |"));
  assert.ok(md.includes("| 2026-W48 | 1 | 1 | 812,345 | $2.82 | 100% | 2.0 |"));
});

test("html: self-contained, one row per card, totals in the tiles, titles escaped", () => {
  const rows = rowsOf(COMMITS, OPTS);
  const html = renderHtml(rows, { ref: "origin/dev", generatedAt: "2026-11-25 10:00 UTC", rates: OPTS.rates });
  assert.ok(html.startsWith("<!doctype html>"));
  const cards = html.slice(html.indexOf('<table id="cards">'), html.indexOf("</table>", html.indexOf('<table id="cards">')));
  assert.equal((cards.match(/<tr>/g) || []).length, rows.length + 1, "a header row and one row per card");
  assert.equal((cards.match(/<th[ >]/g) || []).length, 13);
  // the title's markup is text, not markup
  assert.ok(cards.includes("Daily streak &lt;b&gt;badge&lt;/b&gt; on the profile | header"));
  assert.ok(!html.includes("<b>badge</b>"));
  // tiles
  const tiles = [...html.matchAll(/<div class="tile"><div class="label">([^<]*)<\/div><div class="value">([^<]*)<\/div>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(tiles, [["Cards shipped", "3"], ["Cards with cost data", "2"], ["Total tokens", "902K"], ["Estimated $", "$2.91"]]);
  assert.ok(html.includes(ESTIMATE_NOTE));
  // three charts, inline SVG
  assert.equal((html.match(/<figure class="card">/g) || []).length, 3);
  assert.equal((html.match(/<svg /g) || []).length, 3);
  // sortable and filterable, dark by default with a light variant
  assert.ok(html.includes('id="filter"') && html.includes("aria-sort"));
  assert.ok(html.includes("color-scheme:dark") && html.includes("@media (prefers-color-scheme: light)"));
  assert.ok(html.includes('name="viewport"'));
  // no external request: no URL to fetch anywhere in the page
  assert.ok(!/(?:src|href)\s*=|@import|url\(|https?:\/\//i.test(html));
  assert.equal((html.match(/<script>/g) || []).length, 1);
  // sort keys: numbers raw, unknown empty so it sorts last
  assert.ok(cards.includes('<td class="num" data-v="812345">812,345</td>'));
  assert.ok(cards.includes('<td class="num na" data-v="">n/a</td>'));
});

test("html: no cost data and no cards still render", () => {
  const old = renderHtml(rowsOf([REAL], OPTS), {});
  assert.equal((old.match(/No cost data in this range yet\./g) || []).length, 2);
  assert.equal((old.match(/<svg /g) || []).length, 1);
  assert.ok(old.includes('<div class="value">n/a</div>'));
  const none = renderHtml([], {});
  assert.equal((none.match(/No cost data in this range yet\./g) || []).length, 3);
  assert.ok(none.includes("0 cards"));
  assert.equal(esc(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
});

test("the page written to disk is the page rendered (outside the repo)", () => {
  const dir = mkdtempSync(join(tmpdir(), "team-costs-"));
  try {
    const file = join(dir, "costs.html");
    const html = renderHtml(rowsOf(COMMITS, OPTS), { ref: "HEAD" });
    writeFileSync(file, html);
    assert.equal(readFileSync(file, "utf8"), html);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
