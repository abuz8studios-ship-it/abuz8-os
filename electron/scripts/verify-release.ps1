param(
  [string]$VariantDir = "$PSScriptRoot\..\out\variants",
  [string]$OutputDir = (Join-Path $PSScriptRoot "..\out\release-verify"),
  [string[]]$Variants = @("lite", "standard", "pro")
)

$ErrorActionPreference = "Stop"

function Invoke-CoreJson {
  param(
    [string]$Method,
    [string]$Path,
    [object]$Body = $null,
    [int]$TimeoutSec = 30
  )
  $params = @{
    Uri = "http://127.0.0.1:8900$Path"
    Method = $Method
    UseBasicParsing = $true
    TimeoutSec = $TimeoutSec
  }
  if ($null -ne $Body) {
    $params.ContentType = "application/json"
    $params.Body = ($Body | ConvertTo-Json -Depth 12)
  }
  return (Invoke-WebRequest @params).Content | ConvertFrom-Json
}

function Try-CoreJson {
  param(
    [string]$Method,
    [string]$Path,
    [object]$Body = $null,
    [int]$TimeoutSec = 30
  )
  try {
    $value = Invoke-CoreJson -Method $Method -Path $Path -Body $Body -TimeoutSec $TimeoutSec
    return [pscustomobject]@{ Ok = $true; Value = $value; Error = "" }
  } catch {
    return [pscustomobject]@{ Ok = $false; Value = $null; Error = $_.Exception.Message }
  }
}

function Invoke-CoreBinary {
  param(
    [string]$Method,
    [string]$Path,
    [object]$Body = $null,
    [int]$TimeoutSec = 30
  )
  $params = @{
    Uri = "http://127.0.0.1:8900$Path"
    Method = $Method
    UseBasicParsing = $true
    TimeoutSec = $TimeoutSec
  }
  if ($null -ne $Body) {
    $params.ContentType = "application/json"
    $params.Body = ($Body | ConvertTo-Json -Depth 12)
  }
  $tmp = Join-Path $env:TEMP ("abuz8-bin-{0}.dat" -f ([guid]::NewGuid().ToString("N")))
  try {
    $params.OutFile = $tmp
    $resp = Invoke-WebRequest @params
    $contentType = ""
    try { $contentType = [string]$resp.Headers["Content-Type"] } catch {}
    return [pscustomobject]@{
      StatusCode = [int]$resp.StatusCode
      ContentType = $contentType
      Bytes = [byte[]][System.IO.File]::ReadAllBytes($tmp)
    }
  } finally {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  }
}

function Stop-CorePorts {
  $owners = Get-NetTCPConnection -LocalPort 8900,8902 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($id in $owners) {
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 800
}

function Wait-Core {
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      Invoke-WebRequest -Uri "http://127.0.0.1:8900/health" -UseBasicParsing -TimeoutSec 2 | Out-Null
      return $true
    } catch {}
  }
  return $false
}

function Test-McpBridge {
  param([string]$Command, [string]$Bridge)
  $script = @"
const { spawn } = require('child_process');
const child = spawn(process.argv[2], [process.argv[3]], {
  env: {...process.env, ABUZ8_CORE_URL:'http://127.0.0.1:8900'},
  stdio:['pipe','pipe','pipe'],
  windowsHide:true
});
let out = '';
let err = '';
child.stdout.on('data', d => {
  out += String(d);
  if (out.split(/\r?\n/).filter(Boolean).length >= 2) child.kill();
});
child.stderr.on('data', d => err += String(d));
child.on('exit', () => console.log(JSON.stringify({ out, err })));
child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{}}) + '\n');
child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}}) + '\n');
setTimeout(() => child.kill(), 10000);
"@
  $raw = $script | node - $Command $Bridge | ConvertFrom-Json
  $lines = $raw.out.Trim() -split "`r?`n" | Where-Object { $_ }
  if ($lines.Count -lt 2) { throw "MCP bridge did not return tools/list. stderr=$($raw.err)" }
  $tools = (($lines[1] | ConvertFrom-Json).result.tools | ForEach-Object name)
  foreach ($required in @("abuz8_chat","abuz8_device_probe","abuz8_brains_list","abuz8_brain_select","abuz8_memory_write","abuz8_tools_list","abuz8_tool_create","abuz8_tool_call","abuz8_mission_board","abuz8_mission_task_create","abuz8_mission_task_move")) {
    if ($tools -notcontains $required) { throw "MCP bridge missing tool: $required" }
  }
  return $tools
}

function Get-ProcessIdsByName {
  param([string[]]$Names)
  return @(Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $Names -contains $_.ProcessName } |
    Select-Object -ExpandProperty Id)
}

function Wait-NewProcess {
  param(
    [string[]]$Names,
    [int[]]$Before,
    [int]$TimeoutSec = 20
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $after = Get-ProcessIdsByName -Names $Names
    $new = @($after | Where-Object { $Before -notcontains $_ })
    if ($new.Count -gt 0) { return $new }
  }
  return @()
}

function Stop-Ids {
  param([int[]]$Ids)
  foreach ($id in @($Ids | Select-Object -Unique)) {
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
  }
}

function New-ToolProof {
  param(
    [bool]$Pass,
    [string]$Reason,
    [object]$Observed = $null,
    [bool]$Cleaned = $false
  )
  return [pscustomobject]@{
    Pass = $Pass
    Reason = $Reason
    Observed = $Observed
    Cleaned = $Cleaned
  }
}

function Test-ActionTools {
  param([string]$VariantName)

  $proof = [ordered]@{}
  $cleanup = @()

  $blockedBeforeConsent = Try-CoreJson -Method POST -Path "/api/tools/call" -Body @{
    tool = "open_app"
    args = @{ name = "mspaint" }
  } -TimeoutSec 10
  $proof.DeniedBeforeConsent = New-ToolProof `
    -Pass:(!$blockedBeforeConsent.Ok -and [string]$blockedBeforeConsent.Error -match "Allow actions|blocked|400") `
    -Reason $blockedBeforeConsent.Error `
    -Observed @{ accepted = $blockedBeforeConsent.Ok } `
    -Cleaned $true

  $consent = Invoke-CoreJson -Method POST -Path "/api/actions/consent" -Body @{ allow_actions = $true } -TimeoutSec 10
  if ($consent.allow_actions -ne $true) { throw "$VariantName action consent did not enable" }

  $browserNames = @("msedge", "chrome")
  $beforeBrowser = Get-ProcessIdsByName -Names $browserNames
  $openUrl = Try-CoreJson -Method POST -Path "/api/tools/call" -Body @{
    tool = "open_url"
    args = @{ url = "https://example.com/?abuz8_verify=$VariantName" }
  } -TimeoutSec 15
  $newBrowser = if ($openUrl.Ok) { Wait-NewProcess -Names $browserNames -Before $beforeBrowser -TimeoutSec 20 } else { @() }
  if ($newBrowser.Count -gt 0) {
    Stop-Ids -Ids $newBrowser
    $cleanup += "open_url browser pid(s) $($newBrowser -join ',') closed"
  }
  $proof.open_url = New-ToolProof `
    -Pass:($openUrl.Ok -and $newBrowser.Count -gt 0) `
    -Reason $(if ($openUrl.Ok) { "new browser process observed" } else { $openUrl.Error }) `
    -Observed @{ new_browser_pids = $newBrowser; accepted = $openUrl.Ok } `
    -Cleaned:($newBrowser.Count -gt 0)

  $beforePaint = Get-ProcessIdsByName -Names @("mspaint")
  $openApp = Try-CoreJson -Method POST -Path "/api/tools/call" -Body @{
    tool = "open_app"
    args = @{ name = "mspaint" }
  } -TimeoutSec 15
  $newPaint = if ($openApp.Ok) { Wait-NewProcess -Names @("mspaint") -Before $beforePaint -TimeoutSec 15 } else { @() }
  if ($newPaint.Count -gt 0) {
    Stop-Ids -Ids $newPaint
    $cleanup += "open_app mspaint pid(s) $($newPaint -join ',') closed"
  }
  $proof.open_app = New-ToolProof `
    -Pass:($openApp.Ok -and $newPaint.Count -gt 0) `
    -Reason $(if ($openApp.Ok) { "mspaint process observed" } else { $openApp.Error }) `
    -Observed @{ new_mspaint_pids = $newPaint; accepted = $openApp.Ok } `
    -Cleaned:($newPaint.Count -gt 0)

  $beforeAgentPaint = Get-ProcessIdsByName -Names @("mspaint")
  $agentPaint = Try-CoreJson -Method POST -Path "/api/chat" -Body @{
    content = "Open Paint"
    agentic = $true
  } -TimeoutSec 60
  $newAgentPaint = if ($agentPaint.Ok) { Wait-NewProcess -Names @("mspaint") -Before $beforeAgentPaint -TimeoutSec 15 } else { @() }
  if ($newAgentPaint.Count -gt 0) {
    Stop-Ids -Ids $newAgentPaint
    $cleanup += "agentic chat mspaint pid(s) $($newAgentPaint -join ',') closed"
  }
  $proof.agentic_chat_open_app = New-ToolProof `
    -Pass:($agentPaint.Ok -and $newAgentPaint.Count -gt 0 -and [string]$agentPaint.Value.tool_call.tool -eq "open_app") `
    -Reason $(if ($agentPaint.Ok) { "chat agent path opened mspaint through dispatcher" } else { $agentPaint.Error }) `
    -Observed @{ new_mspaint_pids = $newAgentPaint; accepted = $agentPaint.Ok; tool_call = $agentPaint.Value.tool_call } `
    -Cleaned:($newAgentPaint.Count -gt 0)

  $shot = Try-CoreJson -Method POST -Path "/api/tools/call" -Body @{
    tool = "screenshot"
    args = @{}
  } -TimeoutSec 30
  $shotFile = if ($shot.Ok) { [string]$shot.Value.result.file } else { "" }
  $shotExists = $shotFile -and (Test-Path -LiteralPath $shotFile)
  $shotInfo = if ($shotExists) { Get-Item -LiteralPath $shotFile } else { $null }
  $shotRecent = $shotInfo -and $shotInfo.Length -gt 0 -and $shotInfo.LastWriteTime -gt (Get-Date).AddSeconds(-10)
  if ($shotExists) {
    Remove-Item -LiteralPath $shotFile -Force -ErrorAction SilentlyContinue
    $cleanup += "screenshot artifact deleted"
  }
  $proof.screenshot = New-ToolProof `
    -Pass:($shot.Ok -and $shotRecent) `
    -Reason $(if ($shot.Ok) { "PNG exists, size > 0, mtime within 10s" } else { $shot.Error }) `
    -Observed @{ artifact = $(if ($shotFile) { Split-Path -Leaf $shotFile } else { "" }); bytes = $(if ($shotInfo) { $shotInfo.Length } else { 0 }); recent = [bool]$shotRecent } `
    -Cleaned:($shotExists -and !(Test-Path -LiteralPath $shotFile))

  $content = "ABUZ8_ACTION_FILE_WRITE_$VariantName"
  $relpath = "workspaces\verify-action-$VariantName.txt"
  $write = Try-CoreJson -Method POST -Path "/api/tools/call" -Body @{
    tool = "file_write"
    args = @{ relpath = $relpath; content = $content }
  } -TimeoutSec 15
  $writeFile = if ($write.Ok) { [string]$write.Value.result.file } else { "" }
  $writeExact = $false
  if ($writeFile -and (Test-Path -LiteralPath $writeFile)) {
    $writeExact = ((Get-Content -LiteralPath $writeFile -Raw) -eq $content)
    Remove-Item -LiteralPath $writeFile -Force -ErrorAction SilentlyContinue
    $cleanup += "file_write artifact deleted"
  }
  $proof.file_write = New-ToolProof `
    -Pass:($write.Ok -and $writeExact) `
    -Reason $(if ($write.Ok) { "file exists with exact content" } else { $write.Error }) `
    -Observed @{ artifact = $(if ($writeFile) { Split-Path -Leaf $writeFile } else { "" }); exact_content = $writeExact } `
    -Cleaned:($writeFile -and !(Test-Path -LiteralPath $writeFile))

  $hostCall = Try-CoreJson -Method POST -Path "/api/tools/call" -Body @{
    tool = "shell_run"
    args = @{ cmd = "hostname" }
  } -TimeoutSec 15
  $hostToken = $env:COMPUTERNAME
  $hostStdout = if ($hostCall.Ok) { [string]$hostCall.Value.result.stdout } else { "" }
  $blockedShell = Try-CoreJson -Method POST -Path "/api/tools/call" -Body @{
    tool = "shell_run"
    args = @{ cmd = "powershell" }
  } -TimeoutSec 10
  $proof.shell_run = New-ToolProof `
    -Pass:($hostCall.Ok -and $hostStdout.Trim() -match [regex]::Escape($hostToken) -and !$blockedShell.Ok) `
    -Reason $(if ($hostCall.Ok) { "hostname stdout contains machine name and disallowed command is blocked" } else { $hostCall.Error }) `
    -Observed @{ host_matched = ($hostStdout.Trim() -match [regex]::Escape($hostToken)); denied_command_blocked = !$blockedShell.Ok; denied_error = $blockedShell.Error } `
    -Cleaned $true

  $escape = Try-CoreJson -Method POST -Path "/api/tools/call" -Body @{
    tool = "file_write"
    args = @{ relpath = "..\escape.txt"; content = "blocked" }
  } -TimeoutSec 10
  $proof.FileWriteEscapeBlocked = New-ToolProof `
    -Pass:(!$escape.Ok) `
    -Reason $escape.Error `
    -Observed @{ accepted = $escape.Ok } `
    -Cleaned $true

  $allPass = $true
  foreach ($item in $proof.GetEnumerator()) {
    if ($item.Value.Pass -ne $true) { $allPass = $false }
  }

  return [pscustomobject]@{
    AllPass = $allPass
    ConsentGranted = $true
    Cleanup = $cleanup
    Proof = [pscustomobject]$proof
  }
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
Stop-CorePorts

$allVariants = @(
  @{ Name = "lite"; Expected = "LFM2.5 350M Lite"; Brain = "lite" },
  @{ Name = "standard"; Expected = "LFM2 1.2B Tool"; Brain = "standard" },
  @{ Name = "pro"; Expected = "LFM2 2.6B Pro"; Brain = "pro" },
  @{ Name = "consumer-pro-2.6b"; Expected = "LFM2 2.6B Pro"; Brain = "pro" }
)
$requestedVariants = @($Variants | ForEach-Object { ([string]$_).Split(',', [System.StringSplitOptions]::RemoveEmptyEntries) } | ForEach-Object { $_.Trim().ToLowerInvariant() })
$variantsToRun = @($allVariants | Where-Object { $requestedVariants -contains $_.Name })
if ($variantsToRun.Count -eq 0) { throw "No matching variants requested: $($Variants -join ', ')" }

$results = @()
foreach ($v in $variantsToRun) {
  $exe = Join-Path $VariantDir "ABUZ8_OS-1.0.0-$($v.Name)-portable.exe"
  if (!(Test-Path -LiteralPath $exe)) { throw "Missing portable artifact: $exe" }

  $env:ABUZ8_DATA_DIR = Join-Path $OutputDir "$($v.Name)-data"
  $env:APPDATA = Join-Path $OutputDir "$($v.Name)-appdata"
  New-Item -ItemType Directory -Force -Path $env:ABUZ8_DATA_DIR,$env:APPDATA | Out-Null

  $proc = Start-Process -FilePath $exe -PassThru
  try {
    if (!(Wait-Core)) { throw "$($v.Name) did not expose /health" }
    $probe = Invoke-CoreJson -Method GET -Path "/api/device/probe" -TimeoutSec 30
    $chat = Invoke-CoreJson -Method POST -Path "/api/chat" -Body @{ content = "One sentence: verify $($v.Name) release brain." } -TimeoutSec 180
    if ($chat.fallback -ne $false) { throw "$($v.Name) used fallback brain" }
    if ([string]$chat.brain -ne $v.Expected) { throw "$($v.Name) expected '$($v.Expected)' but got '$($chat.brain)'" }

    $gateCli = $null
    try { $gateCli = Invoke-CoreJson -Method POST -Path "/api/cli/probe" -Body @{ command = "node"; args = @("--version") } -TimeoutSec 10 } catch { $gateCli = $_.Exception.Message }
    $cli = Invoke-CoreJson -Method POST -Path "/api/cli/probe" -Body @{ command = "node"; args = @("--version"); allow_cli = $true } -TimeoutSec 20
    $reg = Invoke-CoreJson -Method POST -Path "/api/cli/register" -Body @{ name = "node"; command = "node"; args = @("--version"); allow_cli = $true } -TimeoutSec 20
    $models = Invoke-CoreJson -Method GET -Path "/api/models/list" -TimeoutSec 20
    $missionBefore = Invoke-CoreJson -Method GET -Path "/api/mission/board" -TimeoutSec 20
    $missionTask = Invoke-CoreJson -Method POST -Path "/api/mission/task" -Body @{ title = "Verify $($v.Name) packaged mission board"; column = "verify"; priority = "high"; owner = "release-verifier" } -TimeoutSec 20
    $missionMove = Invoke-CoreJson -Method POST -Path "/api/mission/move" -Body @{ id = $missionTask.task.id; column = "done" } -TimeoutSec 20
    $toolCreate = Invoke-CoreJson -Method POST -Path "/api/tools/create" -Body @{ name = "verify-$($v.Name)-tool"; description = "Release verifier local tool"; type = "manual" } -TimeoutSec 20
    $toolCall = Invoke-CoreJson -Method POST -Path "/api/tools/call" -Body @{ tool = "abuz8_device_probe"; args = @{} } -TimeoutSec 30
    $actionTools = Test-ActionTools -VariantName $v.Name
    $brainSelect = Invoke-CoreJson -Method POST -Path "/api/brains/select" -Body @{ brain = $v.Brain } -TimeoutSec 20
    $toolsList = Invoke-CoreJson -Method GET -Path "/api/tools/list" -TimeoutSec 20
    $voiceStatus = Invoke-CoreJson -Method GET -Path "/api/voice/status" -TimeoutSec 20
    $ttsAudio = Invoke-CoreBinary -Method POST -Path "/api/tts" -Body @{ text = "ABUZ8 native TTS release verification."; voice = "" } -TimeoutSec 40
    $ttsHeader = if ($ttsAudio.Bytes.Length -ge 12) {
      [System.Text.Encoding]::ASCII.GetString($ttsAudio.Bytes[0..3]) + "/" + [System.Text.Encoding]::ASCII.GetString($ttsAudio.Bytes[8..11])
    } else { "" }
    $nativeTtsAvailable = ([string]$voiceStatus.native_tts).ToLowerInvariant() -eq "true"
    $nativeTtsPass = (
      ($nativeTtsAvailable -eq $true) -and
      ($ttsHeader -eq "RIFF/WAVE") -and
      ($ttsAudio.Bytes.Length -gt 1000)
    )

    $mcpTools = @()
    if ($v.Name -eq "pro" -or $v.Name -eq "consumer-pro-2.6b") {
      $sym = Invoke-CoreJson -Method POST -Path "/api/mcp/install/claude-symbiote" -Body @{} -TimeoutSec 20
      if (!(Test-Path -LiteralPath $sym.server.command)) { throw "Claude symbiote node.exe was not persisted" }
      if (!(Test-Path -LiteralPath $sym.server.args[0])) { throw "Claude symbiote bridge was not persisted" }
      $mcpTools = Test-McpBridge -Command $sym.server.command -Bridge $sym.server.args[0]
    }

    $embeddedModels = @($models.embedded | Where-Object { $_.embedded -eq $true })
    $consumerSingleProBrain = $true
    if ($v.Name -eq "consumer-pro-2.6b") {
      $consumerSingleProBrain = (
        $embeddedModels.Count -eq 1 -and
        [string]$embeddedModels[0].model_file -eq "LFM2-2.6B-Exp-Q4_K_M.gguf" -and
        [string]$embeddedModels[0].tier -eq "pro"
      )
    }

    $allPass = (
      ($chat.fallback -eq $false) -and
      ($probe.tier -ne $null) -and
      ($embeddedModels.Count -gt 0) -and
      $consumerSingleProBrain -and
      ($cli.result.ok -eq $true) -and
      ($reg.ok -eq $true) -and
      ($missionMove.task.column -eq "done") -and
      ($toolCreate.ok -eq $true) -and
      ($toolCall.ok -eq $true) -and
      ($actionTools.AllPass -eq $true) -and
      ($nativeTtsPass -eq $true) -and
      ($brainSelect.ok -eq $true) -and
      (@($toolsList.tools).Count -gt 0) -and
      ([string]$gateCli -match "403|allow_cli")
    )

    $results += [pscustomobject]@{
      Variant = $v.Name
      AllPass = $allPass
      Brain = $chat.brain
      Fallback = $chat.fallback
      ProbeTier = $probe.tier
      EmbeddedCount = $embeddedModels.Count
      EmbeddedModels = @($embeddedModels | ForEach-Object { $_.model_file })
      CliProbe = $cli.result.ok
      CliRegistered = $reg.ok
      MissionTasksBefore = @($missionBefore.tasks).Count
      MissionTaskMoved = ($missionMove.task.column -eq "done")
      ToolCreated = $toolCreate.ok
      ToolCallWorked = $toolCall.ok
      ActionTools = $actionTools
      NativeTts = [pscustomobject]@{
        Pass = $nativeTtsPass
        Available = $nativeTtsAvailable
        StatusCode = $ttsAudio.StatusCode
        Engine = $voiceStatus.native_tts_engine
        NativeStt = $voiceStatus.native_stt
        BrowserStt = $voiceStatus.browser_stt
        Voices = @($voiceStatus.voices)
        AudioBytes = $ttsAudio.Bytes.Length
        Header = $ttsHeader
      }
      BrainSelectWorked = $brainSelect.ok
      ToolsCount = @($toolsList.tools).Count
      PermissionGateChecked = ([string]$gateCli -match "403|allow_cli")
      McpTools = ($mcpTools -join ",")
    }
  } finally {
    Stop-CorePorts
  }
}

$results | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $OutputDir "release-verify.json") -Encoding UTF8
$results | Format-Table -AutoSize
