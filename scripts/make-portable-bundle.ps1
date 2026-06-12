# Assemble a fully self-contained, USB-copyable ABUZ8 OS portable bundle.
# Includes the app, the bundled llama.cpp brain, the downloaded NVIDIA Nemotron
# model, all attachments (Piper voices, Whisper, Playwright + Chromium), config,
# soul, skills, memory, and a launcher that points the app at the bundled data.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\make-portable-bundle.ps1 -Target "E:\ABUZ8-Portable"
#
param(
  [Parameter(Mandatory=$true)][string]$Target
)
$ErrorActionPreference = 'Stop'
$install = "$env:LOCALAPPDATA\Programs\ABUZ8 OS"
$data    = "$env:APPDATA\abuz8-os"

if (-not (Test-Path $install)) { throw "ABUZ8 OS install not found at $install" }
Write-Host "Building lean portable bundle at $Target ..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $Target | Out-Null

# 1. The app (Electron + resources). The LFM brains were removed; resources\brain
#    now holds only the small llama.cpp runtime that loads the NVIDIA model.
Write-Host "  - copying app (lean, ~0.45 GB)..."
Copy-Item -Recurse -Force "$install" "$Target\ABUZ8 OS"
# Safety: drop any stray bundled GGUFs so old LFM files never bloat the bundle.
Get-ChildItem "$Target\ABUZ8 OS\resources\brain" -Filter *.gguf -ErrorAction SilentlyContinue | Remove-Item -Force

# 2. The data the app reads at runtime (NVIDIA model, voices, config...). Cache and
#    logs are intentionally NOT copied.
Write-Host "  - copying data (NVIDIA Nemotron model, voices, config, skills)..."
$dataDest = "$Target\ABUZ8_OS_Data"
New-Item -ItemType Directory -Force -Path $dataDest | Out-Null
foreach ($d in 'config','soul','skills','mcp','memory','mission','attachments','models','exports') {
  if (Test-Path "$data\$d") { Copy-Item -Recurse -Force "$data\$d" "$dataDest\$d" }
}

# 3. Launcher: point the app at the bundled data, then start it. Playwright uses
#    the target machine's Edge/Chrome, so no Chromium is bundled.
$bat = @'
@echo off
set "HERE=%~dp0"
set "ABUZ8_DATA_DIR=%HERE%ABUZ8_OS_Data"
start "" "%HERE%ABUZ8 OS\ABUZ8 OS.exe"
'@
Set-Content -Path "$Target\Launch-ABUZ8.bat" -Value $bat -Encoding ASCII

# 5. Readme
$readme = @'
ABUZ8 OS - Portable Bundle
==========================
Self-contained. Copy this whole folder to a USB drive or the target machine,
then double-click Launch-ABUZ8.bat.

Lean build (~4 GB) - LFM brains removed, NVIDIA Nemotron is the brain.

Included and working offline anywhere:
  - The app + llama.cpp runtime (loads the NVIDIA brain)
  - NVIDIA Nemotron 3 Nano 4B tool-calling brain (ABUZ8_OS_Data\models)
  - Neural voice (Piper) + voices, offline hearing (Whisper)  -> ABUZ8_OS_Data\attachments
  - Playwright browser automation (drives the machine's Edge/Chrome - no Chromium bundled)
  - Your config, soul/personality/mission, skills, memory, mission board

Requires on the target machine:
  - Windows 10/11 x64 (Edge is built in, used by Playwright).
  - PyAutoGUI desktop control needs Python 3 + "pip install pyautogui pillow"
    on the target (everything else is bundled and standalone).

The launcher sets ABUZ8_DATA_DIR so the app uses the bundled data regardless of
the machine it runs on.
'@
Set-Content -Path "$Target\README.txt" -Value $readme -Encoding ASCII

$size = (Get-ChildItem -Recurse $Target | Measure-Object -Property Length -Sum).Sum / 1GB
Write-Host ("Done. Bundle is {0:N1} GB at {1}" -f $size, $Target) -ForegroundColor Green
Write-Host "Run it anywhere with: $Target\Launch-ABUZ8.bat"
