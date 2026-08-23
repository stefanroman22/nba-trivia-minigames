# Retires the local scheduled tasks — the cloud routine + report crons replace them.
# Idempotent: silently ignores tasks that are already gone.
$ErrorActionPreference = "Stop"
foreach ($name in "nba-team-pipeline", "nba-team-digest") {
  try {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop
    Write-Output "Unregistered '$name'."
  } catch {
    Write-Output "'$name' not present (nothing to do)."
  }
}
Write-Output "Local scheduled tasks retired. The cloud routine is now the scheduled worker; report crons run in GitHub Actions."
