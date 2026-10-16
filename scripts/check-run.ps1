# Nightly checks (Task Scheduler task `nba-checks`, registered by scripts/register-check-cron.ps1; spec section 7 of
# docs/superpowers/specs/2026-10-15-checks-prod-logic-design.md; docs/logic-check/README.md "The nightly run"):
#   0. lock; stop whatever still runs on -Ports (a killed night, a daytime --keep-stack); commit leftover notes; update
#      the tooling worktree (branch checks-nightly: fetch origin dev, ff-only merge, else rebase, conflict = stop)
#   1. channel resolve (Notion card Done + its Commit on origin/main) -> resolved blocks + catch-up lists
#   2. catch-up: Logic re-runs the resolved services' checks; if green, UI check runs the deferred checks (--only)
#   3. Logic Check on main (local suites + live) -> triage agent (only when the digest has FAIL sections)
#      -> report.mjs --validate -> notion-push --checker logic -> channel block-run (blocks for the pushed findings)
#   4. UI check on main (local, then the @live subset) -> the ui-check judges (only on FAIL sections)
#      -> validate (by the skill) -> notion-push --checker ui
#   5. retain.mjs (runs, notes, channel, cards ledger)
#   6. stop the stack; commit the notes on checks-nightly and push origin/checks-nightly (never dev); one Slack line
# The TOOLING runs from the worktree this script lives in (<worktreeRoot>\checks-nightly, created by the register
# script); the app under test is always `--ref main` (<worktreeRoot>\check-main). The script refuses the main checkout
# unless -AllowMainCheckout. UI_CHECK_HOME is pinned to %LOCALAPPDATA%\nba-ui-check (shared with the skills).
# Agents run through `claude -p` (Sonnet, as team-run.ps1) in a child process with a watchdog: killed with its process
# tree after -AgentTimeoutSec (default 45 min), noted as "agent timed out: <step>". Without `claude` on PATH the digest
# path goes to the log and the Slack line says "triage needed". Scripts never read digest bodies (only `## FAIL` headers).
# Lockfile <uicHome>/check-run.lock (a live PID = another run: exit 0); log <uicHome>/logs/check-<ts>.log (+ .json state).
# Every normal or failed exit stops the stack on -Ports and releases the lock; a hard kill (the task's time limit) cannot,
# and the next night's step 0 stops what it left.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-run.ps1 [-DryRun] [-Ports django=8210,socket=4210,web=5384]
#                                                    [-AllowMainCheckout] [-AgentTimeoutSec 2700]
# -DryRun prints the plan (every command, in order, with its condition) and runs nothing.
# The nightly has its own port set (8210/4210/5384): the checker default 8200/4200/5374 is what interactive skill runs
# take, and a stack another session left there (another checkout's sqlite) would make every suite stop at stack-setup.
param(
  [switch]$DryRun,
  [string]$Ports = "django=8210,socket=4210,web=5384",
  [switch]$AllowMainCheckout,
  [int]$AgentTimeoutSec = 2700
)
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$started = Get-Date
$ts = $started.ToString("yyyyMMdd-HHmmss")
if ($Ports -notmatch '^django=\d+,socket=\d+,web=\d+$') { Write-Host "check-run: -Ports must look like django=8210,socket=4210,web=5384"; exit 2 }

# The main checkout (first `git worktree list` entry): the owner's working tree, never the nightly's tooling.
$mainCheckout = $null
$wl = @(& git worktree list --porcelain 2>$null) | Where-Object { $_ -like 'worktree *' } | Select-Object -First 1
if ($wl) { $mainCheckout = [IO.Path]::GetFullPath($wl.Substring(9)) }
$isMain = $mainCheckout -and ([IO.Path]::GetFullPath($repo).TrimEnd('\') -ieq $mainCheckout.TrimEnd('\'))
$branch = "$(& git rev-parse --abbrev-ref HEAD 2>$null)".Trim()
if ($isMain -and -not $AllowMainCheckout -and -not $DryRun) {
  Write-Host "check-run: refusing to run from the main checkout ($repo): the nightly runs from <worktreeRoot>\checks-nightly (scripts/register-check-cron.ps1). Pass -AllowMainCheckout to run here anyway."
  exit 2
}

# One home for the nightly and the skills, whichever checkout the tooling runs from.
if (-not $env:UI_CHECK_HOME) { $env:UI_CHECK_HOME = Join-Path $env:LOCALAPPDATA "nba-ui-check" }
$where = @(& node scripts/ui-check/run.mjs --where 2>&1 | ForEach-Object { "$_" }) -match '^ui-check home: '
if (-not $where) { Write-Host "check-run: could not read the checkers' home (node scripts/ui-check/run.mjs --where)"; exit 2 }
$uicHome = ($where | Select-Object -First 1).Substring('ui-check home: '.Length).Trim()
$logDir = Join-Path $uicHome "logs"
$script:LogFile = Join-Path $logDir "check-$ts.log"
$stateFile = Join-Path $logDir "check-$ts.json"
$lock = Join-Path $uicHome "check-run.lock"
$claude = Get-Command claude -ErrorAction SilentlyContinue
$NOTES = @("scripts/ui-check/notes", "scripts/logic-check/notes")

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
  $tooling = "$branch (used as is: only branch checks-nightly updates itself)"
  if ($branch -eq 'checks-nightly') { $tooling = "checks-nightly (updated from origin/dev each night)" }
  if ($isMain -and -not $AllowMainCheckout) { $tooling = "$branch - REFUSED: this is the main checkout (pass -AllowMainCheckout)" }
  @(
    "check-run (dry run) - nothing is executed",
    "repo     $repo",
    "tooling  $tooling",
    "home     $uicHome (UI_CHECK_HOME)",
    "log      $script:LogFile (+ $stateFile)",
    "lock     $lock ($lockNote)",
    "claude   $claudeNote; watchdog $AgentTimeoutSec s per agent (process tree killed)",
    "ports    $Ports",
    "env      .env.team of $repo or of the main checkout -> NOTION_TOKEN, SLACK_BOT_TOKEN",
    "0a. node scripts/ui-check/run.mjs --stop $P   (a stale stack is never reused)",
    "0b. if branch checks-nightly: git add $($NOTES -join ' ') + git commit -m 'checks: notes <date>' (leftovers of a killed night)",
    "0c. if branch checks-nightly: git fetch origin dev; git merge --ff-only origin/dev, else git rebase origin/dev (conflict: rebase --abort, stop, Slack); npm ci when package-lock.json changed",
    "1. node scripts/check-core/lib/channel.mjs resolve",
    "     -> resolved blocks; catchup-logic <local LC ids>; catchup-ui <deferred UI ids>",
    "2a. if catchup-logic: node scripts/logic-check/run.mjs --only <catchup-logic> --ref main --keep-stack $P",
    "2b. if catchup-ui and 2a exit 0 (or nothing to re-run): node scripts/ui-check/run.mjs --only <catchup-ui> --vp all --ref main --keep-stack $P",
    "     (catch-up runs are not judged or pushed: the full runs below cover them)",
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
    "6a. node scripts/ui-check/run.mjs --stop $P",
    "6b. if branch checks-nightly: git commit the notes ('checks: notes <date>'); git push --force-with-lease origin checks-nightly",
    "6c. node scripts/check-core/lib/check-summary.mjs --state $stateFile --post   (one line to #pipeline)",
    "6d. remove $lock"
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

# Load .env.team into this process (NOTION_TOKEN, SLACK_BOT_TOKEN), like team-run.ps1: this checkout's, else the
# main checkout's (the checks-nightly worktree has none).
$envFile = Join-Path $repo ".env.team"
if (-not (Test-Path $envFile) -and $mainCheckout) { $envFile = Join-Path $mainCheckout ".env.team" }
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

# One agent: `claude -p` in a child PowerShell (prompt from a file, output to a file), killed with its whole process
# tree after $AgentTimeoutSec. -> 'missing' (no claude on PATH) | 'timeout' | 'done'.
function Invoke-Claude([string]$Label, [string]$Prompt) {
  if (-not $claude) { return 'missing' }
  Log "> claude --model sonnet -p ($Label), watchdog $AgentTimeoutSec s"
  $base = Join-Path $logDir ("check-$ts-agent-" + ($Label -replace '[^\w.-]+', '-'))
  $promptFile = "$base.prompt.txt"; $outFile = "$base.out.txt"
  Set-Content -LiteralPath $promptFile -Value $Prompt -Encoding utf8
  $inner = "& claude --dangerously-skip-permissions --model sonnet -p (Get-Content -Raw -LiteralPath '$promptFile') *>&1 | Out-File -LiteralPath '$outFile' -Encoding utf8; exit `$LASTEXITCODE"
  $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($inner))
  $p = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -ArgumentList "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $enc" -WorkingDirectory $repo -WindowStyle Hidden -PassThru
  $null = $p.Handle # keeps ExitCode readable after the exit (Windows PowerShell 5.1)
  $result = 'done'
  if ($p.WaitForExit($AgentTimeoutSec * 1000)) { Log "  claude exit $($p.ExitCode)" }
  else {
    & taskkill /PID $p.Id /T /F 2>&1 | ForEach-Object { Add-Content -LiteralPath $script:LogFile -Value "$_" -Encoding utf8 }
    Log "  agent timed out: $Label (process tree killed after $AgentTimeoutSec s)"
    $state.notes.Add("agent timed out: $Label")
    $result = 'timeout'
  }
  if (Test-Path -LiteralPath $outFile) { Get-Content -LiteralPath $outFile | Add-Content -LiteralPath $script:LogFile -Encoding utf8 }
  Remove-Item -LiteralPath $promptFile, $outFile -Force -ErrorAction SilentlyContinue
  return $result
}

function Invoke-Git([string[]]$GitArgs) {
  Log "> git $($GitArgs -join ' ')"
  & git @GitArgs 2>&1 | ForEach-Object { Add-Content -LiteralPath $script:LogFile -Value "$_" -Encoding utf8 }
  return $LASTEXITCODE
}

# The notes the agents and retain.mjs changed -> one commit on checks-nightly (-Push: and origin/checks-nightly).
function Save-Notes([switch]$Push) {
  if ($branch -ne 'checks-nightly') { return }
  Invoke-Git (@("add", "--") + $NOTES) | Out-Null
  & git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) { Invoke-Git @("commit", "-q", "-m", "checks: notes $(Get-Date -Format 'yyyy-MM-dd')") | Out-Null }
  if ($Push) {
    $ahead = "$(& git rev-list --count origin/checks-nightly..HEAD 2>$null)".Trim()
    if ($LASTEXITCODE -ne 0 -or $ahead -ne '0') {
      if ((Invoke-Git @("push", "--quiet", "--force-with-lease", "origin", "checks-nightly")) -ne 0) { $state.notes.Add("notes push to origin/checks-nightly failed") }
    }
  }
}

# checks-nightly follows origin/dev: ff-only, else rebase its notes commits; a conflict stops the night. -> $true | $false
function Update-Tooling {
  if ($branch -ne 'checks-nightly') { Log "tooling: $repo on branch $branch, used as is"; return $true }
  if ((Invoke-Git @("fetch", "--quiet", "origin", "dev")) -ne 0) { $state.notes.Add("git fetch origin dev failed: tooling not updated"); return $true }
  if ((Invoke-Git @("merge", "--ff-only", "--quiet", "origin/dev")) -ne 0) {
    if ((Invoke-Git @("rebase", "origin/dev")) -ne 0) {
      Invoke-Git @("rebase", "--abort") | Out-Null
      return $false
    }
  }
  # node_modules follows package-lock.json (stamp = its blob id).
  $lockId = "$(& git rev-parse HEAD:package-lock.json 2>$null)".Trim()
  $stamp = Join-Path $repo "node_modules\.nightly-lock-stamp"
  $have = if (Test-Path -LiteralPath $stamp) { (Get-Content -LiteralPath $stamp -Raw).Trim() } else { '' }
  if ($lockId -and $have -ne $lockId) {
    Log "> npm ci (package-lock.json changed)"
    & npm ci 2>&1 | ForEach-Object { Add-Content -LiteralPath $script:LogFile -Value "$_" -Encoding utf8 }
    if ($LASTEXITCODE -eq 0) { Set-Content -LiteralPath $stamp -Value $lockId -Encoding ascii } else { $state.notes.Add("npm ci failed in the tooling worktree") }
  }
  Log "tooling: checks-nightly @ $("$(& git rev-parse --short HEAD)".Trim())"
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
  Log "check-run $ts | repo $repo ($branch) | home $uicHome | ports $Ports | claude $(if ($claude) { $claude.Source } else { 'not on PATH' })"
  $P = @("--ports", $Ports)

  # 0. Never reuse a stale stack (a killed night, a daytime --keep-stack); then bring the tooling up to date.
  Invoke-Node @("scripts/ui-check/run.mjs", "--stop", "--ports", $Ports) | Out-Null
  Save-Notes
  if (-not (Update-Tooling)) { throw "checks-nightly: rebase on origin/dev conflicts, nightly stopped (resolve it in $repo)" }

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
    if ($c.Code -ne 0 -and $c.Code -ne 1) { $state.notes.Add("logic run infra exit $($c.Code) (catch-up $($c.Id)), see $script:LogFile") }
    if (-not $logicGreen) { $state.notes.Add("catch-up Logic still red: UI catch-up skipped") }
  }
  if ($catchUi -and $logicGreen) {
    $c = Invoke-Checker "ui" (@("scripts/ui-check/run.mjs", "--only", $catchUi, "--vp", "all", "--ref", "main", "--keep-stack") + $P)
    $state.runs.uiCatchUp = $c.Id; $state.exits.uiCatchUp = $c.Code
  }

  # 3. Logic Check on main (local + live) -> triage -> validate -> push -> blocks.
  $lg = Invoke-Checker "logic" (@("scripts/logic-check/run.mjs", "--suite", "all", "--ref", "main", "--live", "--keep-stack") + $P)
  $state.runs.logic = $lg.Id; $state.exits.logic = $lg.Code
  if (($lg.Code -ne 0 -and $lg.Code -ne 1) -or -not $lg.Digest) { $state.notes.Add("logic run infra exit $($lg.Code) (run $($lg.Id)), see $script:LogFile") }
  elseif ($lg.Fails -gt 0) {
    $prompt = "Run only step 2 (Triage) of the logic-check skill (.claude/skills/logic-check/SKILL.md) for runDir $($lg.RunDir), runId $($lg.Id), mode prod. The stack is up on $Ports (kept). Do not run the suites, report.mjs, notion-push, channel.mjs or run.mjs --stop: scripts/check-run.ps1 runs those. Return at most 10 lines."
    if ((Invoke-Claude "logic triage $($lg.Id)" $prompt) -eq 'missing') {
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
      if ((Invoke-Claude "ui judges $($u.Id)" $prompt) -eq 'missing') {
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
  try { Save-Notes -Push } catch { Log "notes not saved: $($_.Exception.Message)" }
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
