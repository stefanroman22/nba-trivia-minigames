# Runbooks

Short procedures so a request or incident is handled the same way every time, and leaves a record.
Keep a simple log (date, who, what, decision) for each of these in a private place; it is evidence.

## A. A player asks to see, correct or delete their data

Deadline: **one month** from receipt (extendable by two months for complex requests; tell them within the month).

1. Prefer self-service: Profile → Download my data / Delete account / Remove photo. Point them to it.
2. If they cannot use it (banned account, lost access, wrote by email):
   - Confirm it is them: reply from the account's email address, or have them quote the player ID and answer from that address. Do not ask for ID documents unless unavoidable.
   - Export: `python manage.py shell -c "from users.account_data import export_account; ..."` or the admin; send the JSON by reply to the account email.
   - Erase: `python manage.py erase_user <public id or email>` (dry run), then `--yes`. A banned account is **anonymised**, not removed (only the ban record stays; Privacy Policy section 7).
3. Objection / restriction: stop the processing in question or explain, in writing, the compelling grounds.
4. Log it. Tell the player what you did and, if you kept anything (ban record), say what and why.
5. Backups: nothing to do; deleted data ages out of provider backups. Never restore a deleted account.

## B. Personal-data breach

Awareness starts the clock: **72 hours** to the supervisory authority if the breach is likely to risk people's rights.

1. **Contain** (hours): rotate `DJANGO_SECRET_KEY` (signs every token and salts IP hashes: all sessions end), Google `CLIENT_SECRET`, `DATABASE_URL` password (Supabase), any other exposed secret. Take affected parts offline if needed.
2. **Assess:** what data, how many people, which countries, was it encrypted/hashed, is it ongoing.
3. **Write down the time you became aware** and every step. Record every incident in a breach register, including ones you decide not to report.
4. **Notify:**
   - Supervisory authority of the operator's main establishment, within 72 hours, unless unlikely to risk people.
   - Affected players, without undue delay, in plain language, if the risk is high (email, plus a site notice).
   - Other regimes only if they apply (UK ICO 72h if UK people are affected and UK law applies; Brazil ANPD 3 business days; India DPDP 72h once in force; US state laws vary).
5. **Processors:** Supabase notifies within 48 hours where feasible; Vercel "without undue delay". Find their incident contacts before you need them.
6. **Review:** fix the cause, update the record of processing, write the lessons down.

## C. Report of illegal or rule-breaking content / copyright notice

1. Acknowledge the sender promptly.
2. Look at the player/name/photo. If unlawful or against Terms section 5: remove or restrict it (strike/ban as appropriate).
3. Send the affected player a **statement of reasons**: what was done, the facts relied on, whether an automated tool was involved, the legal or contractual ground, and how to appeal (reply to this email).
4. Tell the reporter the decision.
5. Copyright/trademark notices: verify it names the work, location and sender; act on valid ones; allow a counter-notice; end repeat infringers' accounts.
6. Suspected serious crime threatening life or safety: report to the police (DSA Art 18).

## D. Ban appeal

1. A person reads it within **14 days** (Terms section 7).
2. If the strike/ban was wrong, reverse it: `strikes.unban_user(user)` (restores access and leaderboard) and tell them.
3. If upheld, explain the reasons and say their data rights are unaffected.

## E. Request from a public authority

1. Do not answer informally. Ask for the legal basis and the exact data requested, in writing.
2. Take advice before disclosing if there is any doubt about validity or jurisdiction.
3. Disclose the minimum that satisfies the order. Tell the player first unless the law or the order forbids it.
4. Log date, requester, basis, data given, decision.

## F. Changing the Privacy Policy or Terms

1. Edit the pages, bump `LEGAL.version` and `TERMS_VERSION` (same value), update `docs/legal/`.
2. For a significant change, put a notice on the site's home page for **at least 14 days before** the change takes effect (the text promises this), then promote.
3. Keep the previous text (git history) and send it to anyone who asks.
