# Build a true single-file self-extracting Abuz8Fable.exe from win-unpacked.
# 7-Zip SFX streams the payload (no 32-bit makensis 2GB mmap limit).
$ErrorActionPreference = 'Stop'
$sevenZ = "C:\Program Files\7-Zip\7z.exe"
$sfxMod = "C:\Program Files\7-Zip\7z.sfx"
$wu   = "E:\ABU\ABUZ8_OS_DIST\electron\out\win-unpacked"
$out  = "E:\ABU\ABUZ8_OS_DIST\electron\out"
$arc  = "$out\abz_app.7z"
$cfg  = "$out\abz_sfx_config.txt"
$exe  = "$out\Abuz8Fable.exe"

"start: $(Get-Date -Format 'HH:mm:ss')"
foreach ($p in @($arc, $exe)) { if (Test-Path $p) { Remove-Item $p -Force } }

# 1) Archive the CONTENTS of win-unpacked at root (so 'ABUZ8 OS.exe' sits at the
#    extraction root). -mx=1: payload is mostly incompressible binaries → favor speed.
& $sevenZ a -t7z -mx=1 -ms=off -bsp1 $arc "$wu\*" | Select-Object -Last 4
if ($LASTEXITCODE -ne 0) { throw "7z archive failed ($LASTEXITCODE)" }
"archive: $([math]::Round((Get-Item $arc).Length/1GB,2)) GB"

# 2) SFX config — extract to temp, then run the app from there (%%T = temp dir).
$config = @"
;!@Install@!UTF-8!
Title="ABUZ8 OS"
RunProgram="\"%%T\\ABUZ8 OS.exe\""
;!@InstallEnd@!
"@
[System.IO.File]::WriteAllText($cfg, $config, (New-Object System.Text.UTF8Encoding($false)))

# 3) Concatenate: SFX module + config + archive  =>  single self-extracting exe
$fsOut = [System.IO.File]::Create($exe)
foreach ($part in @($sfxMod, $cfg, $arc)) {
  $bytes = [System.IO.File]::ReadAllBytes($part)
  $fsOut.Write($bytes, 0, $bytes.Length)
}
$fsOut.Close()

# 4) Verify: the SFX exe is a valid 7z container 7-Zip can list back.
"single-file: $([math]::Round((Get-Item $exe).Length/1GB,2)) GB -> $exe"
$listed = (& $sevenZ l $exe 2>&1 | Select-String 'ABUZ8 OS.exe').Count
"contains 'ABUZ8 OS.exe' entry: $($listed -gt 0)"
Remove-Item $arc, $cfg -Force -ErrorAction SilentlyContinue
"done:  $(Get-Date -Format 'HH:mm:ss')"
