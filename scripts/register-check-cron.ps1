# Registers (or replaces) the scheduled task `nba-checks`: weekly, Sundays 02:00 CET, runs check-run.ps1 (Logic Check, then UI check,
# on main; docs/logic-check/README.md "The nightly run") from the tooling worktree <worktreeRoot>\checks-nightly on branch
# checks-nightly, which it creates when missing: from origin/dev (the branch must already carry scripts/check-run.ps1),
# with junctions backend\.venv and multiplayer_server\node_modules to the main checkout's and its own `npm ci`.
# The time is CET/CEST wall-clock time (-TimeZone, a Windows zone id); Task Scheduler fires on the PC's own clock, so it
# is converted here (this PC runs on GTB time: 02:00 CET = 03:00 local). CET and the PC's EU zone switch summer time at
# the same instant, so the converted time holds all year; re-run this script if the PC moves to another time zone.
# StartWhenAvailable catches up a missed run (PC off or asleep) at the next start; the task is stopped after 6 h (a
# hard stop leaves the stack up: the next run's check-run stops it first). A laptop on battery still starts and
# keeps the run (the scheduler's defaults would refuse to start, and kill a run the moment the charger is unplugged). check-run.ps1 loads .env.team
# (NOTION_TOKEN, SLACK_BOT_TOKEN) itself, like team-run.ps1. Remove the task with scripts/unregister-check-cron.ps1.
param(
  [ValidateSet("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")]
  [string]$Day = "Sunday",
  [string]$At = "02:00",
  [string]$TimeZone = "W. Europe Standard Time"
)
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
# The next $Day $At in $TimeZone, as the PC's local time (its weekday may differ from $Day near midnight).
$tz = [TimeZoneInfo]::FindSystemTimeZoneById($TimeZone)
$nowTz = [TimeZoneInfo]::ConvertTime([DateTime]::Now, $tz)
$next = $nowTz.Date.AddDays(([int][DayOfWeek]$Day - [int]$nowTz.DayOfWeek + 7) % 7).Add([TimeSpan]::Parse($At))
if ($next -le $nowTz) { $next = $next.AddDays(7) }
$local = [TimeZoneInfo]::ConvertTime([DateTime]::SpecifyKind($next, [DateTimeKind]::Unspecified), $tz, [TimeZoneInfo]::Local)
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $local.DayOfWeek -At $local
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 6)
try { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop } catch {}
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings | Out-Null
Write-Output "Registered '$name': weekly, $Day $At $($tz.Id) = $($local.DayOfWeek) $($local.ToString('HH:mm')) local, first run $($local.ToString('yyyy-MM-dd HH:mm')) (StartWhenAvailable, 6 h limit) -> $script (working directory $wt)"
Get-ScheduledTask -TaskName $name | Select-Object TaskName, State
