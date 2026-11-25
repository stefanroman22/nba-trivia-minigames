// The cost line of a shipped card (docs/team/PIPELINE.md §19). Pure functions (no I/O): the fields of a run
// (state.json + classify.json), the one-line trailer the ship skill puts in the commit body, its parser, and the
// dollar estimate. The commit is the ledger: nothing here reads or writes a shared file.
//
//   Cost: tier=standard engine=sonnet effort=high plan=sonnet review=fable spawns=6 tokens=812345
//         models=sonnet:612345,fable:200000 fix=verify:1,qa:0,review:1 minutes=23      (one line in the commit)
//
// key=value pairs separated by single spaces, no space inside a value. A key whose value is unknown is left out:
// a number the harness did not report is never estimated.

export const COST_PREFIX = "Cost: ";
export const GATES = Object.freeze(["verify", "qa", "review"]);
/** Tokens of spawns recorded without a model (the per-model split still sums to `tokens`). */
export const NO_MODEL = "unknown";

const clean = (v) => {
  const s = typeof v === "string" || typeof v === "number" ? String(v).trim().toLowerCase().replace(/[^a-z0-9._+-]+/g, "-").replace(/^-+|-+$/g, "") : "";
  return s || null;
};
const int = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
const last = (list) => (list.length ? list[list.length - 1] : null);

/** The alias (`sonnet`) of a model given as an alias, an id (`claude-sonnet-5-5`) or a name (`Sonnet 5.5`); anything else comes back trimmed, or null. */
export function modelAlias(value, registry) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  const low = raw.toLowerCase().replace(/^claude\s+/, "");
  for (const [alias, m] of Object.entries(registry?.aliases || {})) {
    if (low === alias || raw.toLowerCase() === String(m.id || "").toLowerCase() || low === String(m.name || "").toLowerCase()) return alias;
  }
  return raw;
}

/**
 * The cost fields of one run. Every key is present; null means "not known".
 *   { tier, engine, effort, plan, review, spawns, tokens, models, unmetered, fix, minutes }
 * `tokens` is the sum over the spawns that reported a number (null when none did), `models` the same sum per
 * model, `unmetered` how many spawns reported none, `minutes` the time from `startedAt` to `now`.
 */
export function costFields({ state = {}, classify = {}, now = Date.now() } = {}) {
  const st = state || {};
  const cl = classify || {};
  const spawns = Array.isArray(st.spawns) ? st.spawns.filter((s) => s && typeof s === "object") : [];
  const at = (...stages) => spawns.filter((s) => stages.includes(s.stage));
  const metered = spawns.filter((s) => int(s.tokens) !== null);
  const models = {};
  for (const s of metered) {
    const key = clean(s.model) || NO_MODEL;
    models[key] = (models[key] || 0) + s.tokens;
  }
  const reviews = at("review");
  const reviewer = last(reviews.filter((s) => s.agent === "code-reviewer")) || last(reviews);
  const started = Date.parse(st.startedAt);
  const rounds = st.fixRounds && typeof st.fixRounds === "object" ? st.fixRounds : null;
  return {
    tier: clean(cl.difficulty) || clean(st.tier),
    engine: clean(cl.engineModel) || clean(last(at("build"))?.model),
    effort: clean(cl.engineEffort),
    plan: clean(last(at("plan", "design"))?.model),
    review: clean(reviewer?.model),
    spawns: spawns.length,
    tokens: metered.length ? metered.reduce((n, s) => n + s.tokens, 0) : null,
    models: metered.length ? models : null,
    unmetered: spawns.length - metered.length,
    fix: rounds ? Object.fromEntries(GATES.map((g) => [g, int(rounds[g]) ?? 0])) : null,
    minutes: Number.isFinite(started) && now >= started ? Math.round((now - started) / 60000) : null,
  };
}

/** The trailer line for fields in the shape `costFields` returns; null when nothing is known. */
export function formatCost(fields) {
  const f = fields || {};
  const pairs = [];
  const put = (k, v) => { if (v !== null && v !== undefined && v !== "") pairs.push(`${k}=${v}`); };
  for (const k of ["tier", "engine", "effort", "plan", "review"]) put(k, clean(f[k]));
  put("spawns", int(f.spawns));
  put("tokens", int(f.tokens));
  if (f.models && Object.keys(f.models).length) {
    const split = Object.entries(f.models).filter(([, n]) => int(n) !== null).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    put("models", split.map(([m, n]) => `${clean(m) || NO_MODEL}:${n}`).join(","));
  }
  if (int(f.unmetered)) put("unmetered", f.unmetered);
  if (f.fix) put("fix", GATES.map((g) => `${g}:${int(f.fix[g]) ?? 0}`).join(","));
  put("minutes", int(f.minutes));
  return pairs.length ? COST_PREFIX + pairs.join(" ") : null;
}

const pairsOf = (text, valueOf) => {
  const out = {};
  for (const part of String(text).split(",")) {
    const i = part.lastIndexOf(":");
    if (i <= 0) return null;
    const v = valueOf(part.slice(i + 1));
    if (v === null) return null;
    out[part.slice(0, i)] = v;
  }
  return out;
};
const num = (v) => (/^\d+$/.test(v) ? int(Number(v)) : null);

/**
 * The fields of the first `Cost:` line in a text (a trailer line or a whole commit body), in the shape
 * `costFields` returns; null when there is none. Unknown keys are ignored, a malformed value reads as null.
 */
export function parseCost(text) {
  const m = /^Cost:[ \t]+(\S.*)$/m.exec(String(text || ""));
  if (!m) return null;
  const raw = {};
  for (const part of m[1].trim().split(/\s+/)) {
    const i = part.indexOf("=");
    if (i > 0 && !(part.slice(0, i) in raw)) raw[part.slice(0, i)] = part.slice(i + 1);
  }
  const has = (k) => Object.hasOwn(raw, k);
  const fix = has("fix") ? pairsOf(raw.fix, num) : null;
  const spawns = has("spawns") ? num(raw.spawns) : null;
  return {
    tier: clean(raw.tier), engine: clean(raw.engine), effort: clean(raw.effort), plan: clean(raw.plan), review: clean(raw.review),
    spawns,
    tokens: has("tokens") ? num(raw.tokens) : null,
    models: has("models") ? pairsOf(raw.models, num) : null,
    unmetered: has("unmetered") ? num(raw.unmetered) : spawns === null ? null : 0,
    fix: fix ? Object.fromEntries(GATES.map((g) => [g, fix[g] ?? 0])) : null,
    minutes: has("minutes") ? num(raw.minutes) : null,
  };
}

/** Fix rounds of a card over all gates; null when the line has no `fix=`. */
export const fixRounds = (cost) => (cost?.fix ? GATES.reduce((n, g) => n + (cost.fix[g] || 0), 0) : null);

/** { alias: USD per million input tokens } from .claude/models.json (`usdPerMTok.input`). */
export function inputRates(registry) {
  const out = {};
  for (const [alias, m] of Object.entries(registry?.aliases || {})) {
    const rate = m?.usdPerMTok?.input;
    if (typeof rate === "number" && rate >= 0) out[alias] = rate;
  }
  return out;
}

/** Tokens per model of a parsed line: its `models` split, or all of `tokens` on the engine model when it has none. */
export function tokensByModel(cost) {
  if (!cost || cost.tokens === null) return null;
  if (cost.models && Object.keys(cost.models).length) return cost.models;
  return { [cost.engine || NO_MODEL]: cost.tokens };
}

/**
 * API-equivalent dollars of a parsed line: every token priced at its model's list INPUT rate (agent traffic is
 * overwhelmingly input and cache reads, which cost less). null when there are no tokens, or when a model has
 * no rate: a partial sum would read as the whole.
 */
export function estimateUsd(cost, rates) {
  const split = tokensByModel(cost);
  if (!split) return null;
  let usd = 0;
  for (const [model, tokens] of Object.entries(split)) {
    if (typeof rates?.[model] !== "number") return null;
    usd += (tokens * rates[model]) / 1e6;
  }
  return usd;
}
