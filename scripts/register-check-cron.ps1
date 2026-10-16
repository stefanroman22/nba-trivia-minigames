# Registers (or replaces) the scheduled task `nba-checks`: daily at 02:00, runs scripts/check-run.ps1 (Logic Check, then
# UI check, on main; docs/logic-check/README.md). StartWhenAvailable catches up a missed 02:00 (PC off or asleep) at the
# next start; the task is stopped after 4 h. check-run.ps1 loads .env.team (NOTION_TOKEN, SLACK_BOT_TOKEN) itself, like
# team-run.ps1. Remove it with scripts/unregister-check-cron.ps1.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$name = "nba-checks"
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$repo\scripts\check-run.ps1`"" `
  -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At "02:00"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
  -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 4)
try { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop } catch {}
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings | Out-Null
Write-Output "Registered '$name': daily at 02:00 (StartWhenAvailable, 4 h limit) -> $repo\scripts\check-run.ps1"
Get-ScheduledTask -TaskName $name | Select-Object TaskName, State
