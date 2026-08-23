$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$name = "nba-team-digest"
$ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$action = New-ScheduledTaskAction -Execute $ps `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$repo\scripts\team-digest.ps1`"" `
  -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At "23:30"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
try { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop } catch {}
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings | Out-Null
Write-Output "Registered '$name': daily at 23:30."
Get-ScheduledTask -TaskName $name | Select-Object TaskName, State
