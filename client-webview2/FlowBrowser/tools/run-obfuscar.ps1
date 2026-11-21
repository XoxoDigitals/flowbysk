param(
    [Parameter(Mandatory=$true)][string]$TargetDir,
    [Parameter(Mandatory=$true)][string]$IntermediateDir,
    [Parameter(Mandatory=$true)][string]$ProjectDir
)

$ErrorActionPreference = "Stop"

$dllPath = Join-Path $TargetDir "Flow Browser.dll"
if (-not (Test-Path $dllPath)) {
    Write-Host "[Obfuscar] Flow Browser.dll not found at $dllPath"
    exit 0
}

$obfOut = Join-Path $TargetDir "obf-out"
if (Test-Path $obfOut) {
    Remove-Item -Recurse -Force $obfOut
}

$searchPathsXml = ""
$desktopDirs = Get-ChildItem "C:\Program Files\dotnet\shared\Microsoft.WindowsDesktop.App\8.*" -ErrorAction SilentlyContinue | Sort-Object Name -Descending
if ($desktopDirs) {
    $searchPathsXml += "`r`n  <AssemblySearchPath path=`"$($desktopDirs[0].FullName)`" />"
}
$netCoreDirs = Get-ChildItem "C:\Program Files\dotnet\shared\Microsoft.NETCore.App\8.*" -ErrorAction SilentlyContinue | Sort-Object Name -Descending
if ($netCoreDirs) {
    $searchPathsXml += "`r`n  <AssemblySearchPath path=`"$($netCoreDirs[0].FullName)`" />"
}

$xmlTemplate = Get-Content (Join-Path $ProjectDir "obfuscar.xml") -Raw
$xmlContent = $xmlTemplate.Replace('<Var name="InPath" value="." />', "<Var name=`"InPath`" value=`"$TargetDir`" />").Replace('<Var name="OutPath" value=".\obf-out" />', "<Var name=`"OutPath`" value=`"$obfOut`" />$searchPathsXml")
$tempXml = Join-Path $TargetDir "obfuscar.active.xml"
Set-Content -Path $tempXml -Value $xmlContent -Encoding UTF8

$obfExe = Join-Path $env:USERPROFILE ".dotnet\tools\obfuscar.console.exe"
if (-not (Test-Path $obfExe)) {
    $obfExe = "obfuscar.console"
}

Write-Host "[Obfuscar] Obfuscating $dllPath ..."
& $obfExe $tempXml
if ($LASTEXITCODE -ne 0) {
    throw "Obfuscar failed with exit code $LASTEXITCODE"
}

$obfDll = Join-Path $obfOut "Flow Browser.dll"
if (Test-Path $obfDll) {
    Copy-Item $obfDll $dllPath -Force
    $objDll = Join-Path $IntermediateDir "Flow Browser.dll"
    if (Test-Path $objDll) {
        Copy-Item $obfDll $objDll -Force
    }
    $refDll = Join-Path $IntermediateDir "ref\Flow Browser.dll"
    if (Test-Path $refDll) {
        Copy-Item $obfDll $refDll -Force
    }
    Write-Host "[Obfuscar] Successfully obfuscated Flow Browser.dll (copied to bin and obj)"
}

Remove-Item -Recurse -Force $obfOut -ErrorAction SilentlyContinue
Remove-Item -Force $tempXml -ErrorAction SilentlyContinue

