@echo off
REM Periodic NBA data refresh -- RUN FROM A RESIDENTIAL MACHINE (NBA blocks datacenter IPs).
REM Scheduled via Task Scheduler. Logs everything to last_refresh.log.
REM   1) sync_nba_data: NBA API -> Supabase (validate + retry, non-destructive upsert)
REM   2) build_pools_from_db: Supabase -> static /data/ pools
REM   3) commit + push to dev (CI promotes to main)
REM   4) vercel deploy: publish refreshed pools to the frontend CDN
REM DATABASE_URL is read from the gitignored backend/.env via settings' load_dotenv.
setlocal
set "REPO=C:\Users\stefa\OneDrive\Desktop\nba-projects\nba-minigames"
set "LOG=%REPO%\backend\scripts\last_refresh.log"

echo ===== NBA data refresh %DATE% %TIME% ===== > "%LOG%"

cd /d "%REPO%\backend" || (echo ERROR: cannot cd to backend >> "%LOG%" & exit /b 1)
echo [1/4] sync_nba_data >> "%LOG%"
"venv\Scripts\python.exe" manage.py sync_nba_data --max-games 20 --timeout 20 >> "%LOG%" 2>&1

echo [2/4] build_pools_from_db >> "%LOG%"
"venv\Scripts\python.exe" manage.py build_pools_from_db >> "%LOG%" 2>&1

cd /d "%REPO%"
echo [3/4] commit + push >> "%LOG%"
git add backend/trivia/data >> "%LOG%" 2>&1
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "chore(data): scheduled NBA data refresh" >> "%LOG%" 2>&1
  git push origin dev >> "%LOG%" 2>&1
  echo [4/4] vercel deploy >> "%LOG%"
  call npx vercel deploy --prod --yes >> "%LOG%" 2>&1
) else (
  echo No pool changes to commit; skipping deploy. >> "%LOG%"
)

echo Refresh complete %DATE% %TIME% >> "%LOG%"
endlocal
