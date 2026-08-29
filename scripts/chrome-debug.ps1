# Launches a debuggable Chrome that Claude Code attaches to over CDP.
#
# Chrome 136+ silently ignores --remote-debugging-port when it points at the
# default profile, so this uses a dedicated profile directory. That profile is
# persistent: log in once and the session survives restarts.
#
# Usage:  powershell -File scripts/chrome-debug.ps1
#         powershell -File scripts/chrome-debug.ps1 -Port 9222 -Url http://localhost:5173/

param(
    [int]$Port = 9222,
    [string]$Url = "http://localhost:5173/",
    [string]$ProfileDir = "$env:USERPROFILE\.chrome-claude-debug"
)

$ErrorActionPreference = "Stop"

$candidates = @(
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
)
$chrome = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw "chrome.exe not found in any known location" }

# Already listening? Reuse it rather than starting a second instance.
try {
    $existing = Invoke-WebRequest "http://127.0.0.1:$Port/json/version" -UseBasicParsing -TimeoutSec 2
    Write-Host "Debug Chrome already running on port $Port" -ForegroundColor Green
    Write-Host ($existing.Content | ConvertFrom-Json).Browser
    exit 0
} catch {
    # not running - fall through and launch
}

if (-not (Test-Path $ProfileDir)) {
    New-Item -ItemType Directory -Path $ProfileDir -Force | Out-Null
}

Start-Process $chrome -ArgumentList @(
    "--remote-debugging-port=$Port"
    "--user-data-dir=`"$ProfileDir`""
    "--no-first-run"
    "--no-default-browser-check"
    $Url
)

# Chrome needs a moment to bind the port.
$deadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $deadline) {
    try {
        $r = Invoke-WebRequest "http://127.0.0.1:$Port/json/version" -UseBasicParsing -TimeoutSec 2
        $v = $r.Content | ConvertFrom-Json
        Write-Host "Debug Chrome ready on port $Port" -ForegroundColor Green
        Write-Host "  $($v.Browser)"
        Write-Host "  profile: $ProfileDir"
        exit 0
    } catch {
        Start-Sleep -Milliseconds 500
    }
}

throw "Chrome did not expose CDP on port $Port within 20s"
