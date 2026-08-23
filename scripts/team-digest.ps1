# Posts the day's per-agent digests to Slack. Safe, quick, read-mostly.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repo ".env.team"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^([A-Z_]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), "Process") }
  }
}
Set-Location $repo
node scripts/slack.mjs daily-digests
