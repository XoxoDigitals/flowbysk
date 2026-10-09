# Copy dist-portable-v5 www into the WebView2 project www folder (does not touch dist-portable v4).
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$src = Join-Path $root 'dist-portable-v5\www'
$dst = Join-Path $root 'client-webview2\FlowBrowser\www'
if (-not (Test-Path $src)) { throw "Missing $src — build dist-portable-v5 first." }
Write-Host "Sync $src -> $dst"
if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
Copy-Item $src $dst -Recurse -Force
Write-Host "Done. Build FlowBrowser with FLOW_V5_EPHEMERAL=1 for RAM-friendly profiles."
