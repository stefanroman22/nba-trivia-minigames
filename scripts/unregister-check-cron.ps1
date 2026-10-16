# Removes the scheduled task `nba-checks` (scripts/register-check-cron.ps1). Idempotent.
$ErrorActionPreference = "Stop"
$name = "nba-checks"
try {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop
  Write-Output "Unregistered '$name'."
} catch {
  Write-Output "'$name' not present (nothing to do)."
}
