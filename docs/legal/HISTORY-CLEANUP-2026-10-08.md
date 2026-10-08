# Git history cleanup, 2026-10-08

**What was exposed (public repository):** a SQLite database snapshot (`backend/db.sqlite3`, 13 commits) holding two
accounts' emails and the owner's password hash; personal and third-party photos in `backend/media/`; and a Google OAuth
client secret, committed in `backend/.env` and, in older versions, hard-coded in `backend/users/views.py`. All account data
in the snapshot belonged to the owner. No other credential patterns were found (the Django `SECRET_KEY` hits are the public
placeholder key; the `postgresql://` hits are documentation placeholders).

**What was done:**
1. A full backup mirror was taken first (`C:\tmp\nba-backup.git`, outside the repo; delete it once you are satisfied).
2. `git filter-repo` removed `backend/db.sqlite3`, `backend/media/` and `backend/.env` from every commit and redacted the
   OAuth secret text (`GOCSPX-…`) everywhere. Verified: no such path or string remains in any commit; the `dev` tip tree is
   byte-identical to before, and `main` differs only by the removed media.
3. All 19 branches were force-pushed (475 commits; commit ids changed). Local repo resynced.
4. `backend/media/` is now in `.gitignore`; `NOTICE` limits the MIT licence to code.

**Still to do (outside this repository):**
- **Rotate the Google OAuth client secret** (it was public): Google Cloud Console, project "NBA Trivia Minigames - Log In",
  Google Auth Platform, Clients, the web client, Client secrets, Add secret; put the new value in the Vercel `backend`
  project env `CLIENT_SECRET` (Production) and redeploy; then disable the old secret in the console. Never paste it anywhere else.
- **Ask GitHub Support to purge cached views and the hidden pull-request refs** (they keep the old commits reachable by id).
  Send the request below via https://support.github.com/contact (free). Until it is processed the old commits can still be
  fetched by their ids.
- Rotate the owner's own account password if it was reused anywhere.

## Text for the GitHub Support request

> Subject: Request to purge cached sensitive data after history rewrite (stefanroman22/nba-trivia-minigames)
>
> I removed sensitive data (a database file, personal photos and an OAuth client secret) from the full history of my public
> repository stefanroman22/nba-trivia-minigames using git filter-repo and force-pushed all branches on 2026-10-08.
> GitHub still serves the old commits by SHA (for example f9810b6 and 6372734 on that repository) and via the
> refs/pull/* references of closed pull requests. Please run a garbage collection on the repository and remove cached views
> and the old pull-request refs so that the old commits are no longer reachable. The leaked credential has been, or is being,
> rotated. The repository has no forks. Thank you.
