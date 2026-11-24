// A ticket: the unit the ticket-writer and feedback-triage agents hand to the board, and what a card body is
// rendered from. Pure functions (no I/O): validation, the card body, the dedupe fingerprint, and reading the
// acceptance criteria back out of any card's spec so the brief and the reviewer work from the same list.
//
//   { title, category, priority, difficulty?, context, scope[], acceptance[], out_of_scope?[], files?[],
//     depends_on?[], evidence?[] }
//
// The rule every ticket must meet: at least one acceptance criterion, each an outcome someone can check.
import { createHash } from 'node:crypto';
import { CATEGORIES } from '../../lib/team-config.mjs';

export const PRIORITIES = ['P0', 'P1', 'P2'];
export const DIFFICULTIES = ['trivial', 'standard', 'hard'];
export const LIMITS = { title: 90, context: 1200, item: 400, tickets: 40, acceptance: 8, scope: 10 };
const KNOWN = new Set(['title', 'category', 'priority', 'difficulty', 'context', 'scope', 'acceptance', 'out_of_scope', 'files', 'depends_on', 'evidence']);
// A criterion that names no observable outcome cannot fail, so it cannot be checked.
const VAGUE = /^(it |the (feature|change|fix|page|game) )?(just )?(works?|is (done|fixed|implemented|complete)|looks? (good|fine|nice)|no (bugs?|errors?|issues?))( (well|fine|correctly|properly|as expected))?\.?$/i;

const str = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const list = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/** Problems of one ticket as sentences ("" prefix); an empty list means valid. */
export function ticketProblems(t, where = 'ticket') {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return [`${where}: must be an object.`];
  const out = [];
  const bad = (msg) => out.push(`${where}: ${msg}`);
  for (const k of Object.keys(t)) if (!KNOWN.has(k)) bad(`unknown key "${k}".`);
  const title = str(t.title);
  if (!title) bad('"title" is required.');
  else if (title.length > LIMITS.title) bad(`"title" is ${title.length} characters; the limit is ${LIMITS.title}.`);
  if (!CATEGORIES.includes(t.category)) bad(`"category" must be one of ${CATEGORIES.join(', ')}.`);
  if (!PRIORITIES.includes(t.priority)) bad(`"priority" must be ${PRIORITIES.join(', ')}.`);
  if (t.difficulty != null && !DIFFICULTIES.includes(t.difficulty)) bad(`"difficulty" must be ${DIFFICULTIES.join(', ')} or absent.`);
  const context = str(t.context);
  if (!context) bad('"context" is required: what is wrong or missing today, and why it matters.');
  else if (context.length > LIMITS.context) bad(`"context" is over ${LIMITS.context} characters.`);
  const scope = list(t.scope);
  if (!scope.length) bad('"scope" needs at least one item: what to change.');
  if (scope.length > LIMITS.scope) bad(`"scope" has ${scope.length} items; split the ticket (limit ${LIMITS.scope}).`);
  const acceptance = list(t.acceptance);
  if (!acceptance.length) bad('"acceptance" needs at least one criterion.');
  if (acceptance.length > LIMITS.acceptance) bad(`"acceptance" has ${acceptance.length} criteria; split the ticket (limit ${LIMITS.acceptance}).`);
  acceptance.forEach((a, i) => {
    if (a.length < 15 || VAGUE.test(a)) bad(`acceptance[${i}] ("${a}") names no outcome that can be checked.`);
    if (/^\d+[.)]\s/.test(a)) bad(`acceptance[${i}] must not start with a number (the pipeline reads numbered lines as plan steps).`);
  });
  if (new Set(acceptance.map((a) => a.toLowerCase())).size !== acceptance.length) bad('"acceptance" repeats a criterion.');
  for (const k of ['scope', 'acceptance', 'out_of_scope', 'files', 'depends_on']) {
    if (t[k] != null && !Array.isArray(t[k])) bad(`"${k}" must be a list.`);
    for (const item of list(t[k])) if (item.length > LIMITS.item) bad(`an item of "${k}" is over ${LIMITS.item} characters.`);
  }
  return out;
}

/** { ok, problems, tickets } for a whole document ({ tickets: [...] }); tickets are normalized copies. */
export function validateTickets(doc) {
  const raw = doc && Array.isArray(doc.tickets) ? doc.tickets : null;
  if (!raw) return { ok: false, problems: ['The document must be { "tickets": [ … ] }.'], tickets: [] };
  const problems = [];
  if (!raw.length) problems.push('No tickets.');
  if (raw.length > LIMITS.tickets) problems.push(`${raw.length} tickets; the limit per run is ${LIMITS.tickets}.`);
  raw.forEach((t, i) => problems.push(...ticketProblems(t, `tickets[${i}]`)));
  const tickets = raw.map(normalize);
  const titles = tickets.map((t) => t.title.toLowerCase());
  titles.forEach((t, i) => { if (t && titles.indexOf(t) !== i) problems.push(`tickets[${i}]: the title repeats tickets[${titles.indexOf(t)}].`); });
  tickets.forEach((t, i) => {
    for (const d of t.depends_on) if (!titles.includes(d.toLowerCase())) problems.push(`tickets[${i}]: depends_on "${d}" is not the title of a ticket in this document.`);
  });
  return { ok: !problems.length, problems, tickets };
}

export function normalize(t) {
  const o = t && typeof t === 'object' ? t : {};
  return {
    title: str(o.title), category: o.category, priority: o.priority, ...(o.difficulty ? { difficulty: o.difficulty } : {}),
    context: str(o.context), scope: list(o.scope), acceptance: list(o.acceptance), out_of_scope: list(o.out_of_scope),
    files: list(o.files), depends_on: list(o.depends_on),
    evidence: Array.isArray(o.evidence) ? o.evidence.filter((e) => Number.isInteger(e)) : [],
  };
}

/** A stable key for a ticket: the same title (case, punctuation and spacing aside) is the same ticket. */
export const fingerprint = (title) => createHash('sha256').update(str(title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).digest('hex').slice(0, 12);

/** The card's Source: "<kind> fp:<key> run:<id>", the form find-cards --source-fp dedupes on. */
export const sourceOf = (kind, key, runId) => `${kind} fp:${key} run:${runId}`;

/**
 * The card body in notion.mjs's markdown-lite. Criteria are bullets with ids (AC1…), never numbered lines:
 * scripts/team/lib/steps.mjs reads numbered lines as an implementation plan.
 */
export function renderTicket(t, { note = '' } = {}) {
  const bullets = (items) => items.map((x) => `- ${x}`).join('\n');
  return [
    '## Context', t.context, '',
    '## Scope', bullets(t.scope), '',
    '## Acceptance criteria', t.acceptance.map((a, i) => `- AC${i + 1}: ${a}`).join('\n'), '',
    ...(t.out_of_scope.length ? ['## Out of scope', bullets(t.out_of_scope), ''] : []),
    ...(t.files.length ? ['## Where to look', bullets(t.files.map((f) => `\`${f}\``)), ''] : []),
    ...(t.depends_on.length ? ['## Depends on', bullets(t.depends_on), ''] : []),
    ...(note ? [note, ''] : []),
  ].join('\n');
}

/**
 * The acceptance criteria written on a card, whoever wrote it: the bullets under a heading that starts with
 * "Acceptance" ("## Acceptance criteria", "Acceptance:"), up to the next heading. → [{ id: "AC1", text }]
 */
export function acceptanceOf(spec) {
  const out = [];
  let inside = false;
  for (const raw of String(spec || '').split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^(#{1,6}\s+|\*\*)?acceptance\b[^\n]*$/i.test(line) && !/^[-*]\s/.test(line);
    if (heading) { inside = true; continue; }
    if (inside && /^#{1,6}\s+\S/.test(line)) inside = false;
    if (!inside) continue;
    const m = /^[-*]\s+(?:\[[ x]\]\s*)?(?:AC\d+\s*[:.)-]\s*)?(.+)$/i.exec(line);
    if (m) out.push({ id: `AC${out.length + 1}`, text: m[1].trim() });
  }
  return out;
}

/** The brief's own list (the card's criteria, or the planner's when the card had none): the one the reviewer checks. */
export const BRIEF_ACCEPTANCE = '## Acceptance (what the reviewer checks)';
export function briefAcceptance(briefText) {
  const text = String(briefText || '');
  const start = text.indexOf(`${BRIEF_ACCEPTANCE}\n`);
  if (start < 0) return [];
  const rest = text.slice(start + BRIEF_ACCEPTANCE.length + 1);
  const end = rest.search(/^## /m);
  return acceptanceOf(`## Acceptance\n${end < 0 ? rest : rest.slice(0, end)}`);
}
