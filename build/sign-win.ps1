# Signs one file with Azure Artifact Signing. Called by build/sign-win.js only:
#   pwsh -NoProfile -NonInteractive -File build/sign-win.ps1 -ModuleVersion <v> -File <path>
# The ArtifactSigning module is installed at a pinned version by .github/workflows/release.yml.
# This script never installs anything; it imports that exact version or fails.
# Azure credentials come from the azure/login step (DefaultAzureCredential chain).
param(
  [Parameter(Mandatory)][string]$ModuleVersion,
  [Parameter(Mandatory)][string]$File
)
$ErrorActionPreference = 'Stop'

foreach ($name in 'AZURE_SIGNING_ENDPOINT', 'AZURE_SIGNING_ACCOUNT', 'AZURE_CERT_PROFILE') {
  if (-not [Environment]::GetEnvironmentVariable($name)) { throw "$name is not set; cannot sign $File" }
}
if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { throw "nothing to sign at $File" }

Import-Module ArtifactSigning -RequiredVersion $ModuleVersion -ErrorAction Stop
$loaded = @(Get-Module ArtifactSigning)
if ($loaded.Count -ne 1 -or $loaded[0].Version -ne [version]$ModuleVersion) {
  throw "ArtifactSigning $ModuleVersion is not the loaded module"
}

Invoke-ArtifactSigning `
  -Endpoint $env:AZURE_SIGNING_ENDPOINT `
  -CodeSigningAccountName $env:AZURE_SIGNING_ACCOUNT `
  -CertificateProfileName $env:AZURE_CERT_PROFILE `
  -Files $File `
  -FileDigest SHA256 `
  -TimestampRfc3161 'http://timestamp.acs.microsoft.com' `
  -TimestampDigest SHA256

$sig = Get-AuthenticodeSignature -LiteralPath $File
if ($sig.Status -ne 'Valid') { throw "signature on $File is $($sig.Status), not Valid" }
