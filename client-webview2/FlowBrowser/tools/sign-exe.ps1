param(
    [Parameter(Mandatory = $true)]
    [string]$TargetDir
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$certDir = Join-Path $scriptDir "certs"
$pfxPath = Join-Path $certDir "FlowBrowserCodeSign.pfx"
$cerPath = Join-Path $certDir "FlowBrowserCodeSign.cer"
$pwd = ConvertTo-SecureString -String "FlowCreatorAi_CodeSign_2026!#v11" -Force -AsPlainText

if (!(Test-Path $pfxPath)) {
    New-Item -ItemType Directory -Force -Path $certDir | Out-Null
    $newCert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject "CN=Flow Creator Ai Official Publisher, O=Flow Creator Ai, C=US" `
        -KeyAlgorithm RSA `
        -KeyLength 2048 `
        -HashAlgorithm "SHA256" `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -NotAfter (Get-Date).AddYears(10)
    Export-PfxCertificate -Cert $newCert -FilePath $pfxPath -Password $pwd | Out-Null
    Export-Certificate -Cert $newCert -FilePath $cerPath | Out-Null
}

$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(
    $pfxPath,
    $pwd,
    [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable
)

$filesToSign = @(
    (Join-Path $TargetDir "Flow Browser.dll"),
    (Join-Path $TargetDir "Flow Browser.exe")
)

foreach ($file in $filesToSign) {
    if (Test-Path $file) {
        $sigResult = Set-AuthenticodeSignature -FilePath $file -Certificate $cert -HashAlgorithm SHA256 -IncludeChain All
        if ($sigResult.Status -ne "Valid" -and $sigResult.Status -ne "UnknownError") {
            Write-Host "[Authenticode] Signed $(Split-Path $file -Leaf) (SHA-256, Thumbprint: $($cert.Thumbprint), Status: $($sigResult.Status))"
        } else {
            Write-Host "[Authenticode] Signed $(Split-Path $file -Leaf) -> Status: $($sigResult.Status) (SHA-256, Thumbprint: $($cert.Thumbprint))"
        }
    }
}

