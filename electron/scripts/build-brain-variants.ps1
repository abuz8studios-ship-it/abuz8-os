param(
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$BrainDir = Join-Path $Root "brain"
$OutDir = Join-Path $Root "out"
$VariantDir = Join-Path $OutDir "variants"
$ShelfDir = Join-Path $Root ".brain-shelf"

$variants = @(
  @{
    Name = "lite"
    Model = "LFM2.5-350M-Q4_K_M.gguf"
    Description = "smallest offline brain for weak laptops and USB demos"
  },
  @{
    Name = "standard"
    Model = "LFM2-1.2B-Tool-Q4_K_M.gguf"
    Description = "balanced offline tool brain for everyday agent work"
  },
  @{
    Name = "pro"
    Model = "LFM2-2.6B-Exp-Q4_K_M.gguf"
    Description = "strongest bundled offline reasoning brain"
  }
)

New-Item -ItemType Directory -Force -Path $VariantDir | Out-Null
New-Item -ItemType Directory -Force -Path $ShelfDir | Out-Null

Get-ChildItem -LiteralPath $BrainDir -File -Filter "*.gguf" | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $ShelfDir $_.Name) -Force
}

$runtimeFiles = Get-ChildItem -LiteralPath $BrainDir -File | Where-Object { $_.Extension -ne ".gguf" }
if (-not $runtimeFiles) {
  throw "No llama.cpp runtime files found in $BrainDir"
}

foreach ($variant in $variants) {
  $modelPath = Join-Path $ShelfDir $variant.Model
  if (-not (Test-Path -LiteralPath $modelPath)) {
    throw "Missing model for $($variant.Name): $modelPath"
  }

  Get-ChildItem -LiteralPath $BrainDir -File -Filter "*.gguf" | Remove-Item -Force
  Copy-Item -LiteralPath $modelPath -Destination (Join-Path $BrainDir $variant.Model) -Force

  Write-Host "Building ABUZ8 OS $($variant.Name) with $($variant.Model) - $($variant.Description)"
  if ($SkipInstall) {
    npm run build
  } else {
    npm run build
  }

  $portable = Join-Path $OutDir "ABUZ8_OS-1.0.0-portable.exe"
  $setup = Join-Path $OutDir "ABUZ8 OS Setup 1.0.0.exe"
  if (Test-Path -LiteralPath $portable) {
    Copy-Item -LiteralPath $portable -Destination (Join-Path $VariantDir "ABUZ8_OS-1.0.0-$($variant.Name)-portable.exe") -Force
  }
  if (Test-Path -LiteralPath $setup) {
    Copy-Item -LiteralPath $setup -Destination (Join-Path $VariantDir "ABUZ8_OS-1.0.0-$($variant.Name)-setup.exe") -Force
  }
}

Get-ChildItem -LiteralPath $BrainDir -File -Filter "*.gguf" | Remove-Item -Force
Get-ChildItem -LiteralPath $ShelfDir -File -Filter "*.gguf" | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $BrainDir $_.Name) -Force
}

$hashes = Get-ChildItem -LiteralPath $VariantDir -File | Where-Object { $_.Name -ne "SHA256SUMS.json" } | ForEach-Object {
  $stream = [System.IO.File]::OpenRead($_.FullName)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace("-", "")
    [pscustomobject]@{ Hash = $hash; Path = $_.FullName }
  } finally {
    $stream.Dispose()
  }
}

$hashes |
  ConvertTo-Json -Depth 3 |
  Set-Content -LiteralPath (Join-Path $VariantDir "SHA256SUMS.json") -Encoding UTF8

Write-Host "Variants written to $VariantDir"
