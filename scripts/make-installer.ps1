# Build ABUZ8-Setup.exe — a single one-click installer that deploys the lean
# portable bundle to the user's LocalAppData, makes a Desktop shortcut, and
# launches the app (which runs the cinematic system-probe boot).
$ErrorActionPreference = 'Stop'
$install = "$env:LOCALAPPDATA\Programs\ABUZ8 OS"
$data    = "$env:APPDATA\abuz8-os"
$z7a     = "C:\tmp\7zextra\7za.exe"
$sfx     = "C:\tmp\7zinstall\7z.sfx"
$stage   = "C:\tmp\abuz8-stage"
$arc     = "C:\tmp\abuz8-bundle.7z"
$out     = "C:\tmp\ABUZ8-Setup.exe"

Write-Host "Staging..."
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path "$stage" | Out-Null
robocopy "$install" "$stage\ABUZ8 OS" /E /NFL /NDL /NJH /NJS /NP | Out-Null
Get-ChildItem "$stage\ABUZ8 OS\resources\brain" -Filter *.gguf -ErrorAction SilentlyContinue | Remove-Item -Force
New-Item -ItemType Directory -Force -Path "$stage\ABUZ8_OS_Data" | Out-Null
foreach ($d in 'config','soul','skills','mcp','memory','mission','attachments','models','exports') {
  if (Test-Path "$data\$d") { robocopy "$data\$d" "$stage\ABUZ8_OS_Data\$d" /E /NFL /NDL /NJH /NJS /NP | Out-Null }
}

# install.bat — deploys to LocalAppData, makes shortcut, launches.
$installer = @'
@echo off
title ABUZ8 OS Setup
set "DEST=%LOCALAPPDATA%\ABUZ8 OS"
cls
echo  ============================================================
echo            ABUZ8 OS  -  Sovereign Agent  Setup
echo  ============================================================
echo.
echo   Installing to: %DEST%
echo   Deploying the agent + brains (NVIDIA Nemotron, voice, memory).
echo   This is a one-time copy of ~5 GB. Please wait...
echo.
robocopy "%~dp0ABUZ8 OS" "%DEST%\ABUZ8 OS" /E /NFL /NDL /NJH /NJS /NP >nul
robocopy "%~dp0ABUZ8_OS_Data" "%DEST%\ABUZ8_OS_Data" /E /NFL /NDL /NJH /NJS /NP >nul
> "%DEST%\Launch-ABUZ8.bat" echo @echo off
>> "%DEST%\Launch-ABUZ8.bat" echo set "HERE=%%~dp0"
>> "%DEST%\Launch-ABUZ8.bat" echo set "ABUZ8_DATA_DIR=%%HERE%%ABUZ8_OS_Data"
>> "%DEST%\Launch-ABUZ8.bat" echo start "" "%%HERE%%ABUZ8 OS\ABUZ8 OS.exe"
powershell -NoProfile -Command "$w=New-Object -ComObject WScript.Shell; foreach($p in @([Environment]::GetFolderPath('Desktop'), ([Environment]::GetFolderPath('StartMenu')+'\Programs'))){ $s=$w.CreateShortcut($p+'\ABUZ8 OS.lnk'); $s.TargetPath='%DEST%\Launch-ABUZ8.bat'; $s.WorkingDirectory='%DEST%'; $s.IconLocation='%DEST%\ABUZ8 OS\ABUZ8 OS.exe,0'; $s.Save() }" 2>nul
echo.
echo   Installed. A shortcut "ABUZ8 OS" is on your Desktop and Start Menu.
echo   Launching now...
start "" "%DEST%\Launch-ABUZ8.bat"
timeout /t 2 >nul
'@
Set-Content -Path "$stage\install.bat" -Value $installer -Encoding ASCII

Write-Host "Archiving (store mode; models are already compressed)..."
if (Test-Path $arc) { Remove-Item -Force $arc }
& $z7a a -mx0 "$arc" "$stage\*" | Out-Null

# SFX config: run install.bat after extraction.
$cfg = "C:\tmp\sfxcfg.txt"
$config = ";!@Install@!UTF-8!`r`nTitle=`"ABUZ8 OS Setup`"`r`nRunProgram=`"install.bat`"`r`n;!@InstallEnd@!`r`n"
[System.IO.File]::WriteAllText($cfg, $config, [System.Text.Encoding]::UTF8)

Write-Host "Concatenating SFX -> $out"
if (Test-Path $out) { Remove-Item -Force $out }
cmd /c copy /b "`"$sfx`"" + "`"$cfg`"" + "`"$arc`"" "`"$out`"" | Out-Null

$mb = (Get-Item $out).Length / 1MB
Write-Host ("DONE: {0} ({1:N0} MB)" -f $out, $mb) -ForegroundColor Green
