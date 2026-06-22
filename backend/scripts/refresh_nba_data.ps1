# Periodic NBA data refresh — RUN FROM A RESIDENTIAL MACHINE.
# stats.nba.com blocks data-center IPs, so the live fetch must run from home internet
# (it cannot run on Vercel/Railway/GitHub Actions). This is the scheduled job.
#
#   1. sync_nba_data      -> fetch latest from the NBA API, validate + retry, upsert
#                            into Supabase (never destructive: bad data is rejected).
#   2. build_pools_from_db-> regenerate the static /data/ pools from the DB.
#   3. commit + push      -> dev (CI lints + promotes to main).
#   4. vercel deploy      -> publish the refreshed /data/ pools to the frontend CDN.
#
# DATABASE_URL is read from backend/.env (gitignored) via settings' load_dotenv,
# so no secret lives in this script or the repo.

$ErrorActionPreference = "Stop"
$repo    = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$backend = Join-Path $repo "backend"
$py      = Join-Path $backend "venv\Scripts\python.exe"
$logDir  = Join-Path $backend "scripts"
Start-Transcript -Path (Join-Path $logDir "last_refresh.log") -Force | Out-Null

try {
    Set-Location $backend
    Write-Host "=== [1/4] sync_nba_data (NBA API -> Supabase) ==="
    # Routine refresh: live players + last 2 seasons of playoff/starting-five + teams + mvps.
    # Non-destructive upsert keeps the full backfilled history; --max-games keeps the
    # box-score-heavy starting-five fetch light; --timeout cushions occasional throttling.
    & $py manage.py sync_nba_data --max-games 20 --timeout 20

    Write-Host "=== [2/4] build_pools_from_db (Supabase -> /data/) ==="
    & $py manage.py build_pools_from_db

    Set-Location $repo
    Write-Host "=== [3/4] commit + push refreshed pools ==="
    git add backend/trivia/data
    $changes = git diff --cached --name-only
    if ($changes) {
        git commit -m "chore(data): scheduled NBA data refresh"
        git push origin dev
    } else {
        Write-Host "No pool changes to commit."
    }

    Write-Host "=== [4/4] publish frontend pools to Vercel ==="
    npx vercel deploy --prod --yes --cwd $repo

    Write-Host "Refresh complete: $(Get-Date -Format o)"
} finally {
    Stop-Transcript | Out-Null
}
