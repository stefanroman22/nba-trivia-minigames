// The sign-up validation matrix as data (spec §5 signup row), derived once from the app under test:
//   backend/users/views.py signup_view   check order: required fields → consent → USERNAME_RE → moderation (severe /
//                                         reserved / mild) → validate_email → banned email → validate_password →
//                                         email taken (409) → create (201)
//   backend/users/consent.py             check_consent: accepted_terms / age_confirmed must be JSON true; an under-13
//                                         birth date is refused even with the box ticked
//   backend/users/moderation_text.py     generic messages; "Dick" (mild) and "admin1" (reserved) per
//                                         users/test_moderation.py. Never a severe word: a severe name at sign-up
//                                         counts against the caller's IP and the third locks sign-ups for 24 h.
//   backend/backend/settings.py          AUTH_PASSWORD_VALIDATORS (similarity, min length, common, numeric)
//   src/utils/passwordRules.ts           the frontend's stated password rules (frontendRules below)
// Each row isolates ONE branch: every other field is valid, so a row the backend accepts (201) is a validation gap.
// Branches deliberately NOT in the matrix: the severe moderation tier (a severe name at sign-up strikes the caller's
// IP and the third locks sign-ups from it for 24 h), a banned account's email (409, needs a banned account; answered
// exactly like a taken email), and the IP-locked sign-up (403 signup_locked, needs three severe attempts).
// LC-SIGNUP-00 compares frontendRules() with backendRules() and checks every literal message below still exists in
// the backend source (a stale matrix fails there, not as a wall of case failures).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { appRepo } from '../../ui-check/lib/stack.mjs';

export const SOURCES = {
  views: 'backend/users/views.py',
  consent: 'backend/users/consent.py',
  moderation: 'backend/users/moderation_text.py',
  settings: 'backend/backend/settings.py',
  passwordRules: 'src/utils/passwordRules.ts',
  consentTs: 'src/utils/consent.ts',
  form: 'src/components/LogInSignUp.tsx',
};

export const readApp = (rel, repo = appRepo()) => { try { return readFileSync(path.join(repo, rel), 'utf8').replace(/^﻿/, ''); } catch { return null; } };

/** Backend messages the matrix expects. A string is a literal that must exist in `src` (LC-SIGNUP-00 provenance);
 *  a RegExp is Django's own wording (django.contrib.auth.password_validation) or an f-string. */
export const MSG = {
  required: { text: 'All fields are required.', src: 'views' },
  usernameRules: { text: 'Username must be 3-20 characters using letters, numbers or underscores.', src: 'views' },
  nameBlocked: { text: "That name isn't allowed. Please choose another.", src: 'moderation' },
  nameReserved: { text: 'That name is reserved. Please choose another.', src: 'moderation' },
  emailInvalid: { text: "That email address doesn't look valid.", src: 'views' },
  emailInUse: { text: 'Email already in use! Please use a different email address.', src: 'views' },
  consentRequired: { text: "Please confirm you're 13 or older and agree to the Terms and Privacy Policy.", src: 'consent' },
  ageBlocked: { text: /^You need to be at least 13 years old to create an account\.$/, src: 'consent' },
  pwShort: { text: /^This password is too short\. It must contain at least 8 characters\.$/, src: 'django' },
  pwCommon: { text: /^This password is too common\.$/, src: 'django' },
  pwNumeric: { text: /^This password is entirely numeric\.$/, src: 'django' },
  pwSimilar: { text: /too similar to the (username|email)/i, src: 'django' },
  anyError: { text: /\S/, src: 'none' }, // a non-string password: any 400 message, as long as it is a 400
};

/**
 * The matrix rows for one run. `name(i)` → a throwaway username `lgc<digits>` for row i (distinct per row, so a row
 * the backend wrongly accepts creates its own account, which the check deletes); `password` → a strong password (the
 * test-account password); `takenEmail` → an existing account's email (logic.actor's).
 * → [{ category, case, body, expectStatus, expectError: { text, code? }, creates? }]
 */
export function signupMatrix({ name, password, takenEmail, today = new Date() }) {
  let i = 0;
  const row = (category, kase, patch, expectStatus, msg, code) => {
    const n = name(++i);
    const base = { username: n, email: `${n}@uicheck.test`, password, accepted_terms: true, age_confirmed: true };
    const body = typeof patch === 'function' ? patch(base, n) : { ...base, ...patch };
    return { category, case: kase, body, expectStatus, expectError: { text: msg.text, ...(code ? { code } : {}) } };
  };
  const omit = (k) => (b) => { const c = { ...b }; delete c[k]; return c; };
  const S = MSG;
  return [
    // username: required, USERNAME_RE ^[A-Za-z0-9_]{3,20}$ (every branch), moderation (mild, reserved)
    row('username', 'empty', { username: '' }, 400, S.required),
    row('username', 'too short (2)', { username: 'ab' }, 400, S.usernameRules),
    row('username', 'too long (21)', (b, n) => ({ ...b, username: `${n}${'x'.repeat(21 - n.length)}` }), 400, S.usernameRules),
    row('username', 'bad chars (space, !)', { username: 'lgc check!' }, 400, S.usernameRules),
    row('username', 'bad chars (hyphen)', { username: 'lgc-1234' }, 400, S.usernameRules),
    row('username', 'bad chars (accent)', { username: 'lgcé1234' }, 400, S.usernameRules),
    row('username', 'moderated word, mild ("Dick")', { username: 'Dick' }, 400, S.nameBlocked),
    row('username', 'moderated word, reserved ("admin1")', { username: 'admin1' }, 400, S.nameReserved),
    // email: required, validate_email, taken (unique, case-insensitive) — taken is checked after the password
    row('email', 'missing', omit('email'), 400, S.required),
    row('email', 'invalid (no @)', { email: 'not-an-email' }, 400, S.emailInvalid),
    // (not `x@localhost`: Django's EmailValidator allow-lists the localhost domain)
    row('email', 'invalid (no top-level domain)', { email: 'lgc@uicheck' }, 400, S.emailInvalid),
    row('email', 'taken (logic.actor)', { email: takenEmail }, 409, S.emailInUse),
    row('email', 'taken, other case', { email: takenEmail.toUpperCase() }, 409, S.emailInUse),
    // password: required + every AUTH_PASSWORD_VALIDATORS validator, one at a time
    row('password', 'empty', { password: '' }, 400, S.required),
    row('password', 'too short (7)', { password: 'Qx7!vRm' }, 400, S.pwShort),
    row('password', 'common ("password123")', { password: 'password123' }, 400, S.pwCommon),
    row('password', 'numeric only', { password: '48213957604' }, 400, S.pwNumeric),
    row('password', 'similar to the username', (b, n) => ({ ...b, password: `${n}x` }), 400, S.pwSimilar),
    // JSON non-strings: request.data keeps the type, so these reach validate_password as an int / a bool
    row('password', '12345678 (JSON number)', { password: 12345678 }, 400, S.anyError),
    row('password', 'true (JSON boolean)', { password: true }, 400, S.anyError),
    // consent: both flags must be JSON true; an under-13 birth date is refused even with the box ticked
    row('consent', 'accepted_terms missing', omit('accepted_terms'), 400, S.consentRequired, 'consent_required'),
    row('consent', 'accepted_terms false', { accepted_terms: false }, 400, S.consentRequired, 'consent_required'),
    row('consent', 'accepted_terms "true" (string)', { accepted_terms: 'true' }, 400, S.consentRequired, 'consent_required'),
    row('consent', 'age_confirmed missing', omit('age_confirmed'), 400, S.consentRequired, 'consent_required'),
    row('consent', 'age_confirmed false', { age_confirmed: false }, 400, S.consentRequired, 'consent_required'),
    row('consent', 'birth date under 13', (b) => { const c = { ...b, birth_year: today.getFullYear() - 5, birth_month: 1 }; delete c.age_confirmed; return c; }, 400, S.ageBlocked, 'age_requirement'),
  ];
}

/** The happy path rows (LC-SIGNUP-05): a new account, and the same display name again (names are not unique). */
export function happyRows({ name, password }) {
  const n = name(90);
  return {
    happy: { category: 'happy', case: 'new account', body: { username: n, email: `${n}@uicheck.test`, password, accepted_terms: true, age_confirmed: true }, expectStatus: 201 },
    repeat: { category: 'happy', case: 'repeated display name, other email', body: { username: n, email: `${n}r@uicheck.test`, password, accepted_terms: true, age_confirmed: true }, expectStatus: 201 },
  };
}

/** Django's built-in validators by the frontend rule that mirrors them. */
export const VALIDATOR_OF = {
  length: 'MinimumLengthValidator',
  numeric: 'NumericPasswordValidator',
  similar: 'UserAttributeSimilarityValidator',
  common: 'CommonPasswordValidator',
};

/**
 * The frontend's stated rules (src/utils/passwordRules.ts, LogInSignUp.tsx, utils/consent.ts):
 * → { minLength, rules: [{ key, label }], serverOnly: [key], usernamePattern, consentText, problems: [] }
 * `serverOnly`: rules the file declares as checked by the server only ("Too common" can only be checked by the server).
 */
export function frontendRules(repo = appRepo()) {
  const problems = [];
  const src = readApp(SOURCES.passwordRules, repo);
  if (!src) return { minLength: null, rules: [], serverOnly: [], usernamePattern: null, consentText: null, problems: [`${SOURCES.passwordRules} not found`] };
  const rules = [...src.matchAll(/\{\s*key:\s*"(\w+)",\s*label:\s*"([^"]+)"/g)].map((m) => ({ key: m[1], label: m[2] }));
  const min = /key:\s*"length"[^}]*password\.length\s*>=\s*(\d+)/.exec(src);
  if (!min) problems.push('no `password.length >= N` in the length rule');
  const serverOnly = /"Too common" can only be checked by the server/i.test(src) ? ['common'] : [];
  const form = readApp(SOURCES.form, repo) || '';
  const pat = /aria-label="Username"/.test(form) ? /pattern="([^"]+)"[\s\S]{0,200}?aria-label="Username"/.exec(form) : null;
  const consent = /CONSENT_NEEDED\s*=\s*"([^"]+)"/.exec(readApp(SOURCES.consentTs, repo) || '');
  return { minLength: min ? Number(min[1]) : null, rules, serverOnly, usernamePattern: pat ? pat[1] : null, consentText: consent ? consent[1] : null, problems };
}

/**
 * The backend's rules: AUTH_PASSWORD_VALIDATORS (settings.py; MinimumLengthValidator's min_length OPTIONS, default 8),
 * USERNAME_RE (views.py), CONSENT_REQUIRED_MESSAGE (consent.py).
 * → { validators: [name], minLength, usernamePattern, consentMessage, problems: [] }
 */
export function backendRules(repo = appRepo()) {
  const problems = [];
  const settings = readApp(SOURCES.settings, repo) || '';
  const block = /AUTH_PASSWORD_VALIDATORS\s*=\s*\[([\s\S]*?)\n\]/.exec(settings);
  if (!block) problems.push(`no AUTH_PASSWORD_VALIDATORS in ${SOURCES.settings}`);
  const entries = block ? block[1].split(/\n\s*\{/).filter((e) => /'NAME'|"NAME"/.test(e)) : [];
  const validators = [];
  let minLength = null;
  for (const e of entries) {
    const m = /password_validation\.(\w+)/.exec(e);
    if (!m) continue;
    validators.push(m[1]);
    if (m[1] === 'MinimumLengthValidator') {
      const o = /['"]min_length['"]\s*:\s*(\d+)/.exec(e);
      minLength = o ? Number(o[1]) : 8; // Django's default
    }
  }
  const views = readApp(SOURCES.views, repo) || '';
  const re = /USERNAME_RE\s*=\s*re\.compile\(r"\^?([^"$]+)\$?"\)/.exec(views);
  const consent = /CONSENT_REQUIRED_MESSAGE\s*=\s*"([^"]+)"/.exec(readApp(SOURCES.consent, repo) || '');
  return { validators, minLength, usernamePattern: re ? re[1] : null, consentMessage: consent ? consent[1] : null, problems };
}

/** Literal matrix messages missing from their backend source file → [{ key, text, file }]. */
export function staleMessages(repo = appRepo()) {
  const out = [];
  for (const [key, { text, src }] of Object.entries(MSG)) {
    if (typeof text !== 'string') continue;
    const body = readApp(SOURCES[src], repo) || '';
    // Python source escapes nothing in these messages except quotes; compare both quote styles.
    if (!body.includes(text) && !body.includes(text.replace(/'/g, "\\'"))) out.push({ key, text, file: SOURCES[src] });
  }
  return out;
}

/** Does an API answer match a row's expectError? → null or a short reason. */
export function errorMismatch(json, { text, code }) {
  const got = json && typeof json.error === 'string' ? json.error : null;
  if (got === null) return `no "error" string (body ${JSON.stringify(json).slice(0, 80)})`;
  const ok = typeof text === 'string' ? got === text : text.test(got);
  if (!ok) return `error "${got.slice(0, 100)}"`;
  if (code && json.code !== code) return `code ${JSON.stringify(json.code)}`;
  return null;
}
