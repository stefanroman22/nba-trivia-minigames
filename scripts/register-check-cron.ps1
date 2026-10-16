# Registers (or replaces) the scheduled task `nba-checks`: daily at 02:00, runs check-run.ps1 (Logic Check, then UI check,
# on main; docs/logic-check/README.md "The nightly run") from the tooling worktree <worktreeRoot>\checks-nightly on branch
# checks-nightly, which it creates when missing: from origin/dev (the branch must already carry scripts/check-run.ps1),
# with junctions backend\.venv and multiplayer_server\node_modules to the main checkout's and its own `npm ci`.
# StartWhenAvailable catches up a missed 02:00 (PC off or asleep) at the next start; the task is stopped after 6 h (a
# hard stop leaves the stack up: the next night's check-run stops it first). A laptop on battery still starts and
# keeps the run (the scheduler's defaults would refuse to start, and kill a run the moment the charger is unplugged). check-run.ps1 loads .env.team
# (NOTION_TOKEN, SLACK_BOT_TOKEN) itself, like team-run.ps1. Remove the task with scripts/unregister-check-cron.ps1.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$name = "nba-checks"
$branch = "checks-nightly"

# The main checkout (first worktree) owns the venv and relay node_modules the worktrees link to.
$first = @(& git -C $repo worktree list --porcelain) | Where-Object { $_ -like 'worktree *' } | Select-Object -First 1
$main = [IO.Path]::GetFullPath($first.Substring(9))
$root = Join-Path $env:USERPROFILE ".team-worktrees"
$cfgFile = Join-Path $repo ".claude\team\config.json"
if (Test-Path $cfgFile) { $cfg = Get-Content $cfgFile -Raw | ConvertFrom-Json; if ($cfg.worktreeRoot) { $root = $cfg.worktreeRoot } }
$wt = Join-Path $root $branch

if (-not (Test-Path (Join-Path $wt ".git"))) {
  Write-Output "Creating the tooling worktree $wt ($branch)..."
  & git -C $main fetch --quiet origin dev
  & git -C $main rev-parse --verify --quiet "refs/heads/$branch" *> $null
  if ($LASTEXITCODE -eq 0) { & git -C $main worktree add $wt $branch }
  else { & git -C $main worktree add -b $branch $wt origin/dev }
  if ($LASTEXITCODE -ne 0) { throw "git worktree add $wt failed" }
  foreach ($link in @("backend\.venv", "multiplayer_server\node_modules")) {
    $target = Join-Path $main $link
    $at = Join-Path $wt $link
    if ((Test-Path $target) -and -not (Test-Path $at)) { New-Item -ItemType Junction -Path $at -Target $target | Out-Null }
  }
  Push-Location $wt
  try {
    & npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci in $wt failed" }
    Set-Content -LiteralPath (Join-Path $wt "node_modules\.nightly-lock-stamp") -Value "$(& git rev-parse HEAD:package-lock.json)".Trim() -Encoding ascii
  } finally { Pop-Location }
}
$script = Join-Path $wt "scripts\check-run.ps1"
if (-not (Test-Path $script)) { throw "$script is missing: $branch has no check-run.ps1 yet (merge the Logic Check branch into dev first)" }

$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`"" `
  -WorkingDirectory $wt
$trigger = New-ScheduledTaskTrigger -Daily -At "02:00"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 6)
try { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop } catch {}
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings | Out-Null
Write-Output "Registered '$name': daily at 02:00 (StartWhenAvailable, 6 h limit) -> $script (working directory $wt)"
Get-ScheduledTask -TaskName $name | Select-Object TaskName, State
