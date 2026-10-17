# Weekly checks on this PC, Sundays 02:00 CET (Task Scheduler task `nba-checks`, registered by scripts/register-check-cron.ps1).
# The run itself is scripts/check-run.mjs (cross-platform; GitHub Actions runs the same file, .github/workflows/
# checks-weekly.yml); this wrapper keeps the task's command line unchanged, pins UI_CHECK_HOME to %LOCALAPPDATA%\nba-ui-check
# (shared with the skills) and passes the switches on. Both share one state store (branch checks-state): whichever run
# takes the weekly lease first runs, the other exits at once; a run that finished ok since Sunday 00:00 Paris time makes
# the next one exit too, unless -Force. docs/logic-check/README.md "The weekly run".
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-run.ps1 [-DryRun] [-Ports django=8210,socket=4210,web=5384]
#                                                    [-AllowMainCheckout] [-AgentTimeoutSec 2700] [-Force] [-NoState]
param(
  [switch]$DryRun,
  [string]$Ports = "django=8210,socket=4210,web=5384",
  [switch]$AllowMainCheckout,
  [int]$AgentTimeoutSec = 2700,
  [switch]$Force,
  [switch]$NoState
)
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
if (-not $env:UI_CHECK_HOME) { $env:UI_CHECK_HOME = Join-Path $env:LOCALAPPDATA "nba-ui-check" }
$nodeArgs = @("scripts/check-run.mjs", "--ports", $Ports, "--agent-timeout-sec", "$AgentTimeoutSec")
if ($DryRun) { $nodeArgs += "--dry-run" }
if ($AllowMainCheckout) { $nodeArgs += "--allow-main-checkout" }
if ($Force) { $nodeArgs += "--force" }
if ($NoState) { $nodeArgs += "--no-state" }
& node @nodeArgs
exit $LASTEXITCODE
