# Security scan instructions

Read by the Claude security review in both modes of the security agent (`scripts/security/run.mjs`, see
`docs/security/README.md`). Edit this file to tune what the review reports; the deterministic tools (gitleaks,
osv-scanner) are tuned in `.gitleaks.toml` and `.security/ignore.json`.

## The application
- `backend/` — Django + DRF API (users, auth, leaderboards, friends, rooms, trivia data). Postgres in production
  (`DATABASE_URL`, Supabase pooler), sqlite locally. Session/JWT auth, Google sign-in.
- `src/` — Next.js 16 App Router frontend, every page server-rendered; it calls the Django API.
- `multiplayer_server/` — Socket.IO relay (rooms, 1v1, friend rooms); it credits points through the API with a shared secret.
- `moderation_service/` — a separate service that moderates user content.
- `scripts/`, `infra/`, `.github/workflows/` — automation with Notion, Slack, GitHub, Vercel, Railway, Supabase tokens.
- The repository is **public**: anything committed is readable by anyone, including old commits.

## What to report, in this priority order
1. **Exploitable / penetration issues** — SQL/NoSQL/command/template injection, remote code execution (unsafe
   deserialisation, `eval`, `subprocess` with user input, `shell=True`), authentication bypass, broken access control
   and IDOR (an object fetched by id without checking it belongs to the requesting user), SSRF (a server fetch of a
   user-supplied URL), XSS that runs in another user's session (`dangerouslySetInnerHTML`, unescaped HTML in emails or
   templates), path traversal, CSRF on a state-changing endpoint that accepts cookie auth, socket events that act
   without checking who sent them.
2. **Database exposure** — querysets not scoped to the requesting user or room (missing `filter(user=request.user)`
   or tenant filter), raw SQL (`raw()`, `extra()`, `cursor.execute` with string formatting), serializers that return
   whole models (`fields = "__all__"`) with private columns, connection strings or DB credentials in code or logs,
   over-privileged DB roles (a service role key or superuser URL used where a scoped one would do).
3. **Data leakage** — secrets, tokens, emails, IPs or other personal data in log lines, exception messages returned to
   clients, `DEBUG`-style error pages, API responses that include fields the client does not need (another user's
   email, password hash, tokens), `NEXT_PUBLIC_*`/client bundles that embed a server secret.
4. **Hardcoded or leaked API keys / tokens** — literal credentials in code or config (gitleaks also scans for these;
   still report one when you see it, with the provider and blast radius), secrets echoed in workflow `run:` steps,
   tokens with more scope than the job needs.
5. **Everything else that is a real security bug** — insecure defaults in settings (`ALLOWED_HOSTS = ["*"]`, CORS `*`
   with credentials, missing `SECURE_*` in production settings), weak crypto for secrets, untrusted input interpolated
   into a GitHub Actions `run:` step (`${{ github.event.* }}`), `pull_request_target` checking out PR code.

## Do not report (hard exclusions)
- Denial of service, rate limiting, resource exhaustion, ReDoS, missing pagination.
- Missing hardening with no concrete exploit (a missing header, "consider validating", defence in depth).
- Anything in tests, fixtures, docs, examples, or generated/data files (`public/`, `backend/trivia/data/`, lockfiles).
- Dependency CVEs (osv-scanner covers them) and outdated packages.
- Secrets that are clearly placeholders (`changeme`, `xxx`, `<token>`, `example`), public identifiers (a Notion
  database id, a Slack channel id, a Vercel project id, a Supabase anon/publishable key, `NEXT_PUBLIC_*` values meant
  to be public), and values read from the environment.
- Client-side-only checks in `src/` when the server enforces the same rule (report the server if it does not).
- Theoretical issues that need an attacker who already controls the server, the database, or a maintainer account.

## Severity
- **critical** — remote code execution, auth bypass to any account, a live secret with write access to production,
  reading or changing every user's data.
- **high** — an attacker reads or changes another user's data (IDOR, unscoped query), injection with a realistic
  path, SSRF to internal services, stored XSS, a leaked secret with read access.
- **medium** — a leak of non-sensitive personal data, reflected XSS needing interaction, CSRF on a minor action,
  over-privileged credentials with no current exposure.
- **low** — information disclosure with little value, issues needing unlikely preconditions.

## Confidence (1-10)
Score how sure you are that the issue is real **and reachable** after reading the code path end to end:
- 9-10: you traced untrusted input from its source (request field, socket payload, URL param, webhook body) to the
  sink, nothing in between neutralises it, and you can describe the exact request an attacker sends.
- 8: the path is clear but one link is inferred (for example a middleware you could not fully read).
- 5-7: a pattern that is often vulnerable, but you could not confirm reachability. Report it only if severity is high.
- 1-4: do not report.
Only findings at confidence ≥ 8 reach a ticket or block a PR; lower ones are dropped.

## How to write a finding
- `snippet`: the exact text of the sink line, copied from the file (it is how the finding is fingerprinted and found
  again next week; do not paraphrase it).
- `exploitPath`: "source → … → sink" in one or two sentences with real names (endpoint, parameter, function).
- `fix`: concrete steps that name the file and the change (parameterise with `%s` params, add
  `.filter(owner=request.user)`, check `room.members` before acting, read the key from `os.environ`, …).
- `verify`: the test to add — file and what it asserts (for example `backend/users/tests/test_x.py`: user B gets 404
  for user A's object).
- `rootCause`: a short id shared by findings that one change fixes (for example `unscoped-room-queries`).
