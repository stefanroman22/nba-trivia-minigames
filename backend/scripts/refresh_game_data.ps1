# Weekly NBA data refresh - RUN FROM A RESIDENTIAL MACHINE (not the cloud).
# stats.nba.com blocks data-center IPs, so the live fetch must run from home internet.
$ErrorActionPreference = "Stop"
Set-Location -Path (Join-Path $PSScriptRoot "..")   # -> backend/
& ".\venv\Scripts\python.exe" manage.py refresh_game_data
Write-Host "Refresh complete. Review git diff in backend/trivia/data/, then commit & push to publish."
