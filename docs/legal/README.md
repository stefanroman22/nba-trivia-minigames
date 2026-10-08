# Legal and privacy compliance

What is here, and the rule that keeps it honest: **the Privacy Policy and Terms may only promise what the
system does.** When behaviour changes, change the code, these documents and the public pages together.

| File | Purpose |
|---|---|
| [OPEN_ITEMS.md](OPEN_ITEMS.md) | **Start here.** What must still be decided or done, and what needs a lawyer. |
| [RECORD_OF_PROCESSING.md](RECORD_OF_PROCESSING.md) | GDPR Art 30 record: every data category, purpose, lawful basis, retention, recipient. Includes the legitimate-interests assessment and DPIA screening. |
| [RUNBOOKS.md](RUNBOOKS.md) | How to answer a data request, handle a breach, a takedown notice, a ban appeal, a government request. |
| [RESEARCH.md](RESEARCH.md) | The legal research behind the design, with sources and confidence. Not legal advice. |

## Where the promises live in code

| Promise | Enforced by |
|---|---|
| Accounts need Terms acceptance and an age check; no birth date stored | `backend/users/consent.py`, `signup_view`, `google_login` (two-step for new Google accounts) |
| Delete your account / photo yourself | `backend/users/account_data.py`, `POST /api/account/delete/`, `POST /api/account/remove-photo/`, profile screen |
| Download your data | `GET /api/account/export/`, profile screen |
| Banned or locked-out players can still be erased | `python manage.py erase_user <public id or email> --yes` |
| Retention periods | `backend/users/retention.py`, `manage.py prune_personal_data`, `.github/workflows/prune-personal-data.yml` (weekly) |
| Terms version on every acceptance matches the page | `TERMS_VERSION` in `consent.py` = `version` in `src/configurations/legal.ts`; `npm run check:legal` fails on a mismatch |
| Operator identity shown on the pages | `src/configurations/legal.ts` (`npm run check:legal` warns while empty) |

## Changing the documents

1. Edit `src/app/privacy/page.tsx` / `terms/page.tsx`.
2. Bump `LEGAL.version` and `LEGAL.updated` in `src/configurations/legal.ts` and `TERMS_VERSION` in `backend/users/consent.py` (same value).
3. Update `RECORD_OF_PROCESSING.md` and `retention.py` if data or periods changed.
4. A material change needs notice to players before it applies (Terms section 12).
