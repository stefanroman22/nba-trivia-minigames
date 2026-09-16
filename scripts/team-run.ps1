# Launches one queue-drain pipeline run. Safe under cron: lockfile prevents overlap.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$lock = Join-Path $repo ".team\run.lock"
$logDir = Join-Path $repo ".team\logs"
New-Item -ItemType Directory -Force $logDir | Out-Null

# Lockfile: skip if a previous run is still alive
if (Test-Path $lock) {
  $oldPid = Get-Content $lock -ErrorAction SilentlyContinue
  if ($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
    Write-Output "team-run already running (pid $oldPid); exiting."
    exit 0
  }
  Remove-Item $lock -Force
}
Set-Content $lock $PID -Encoding ascii

# Load .env.team into this process (NOTION_TOKEN etc.)
$envFile = Join-Path $repo ".env.team"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^([A-Z_]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), "Process") }
  }
}

$log = Join-Path $logDir ("run-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
try {
  Set-Location $repo
  # Without this, claude -p force-terminates after 600s if a background task (npm ci, QA
  # browser, etc.) is still running, cutting a task off mid-stage even though it was making
  # real progress. Bounded (not 0/infinite) so a genuinely hung step still gets killed.
  $env:CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS = "1800000"
  claude --dangerously-skip-permissions -p "/team-run" 2>&1 | Tee-Object -FilePath $log
} finally {
  Remove-Item $lock -Force -ErrorAction SilentlyContinue
}
