# Rebuild ABUZ8 OS: pack src/ -> app.asar, swap into the install, relaunch.
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\rebuild.ps1
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$install = "$env:LOCALAPPDATA\Programs\ABUZ8 OS"
$resources = "$install\resources"

Write-Host "Packing $repo\src -> app.asar ..."
npx --yes @electron/asar pack "$repo\src" "$repo\app.asar"

if (Test-Path "$resources\app.asar") {
  Write-Host "Stopping running app ..."
  Get-Process "ABUZ8 OS" -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 2
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  Copy-Item "$resources\app.asar" "$resources\app.asar.bak-$stamp"
  Copy-Item "$repo\app.asar" "$resources\app.asar" -Force
  Write-Host "Installed. Relaunching ..."
  Start-Process "$install\ABUZ8 OS.exe"
  Write-Host "Done. Verify: curl http://127.0.0.1:8900/health"
} else {
  Write-Host "No existing install at $resources. app.asar is at $repo\app.asar - see BUILD.md to assemble a fresh install."
}
