# Periodic NBA data refresh — RUN FROM A RESIDENTIAL MACHINE.
# stats.nba.com blocks data-center IPs, so the live fetch must run from home internet
# (it cannot run on Vercel/Railway/GitHub Actions). This is the scheduled job.
#
#   1. sync_nba_data      -> fetch latest from the NBA API, validate + retry, upsert
#                            into Supabase (never destructive: bad data is rejected).
#   2. gh workflow run    -> trigger the "Publish game data" GitHub workflow, which
#                            builds the game-data files from the DB and uploads only
#                            what changed to the data host. The website is not
#                            redeployed and nothing is committed from this machine.
#
# gh must be installed and logged in as the stefanroman22 account (gh auth login).
# (The .cmd twin also runs upload_dataset for the question games until phase 6.)
#
# DATABASE_URL is read from backend/.env (gitignored) via settings' load_dotenv,
# so no secret lives in this script or the repo.

$ErrorActionPreference = "Stop"
$repo    = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$backend = Join-Path $repo "backend"
$py      = Join-Path $backend "venv\Scripts\python.exe"
$logDir  = Join-Path $backend "scripts"
Start-Transcript -Path (Join-Path $logDir "last_refresh.log") -Force | Out-Null
$exitCode = 0

try {
    Set-Location $backend
    Write-Host "=== [1/2] sync_nba_data (NBA API -> Supabase) ==="
    # Routine refresh: live players + last 2 seasons of playoff/starting-five + teams + mvps.
    # Non-destructive upsert keeps the full backfilled history; --max-games keeps the
    # box-score-heavy starting-five fetch light; --timeout cushions occasional throttling.
    & $py manage.py sync_nba_data --max-games 20 --timeout 20

    Set-Location $repo
    Write-Host "=== [2/2] trigger publish-game-data workflow ==="
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        Write-Host "ERROR: gh CLI not found; install GitHub CLI and run 'gh auth login' as stefanroman22. Game data NOT published."
        $exitCode = 1
    } else {
        gh auth status
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERROR: gh is not authenticated; run 'gh auth login' as stefanroman22. Game data NOT published."
            $exitCode = 1
        } else {
            gh workflow run publish-game-data.yml --repo stefanroman22/nba-trivia-minigames --ref main -f games= -f target=vercel -f dry_run=false
            if ($LASTEXITCODE -ne 0) {
                Write-Host "ERROR: gh workflow run failed; game data NOT published."
                $exitCode = 1
            } else {
                Write-Host "Publish workflow triggered: https://github.com/stefanroman22/nba-trivia-minigames/actions/workflows/publish-game-data.yml"
            }
        }
    }

    Write-Host "Refresh complete: $(Get-Date -Format o)"
} finally {
    Stop-Transcript | Out-Null
}
exit $exitCode
