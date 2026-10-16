# Removes the scheduled task `nba-checks` (scripts/register-check-cron.ps1). Idempotent. The tooling worktree
# <worktreeRoot>\checks-nightly stays; to delete it, remove its junctions (backend\.venv,
# multiplayer_server\node_modules) first, then `git worktree remove` (removal follows a junction).
$ErrorActionPreference = "Stop"
$name = "nba-checks"
try {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop
  Write-Output "Unregistered '$name'."
} catch {
  Write-Output "'$name' not present (nothing to do)."
}
