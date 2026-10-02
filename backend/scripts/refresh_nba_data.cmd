@echo off
REM Periodic NBA data refresh -- RUN FROM A RESIDENTIAL MACHINE (NBA blocks datacenter IPs).
REM Scheduled via Task Scheduler. Logs everything to last_refresh.log.
REM   1) sync_nba_data: NBA API -> Supabase (validate + retry, non-destructive upsert)
REM   2) upload_dataset: players dataset in Supabase Storage, read only by maintain_questions
REM      (hidden superdraft/imposter + the fallback snapshot); the publish workflow reads the
REM      committed players_curated.json (phase 6 of the game-data publishing design)
REM   3) trigger the "Publish game data" GitHub workflow, which builds the game-data
REM      files from the DB and uploads only what changed to the data host. The website
REM      is not redeployed and nothing is committed from this machine.
REM gh must be installed and logged in as the stefanroman22 account (gh auth login).
REM DATABASE_URL is read from the gitignored backend/.env via settings' load_dotenv.
setlocal
set "REPO=C:\Users\stefa\OneDrive\Desktop\nba-projects\nba-minigames"
set "LOG=%REPO%\backend\scripts\last_refresh.log"

echo ===== NBA data refresh %DATE% %TIME% ===== > "%LOG%"

cd /d "%REPO%\backend" || (echo ERROR: cannot cd to backend >> "%LOG%" & exit /b 1)
echo [1/3] sync_nba_data >> "%LOG%"
"venv\Scripts\python.exe" manage.py sync_nba_data --max-games 20 --timeout 20 >> "%LOG%" 2>&1

echo [2/3] upload_dataset >> "%LOG%"
"venv\Scripts\python.exe" manage.py upload_dataset >> "%LOG%" 2>&1

cd /d "%REPO%"
echo [3/3] trigger publish-game-data workflow >> "%LOG%"
where gh >nul 2>&1
if errorlevel 1 (
  echo ERROR: gh CLI not found; install GitHub CLI and run "gh auth login" as stefanroman22. Game data NOT published. >> "%LOG%"
  exit /b 1
)
gh auth status >> "%LOG%" 2>&1
if errorlevel 1 (
  echo ERROR: gh is not authenticated; run "gh auth login" as stefanroman22. Game data NOT published. >> "%LOG%"
  exit /b 1
)
gh workflow run publish-game-data.yml --repo stefanroman22/nba-trivia-minigames --ref main -f games= -f target=vercel -f dry_run=false >> "%LOG%" 2>&1
if errorlevel 1 (
  echo ERROR: gh workflow run failed; game data NOT published. >> "%LOG%"
  exit /b 1
)
echo Publish workflow triggered: https://github.com/stefanroman22/nba-trivia-minigames/actions/workflows/publish-game-data.yml >> "%LOG%"

echo Refresh complete %DATE% %TIME% >> "%LOG%"
endlocal
