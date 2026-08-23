# Registers (or replaces) the scheduled task: every 2h, 08:00-24:00, runs team-run.ps1.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$name = "nba-team-pipeline"
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$repo\scripts\team-run.ps1`"" `
  -WorkingDirectory $repo
# Daily at 08:00, repeating every 2h for 16h (08:00–24:00) EACH day. A bare -Once
# trigger only repeats on its start day, so the daily trigger carries the repetition.
$trigger = New-ScheduledTaskTrigger -Daily -At "08:00"
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At "08:00" `
  -RepetitionInterval (New-TimeSpan -Hours 2) -RepetitionDuration (New-TimeSpan -Hours 16)).Repetition
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
  -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 3)
try { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop } catch {}
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings | Out-Null
Write-Output "Registered '$name': every 2h from 08:00 for 16h daily."
Get-ScheduledTask -TaskName $name | Select-Object TaskName, State
