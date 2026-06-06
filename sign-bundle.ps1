# ABUZ8 OS · Code Signing Script
# Signs the .exe artifacts with your OV/EV code-signing certificate.
# Removes SmartScreen friction for downloaders.
#
# Usage:
#   .\sign-bundle.ps1 -CertPath "C:\path\to\abuz8.pfx" -CertPassword (Read-Host -AsSecureString "PFX password")
#
# Optional:
#   -TimestampUrl  — RFC 3161 timestamp server (default: Sectigo's free one)
#   -Algorithm     — SHA256 (default) or SHA384
#   -ArtifactDir   — folder containing the .exe files
#
# Bismillah.

[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)] [string] $CertPath,
  [Parameter(Mandatory=$true)] [System.Security.SecureString] $CertPassword,
  [string] $TimestampUrl = 'http://timestamp.sectigo.com',
  [ValidateSet('SHA256','SHA384')] [string] $Algorithm = 'SHA256',
  [string] $ArtifactDir = (Join-Path $PSScriptRoot 'electron\out')
)

$ErrorActionPreference = 'Stop'

function Step($msg) { Write-Host ""; Write-Host "  > $msg" -ForegroundColor Cyan }
function OK($msg)   { Write-Host "    [OK]   " -NoNewline -ForegroundColor Green; Write-Host $msg -ForegroundColor Gray }
function Fail($msg) { Write-Host "    [FAIL] " -NoNewline -ForegroundColor Red;   Write-Host $msg -ForegroundColor Gray }
function Warn2($m)  { Write-Host "    [WARN] " -NoNewline -ForegroundColor Yellow; Write-Host $m -ForegroundColor Gray }

Write-Host ""
Write-Host "  +---------------------------------------------+" -ForegroundColor DarkYellow
Write-Host "  |  ABUZ8 OS Code Signing                      |" -ForegroundColor Yellow
Write-Host "  +---------------------------------------------+" -ForegroundColor DarkYellow

# ── 1. Validate cert file ──────────────────────────────────────────────
Step "1. Loading certificate"
if (-not (Test-Path $CertPath)) { Fail "Cert not found: $CertPath"; exit 1 }
try {
  $cert = Get-PfxCertificate -FilePath $CertPath -Password $CertPassword
  OK "Subject: $($cert.Subject)"
  OK "Issuer:  $($cert.Issuer)"
  OK "Valid:   $($cert.NotBefore.ToString('yyyy-MM-dd')) -> $($cert.NotAfter.ToString('yyyy-MM-dd'))"
  $daysLeft = [int]($cert.NotAfter - (Get-Date)).TotalDays
  if ($daysLeft -lt 30) { Warn2 "Only $daysLeft days until expiry" } else { OK "$daysLeft days until expiry" }
  # EV vs OV detection (rough heuristic — EV certs have BusinessCategory in subject)
  $isEV = $cert.Subject -match 'businessCategory|jurisdictionC'
  if ($isEV) { OK "Cert appears to be EV (instant SmartScreen reputation)" } else { OK "Cert is OV (SmartScreen reputation builds over downloads)" }
} catch {
  Fail "Could not load cert: $($_.Exception.Message)"; exit 1
}

# ── 2. Find artifacts ──────────────────────────────────────────────────
Step "2. Locating artifacts"
$targets = @(
  "ABUZ8 OS Setup 1.0.0.exe",
  "ABUZ8_OS-1.0.0-portable.exe"
)
$found = @()
foreach ($t in $targets) {
  $p = Join-Path $ArtifactDir $t
  if (Test-Path $p) {
    $found += $p
    OK $t
  } else {
    Warn2 "Missing: $t"
  }
}
if ($found.Count -eq 0) { Fail "No artifacts found in $ArtifactDir"; exit 1 }

# ── 3. Sign each (Set-AuthenticodeSignature, no signtool needed) ────────
Step "3. Signing"
foreach ($file in $found) {
  Write-Host "    signing  $(Split-Path $file -Leaf)" -ForegroundColor DarkGray
  try {
    $sig = Set-AuthenticodeSignature `
      -FilePath $file `
      -Certificate $cert `
      -HashAlgorithm $Algorithm `
      -TimestampServer $TimestampUrl `
      -IncludeChain All `
      -Force
    if ($sig.Status -eq 'Valid') {
      OK "$(Split-Path $file -Leaf)  ->  Valid ($Algorithm, timestamped)"
    } else {
      Warn2 "$(Split-Path $file -Leaf) status: $($sig.Status) · $($sig.StatusMessage)"
    }
  } catch {
    Fail "$(Split-Path $file -Leaf): $($_.Exception.Message)"
  }
}

# ── 4. Verify signatures ───────────────────────────────────────────────
Step "4. Verification"
$allOk = $true
foreach ($file in $found) {
  $sig = Get-AuthenticodeSignature $file
  $tsCheck = if ($sig.TimeStamperCertificate) { '+ timestamp' } else { 'no timestamp!' }
  if ($sig.Status -eq 'Valid') {
    OK "$(Split-Path $file -Leaf)  $($sig.Status)  $tsCheck"
  } else {
    Fail "$(Split-Path $file -Leaf)  $($sig.Status)  $($sig.StatusMessage)"
    $allOk = $false
  }
}

# ── 5. Recompute hashes ────────────────────────────────────────────────
Step "5. New SHA-256 (signed binaries have new hashes — publish these)"
foreach ($file in $found) {
  $sha = (Get-FileHash $file -Algorithm SHA256).Hash
  Write-Host "    $(Split-Path $file -Leaf)" -ForegroundColor DarkGray
  Write-Host "    sha256: $sha" -ForegroundColor Yellow
}

Write-Host ""
if ($allOk) {
  Write-Host "  +---------------------------------------------+" -ForegroundColor Green
  Write-Host "  |  Signing complete                           |" -ForegroundColor Green
  Write-Host "  +---------------------------------------------+" -ForegroundColor Green
  Write-Host ""
  Write-Host "    Both .exe files are now signed and timestamped." -ForegroundColor Gray
  Write-Host "    Distribute the new hashes alongside the binaries." -ForegroundColor Gray
  if (-not $isEV) {
    Write-Host "    (OV cert: SmartScreen reputation builds with each install.)" -ForegroundColor DarkGray
  }
} else {
  Write-Host "  +---------------------------------------------+" -ForegroundColor Red
  Write-Host "  |  Signing failed for one or more artifacts   |" -ForegroundColor Red
  Write-Host "  +---------------------------------------------+" -ForegroundColor Red
}
Write-Host ""
