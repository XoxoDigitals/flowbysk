$ErrorActionPreference = 'Stop'
$tools = $PSScriptRoot
$projRoot = Split-Path -Parent $tools
Set-Location $tools

if (-not (Test-Path (Join-Path $tools 'node_modules\javascript-obfuscator'))) {
  Write-Host '[pack-www] npm install...'
  npm install --omit=dev --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
}

Write-Host '[pack-www] obfuscating critical JS...'
node (Join-Path $tools 'obfuscate-www.cjs')
if ($LASTEXITCODE -ne 0) { throw 'obfuscate failed' }

$packed = Join-Path $projRoot 'www-packed'
$zip = Join-Path $projRoot 'www.zip'
if (-not (Test-Path $packed)) { throw "www-packed missing: $packed" }
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $packed '*') -DestinationPath $zip -Force
Write-Host "[pack-www] wrote $zip ($((Get-Item $zip).Length) bytes)"
