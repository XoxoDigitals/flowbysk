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
$vault = Join-Path $projRoot 'www.vault'
if (-not (Test-Path $packed)) { throw "www-packed missing: $packed" }
if (Test-Path $zip) { Remove-Item $zip -Force }
if (Test-Path $vault) { Remove-Item $vault -Force }
Compress-Archive -Path (Join-Path $packed '*') -DestinationPath $zip -Force
Write-Host "[pack-www] wrote $zip ($((Get-Item $zip).Length) bytes)"
node (Join-Path $tools 'encrypt-www.cjs')
if ($LASTEXITCODE -ne 0) { throw 'encrypt-www failed' }
if (-not (Test-Path $vault)) { throw "www.vault missing after encrypt" }
Write-Host "[pack-www] wrote $vault ($((Get-Item $vault).Length) bytes)"
