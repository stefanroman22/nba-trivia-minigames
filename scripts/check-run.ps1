# Nightly checks (Task Scheduler task `nba-checks`, registered by scripts/register-check-cron.ps1; spec section 7 of
# docs/superpowers/specs/2026-10-15-checks-prod-logic-design.md; docs/logic-check/README.md):
#   1. channel resolve (Notion card Done + its Commit on origin/main) -> resolved blocks + catch-up lists
#   2. catch-up: Logic re-runs the resolved services' checks; if green, UI check runs the deferred checks (--only)
#   3. Logic Check on main (local suites + live) -> triage agent (only when the digest has FAIL sections)
#      -> report.mjs --validate -> notion-push --checker logic -> channel block-run (blocks for the pushed findings)
#   4. UI check on main (local, then the @live subset) -> the ui-check judges (only on FAIL sections)
#      -> validate (by the skill) -> notion-push --checker ui
#   5. retain.mjs (runs, notes, channel, cards ledger)
#   6. one Slack line (#pipeline) with cards per checker, blocks, resolved, deferred, run ids, duration
# Agents run through `claude -p` exactly like team-run.ps1 (Sonnet); when `claude` is not on PATH the digest path goes to
# the log and the Slack line says "triage needed". Scripts never read digest bodies (only the count of `## FAIL` headers).
# Lockfile <uicHome>/check-run.lock (a live PID = another run: exit 0); log <uicHome>/logs/check-<ts>.log (+ .json state).
# Every exit path stops the stack on -Ports and releases the lock.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-run.ps1 [-DryRun] [-Ports django=8200,socket=4200,web=5374]
# -DryRun prints the plan (every command, in order, with its condition) and runs nothing.
param(
  [switch]$DryRun,
  [string]$Ports = "django=8200,socket=4200,web=5374"
)
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$started = Get-Date
$ts = $started.ToString("yyyyMMdd-HHmmss")
if ($Ports -notmatch '^django=\d+,socket=\d+,web=\d+$') { Write-Host "check-run: -Ports must look like django=8200,socket=4200,web=5374"; exit 2 }

$where = @(& node scripts/ui-check/run.mjs --where 2>&1 | ForEach-Object { "$_" }) -match '^ui-check home: '
if (-not $where) { Write-Host "check-run: could not read the checkers' home (node scripts/ui-check/run.mjs --where)"; exit 2 }
$uicHome = ($where | Select-Object -First 1).Substring('ui-check home: '.Length).Trim()
$logDir = Join-Path $uicHome "logs"
$script:LogFile = Join-Path $logDir "check-$ts.log"
$stateFile = Join-Path $logDir "check-$ts.json"
$lock = Join-Path $uicHome "check-run.lock"
$claude = Get-Command claude -ErrorAction SilentlyContinue

function Log([string]$m) {
  $line = "$(Get-Date -Format 'HH:mm:ss') $m"
  Write-Host $line
  if (-not $DryRun) { Add-Content -LiteralPath $script:LogFile -Value $line -Encoding utf8 }
}

if ($DryRun) {
  $P = "--ports $Ports"
  $lockNote = "free"
  if (Test-Path $lock) { $lockNote = "held by pid $(Get-Content $lock -ErrorAction SilentlyContinue)" }
  $claudeNote = "not on PATH: agents are skipped, the Slack line says triage/judges needed"
  if ($claude) { $claudeNote = $claude.Source }
  @(
    "check-run (dry run) - nothing is executed",
    "repo     $repo",
    "home     $uicHome",
    "log      $script:LogFile (+ $stateFile)",
    "lock     $lock ($lockNote)",
    "claude   $claudeNote",
    "ports    $Ports",
    "env      .env.team -> NOTION_TOKEN, SLACK_BOT_TOKEN (loaded when present)",
    "1. node scripts/check-core/lib/channel.mjs resolve",
    "     -> resolved blocks; catchup-logic <LC ids>; catchup-ui <deferred UI ids>",
    "2a. if catchup-logic: node scripts/logic-check/run.mjs --only <catchup-logic> --ref main --keep-stack $P",
    "2b. if catchup-ui and 2a exit 0 (or nothing to re-run): node scripts/ui-check/run.mjs --only <catchup-ui> --vp all --ref main --keep-stack $P",
    "3a. node scripts/logic-check/run.mjs --suite all --ref main --live --keep-stack $P",
    "3b. if its digest has '## FAIL' sections: claude --dangerously-skip-permissions --model sonnet -p <logic-check skill, step 2 Triage, runDir/runId of 3a>",
    "     (the logic-check-triage agent writes findings/logic.json and files the owner advisories once: scripts/logic-check/lib/advisories.mjs)",
    "3c. if <runDir>/findings/logic.json: node scripts/ui-check/report.mjs --run <3a run id> --validate --keep-stack",
    "3d. node scripts/check-core/notion-push.mjs --run <3a run id> --checker logic --target main",
    "3e. node scripts/check-core/lib/channel.mjs block-run --run <3a run id>",
    "4a. node scripts/ui-check/run.mjs --suite all --ref main --keep-stack $P",
    "4b. node scripts/ui-check/run.mjs --live",
    "4c. per 4a/4b run whose digest has '## FAIL' sections: claude --dangerously-skip-permissions --model sonnet -p <ui-check skill, steps 2-3: judges + report.mjs --validate>",
    "4d. per 4a/4b run with findings.json: node scripts/check-core/notion-push.mjs --run <run id> --checker ui --target main",
    "5.  node scripts/check-core/lib/retain.mjs --home $uicHome",
    "6.  node scripts/check-core/lib/check-summary.mjs --state $stateFile --post   (one line to #pipeline)",
    "always: node scripts/ui-check/run.mjs --stop $P; remove $lock"
  ) | ForEach-Object { Write-Host $_ }
  exit 0
}

New-Item -ItemType Directory -Force $logDir | Out-Null
if (Test-Path $lock) {
  $oldPid = Get-Content $lock -ErrorAction SilentlyContinue
  if ($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
    Write-Host "check-run already running (pid $oldPid); exiting."
    exit 0
  }
  Remove-Item $lock -Force
}
Set-Content $lock $PID -Encoding ascii

# Load .env.team into this process (NOTION_TOKEN, SLACK_BOT_TOKEN), like team-run.ps1.
$envFile = Join-Path $repo ".env.team"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^([A-Z_]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), "Process") }
  }
}
# Every child (probe/verify/report of the agents too) defaults to this port set.
$env:UI_CHECK_PORTS = $Ports
# claude -p force-terminates after 600 s while a background task runs; judges and triage probe for longer (team-run.ps1).
$env:CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS = "1800000"

$state = [ordered]@{
  startedAt = $started.ToUniversalTime().ToString("o"); endedAt = $null
  runs = [ordered]@{}; exits = [ordered]@{}; cards = [ordered]@{}; blocks = [ordered]@{ new = 0; kept = 0 }; resolved = 0
  notes = New-Object System.Collections.Generic.List[string]
}

function Invoke-Node([string[]]$NodeArgs) {
  Log "> node $($NodeArgs -join ' ')"
  $lines = New-Object System.Collections.Generic.List[string]
  & node @NodeArgs 2>&1 | ForEach-Object { $s = "$_"; $lines.Add($s); Add-Content -LiteralPath $script:LogFile -Value $s -Encoding utf8 }
  $code = $LASTEXITCODE
  Log "  exit $code"
  return [pscustomobject]@{ Code = $code; Lines = $lines.ToArray() }
}

# The last output line matching $Pattern -> $Matches of it, else $null.
function Find-Match($Result, [string]$Pattern) {
  $hit = $Result.Lines | Where-Object { $_ -match $Pattern } | Select-Object -Last 1
  if ($hit -and ($hit -match $Pattern)) { return $Matches }
  return $null
}

# A checker run -> @{ Id; Code; Digest; RunDir; Fails } (Fails = number of '## FAIL' headers; -1 without a digest).
function Invoke-Checker([string]$Checker, [string[]]$NodeArgs) {
  $r = Invoke-Node $NodeArgs
  $id = Find-Match $r "^$Checker-check: run (\S+)"
  $dg = Find-Match $r "^$Checker-check: digest (.+)$"
  $o = [ordered]@{ Id = $null; Code = $r.Code; Digest = $null; RunDir = $null; Fails = -1 }
  if ($id) { $o.Id = $id[1] }
  if ($dg -and (Test-Path -LiteralPath $dg[1].Trim())) {
    $o.Digest = $dg[1].Trim(); $o.RunDir = Split-Path -Parent $o.Digest
    $o.Fails = @(Select-String -LiteralPath $o.Digest -Pattern '^## FAIL ').Count
  }
  Log "  $Checker run $($o.Id) exit $($o.Code), $($o.Fails) FAIL section(s)"
  return [pscustomobject]$o
}

function Invoke-Claude([string]$Label, [string]$Prompt) {
  if (-not $claude) { return $false }
  Log "> claude --model sonnet -p ($Label)"
  & claude --dangerously-skip-permissions --model sonnet -p $Prompt 2>&1 | ForEach-Object { Add-Content -LiteralPath $script:LogFile -Value "$_" -Encoding utf8 }
  Log "  claude exit $LASTEXITCODE"
  return $true
}

function Push-Cards([string]$Checker, [string]$RunId) {
  $r = Invoke-Node @("scripts/check-core/notion-push.mjs", "--run", $RunId, "--checker", $Checker, "--target", "main")
  $m = Find-Match $r '^notion-push done: (\d+) new \S (\d+) regression \S (\d+) skipped \S (\d+) error'
  if (-not $state.cards.Contains($Checker)) { $state.cards[$Checker] = [ordered]@{ new = 0; regression = 0; skipped = 0; errors = 0 } }
  $c = $state.cards[$Checker]
  if ($m) { $c.new += [int]$m[1]; $c.regression += [int]$m[2]; $c.skipped += [int]$m[3]; $c.errors += [int]$m[4] }
  elseif ($r.Code -ne 0) { $c.errors += 1 }
}

$exitCode = 0
try {
  Log "check-run $ts | repo $repo | home $uicHome | ports $Ports | claude $(if ($claude) { $claude.Source } else { 'not on PATH' })"
  $P = @("--ports", $Ports)

  # 1. Resolve blocks whose card is Done with its commit on origin/main.
  $res = Invoke-Node @("scripts/check-core/lib/channel.mjs", "resolve")
  $state.resolved = @($res.Lines | Where-Object { $_ -match '^resolved ' }).Count
  $cl = Find-Match $res '^catchup-logic (\S+)'
  $cu = Find-Match $res '^catchup-ui (\S+)'
  $catchLogic = if ($cl -and $cl[1] -ne '-') { $cl[1] } else { $null }
  $catchUi = if ($cu -and $cu[1] -ne '-') { $cu[1] } else { $null }

  # 2. Catch-up: Logic confirms the fix first; UI check then runs what it deferred.
  $logicGreen = $true
  if ($catchLogic) {
    $c = Invoke-Checker "logic" (@("scripts/logic-check/run.mjs", "--only", $catchLogic, "--ref", "main", "--keep-stack") + $P)
    $state.runs.logicCatchUp = $c.Id; $state.exits.logicCatchUp = $c.Code
    $logicGreen = ($c.Code -eq 0)
    if (-not $logicGreen) { $state.notes.Add("catch-up Logic still red: UI catch-up skipped") }
  }
  if ($catchUi -and $logicGreen) {
    $c = Invoke-Checker "ui" (@("scripts/ui-check/run.mjs", "--only", $catchUi, "--vp", "all", "--ref", "main", "--keep-stack") + $P)
    $state.runs.uiCatchUp = $c.Id; $state.exits.uiCatchUp = $c.Code
  }

  # 3. Logic Check on main (local + live) -> triage -> validate -> push -> blocks.
  $lg = Invoke-Checker "logic" (@("scripts/logic-check/run.mjs", "--suite", "all", "--ref", "main", "--live", "--keep-stack") + $P)
  $state.runs.logic = $lg.Id; $state.exits.logic = $lg.Code
  if ($lg.Code -eq 2 -or -not $lg.Digest) { $state.notes.Add("logic infra (exit $($lg.Code)), see $script:LogFile") }
  elseif ($lg.Fails -gt 0) {
    $prompt = "Run only step 2 (Triage) of the logic-check skill (.claude/skills/logic-check/SKILL.md) for runDir $($lg.RunDir), runId $($lg.Id), mode prod. The stack is up on $Ports (kept). Do not run the suites, report.mjs, notion-push, channel.mjs or run.mjs --stop: scripts/check-run.ps1 runs those. Return at most 10 lines."
    if (-not (Invoke-Claude "logic triage $($lg.Id)" $prompt)) {
      Log "triage needed (claude not on PATH): $($lg.Digest)"
      $state.notes.Add("logic triage needed: $($lg.Digest)")
    }
  }
  if ($lg.RunDir -and (Test-Path -LiteralPath (Join-Path $lg.RunDir "findings\logic.json"))) {
    $v = Invoke-Node @("scripts/ui-check/report.mjs", "--run", $lg.Id, "--validate", "--keep-stack")
    if ($v.Code -ne 0) { $state.notes.Add("logic validate exit $($v.Code)") }
    Push-Cards "logic" $lg.Id
    $b = Invoke-Node @("scripts/check-core/lib/channel.mjs", "block-run", "--run", $lg.Id)
    $bm = Find-Match $b '^block-run: (\d+) new \S (\d+) kept'
    if ($bm) { $state.blocks.new += [int]$bm[1]; $state.blocks.kept += [int]$bm[2] }
  }

  # 4. UI check on main, then the @live subset -> judges -> validate -> push. Blocks written in 3 defer their checks.
  $ui = Invoke-Checker "ui" (@("scripts/ui-check/run.mjs", "--suite", "all", "--ref", "main", "--keep-stack") + $P)
  $state.runs.ui = $ui.Id; $state.exits.ui = $ui.Code
  $live = Invoke-Checker "ui" @("scripts/ui-check/run.mjs", "--live")
  $state.runs.uiLive = $live.Id; $state.exits.uiLive = $live.Code
  foreach ($u in @($ui, $live)) {
    if ($u.Code -eq 2 -or -not $u.Digest) { $state.notes.Add("ui infra (exit $($u.Code)) run $($u.Id)"); continue }
    if ($u.Fails -gt 0) {
      $prompt = "Run only steps 2 and 3 of the ui-check skill (.claude/skills/ui-check/SKILL.md) for runDir $($u.RunDir), runId $($u.Id), mode prod: dispatch the judges for the suites that ran, then node scripts/ui-check/report.mjs --run $($u.Id) --validate (one re-dispatch round). The stack is up on $Ports (kept). Do not run steps 1, 1b, 3b or 4: scripts/check-run.ps1 runs the suites, pushes the cards and stops the stack. Return at most 10 lines."
      if (-not (Invoke-Claude "ui judges $($u.Id)" $prompt)) {
        Log "judges needed (claude not on PATH): $($u.Digest)"
        $state.notes.Add("ui judges needed: $($u.Digest)")
      }
    }
    if (Test-Path -LiteralPath (Join-Path $u.RunDir "findings.json")) { Push-Cards "ui" $u.Id }
  }

  # 5. Retention.
  $rt = Invoke-Node @("scripts/check-core/lib/retain.mjs", "--home", $uicHome)
  if ($rt.Code -ne 0) { $state.notes.Add("retain exit $($rt.Code)") }
} catch {
  $exitCode = 1
  Log "check-run aborted: $($_.Exception.Message)"
  $state.notes.Add("aborted: $($_.Exception.Message)")
} finally {
  Invoke-Node @("scripts/ui-check/run.mjs", "--stop", "--ports", $Ports) | Out-Null
  $state.endedAt = (Get-Date).ToUniversalTime().ToString("o")
  $state.notes = @($state.notes)
  try {
    $state | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $stateFile -Encoding utf8
    Invoke-Node @("scripts/check-core/lib/check-summary.mjs", "--state", $stateFile, "--post") | Out-Null
  } catch { Log "summary not posted: $($_.Exception.Message)" }
  Remove-Item $lock -Force -ErrorAction SilentlyContinue
  Log "check-run done in $([int]((Get-Date) - $started).TotalMinutes) min"
}
exit $exitCode
