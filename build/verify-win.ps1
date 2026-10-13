# Asserts every Windows exe in a release build is Authenticode-signed by Spinarr's
# publisher and timestamped: pwsh build/verify-win.ps1 [-Dist dist]
# Run only on tag builds with signing credentials. electron-builder logs and continues
# when one file fails to sign (RESEARCH Pitfall 5), so this is the real gate.
# No hard-coded binary list: every exe under win-unpacked plus the installer is checked.
param(
  [string]$Dist = 'dist',
  [string]$Subject = 'CN=Rick Ramirez'
)
$ErrorActionPreference = 'Stop'

$unpacked = Join-Path $Dist 'win-unpacked'
if (-not (Test-Path -LiteralPath $unpacked -PathType Container)) { throw "no unpacked app at $unpacked" }

$inner = @(Get-ChildItem -LiteralPath $unpacked -Recurse -File -Filter *.exe)
$installers = @(Get-ChildItem -LiteralPath $Dist -File -Filter *.exe)
$engineDir = Join-Path (Join-Path $unpacked 'resources') 'engine'
$engine = @()
if (Test-Path -LiteralPath $engineDir -PathType Container) {
  $engine = @(Get-ChildItem -LiteralPath $engineDir -Recurse -File -Filter *.exe)
}
if ($engine.Count -lt 1) { throw "no engine exe under $engineDir" }
if ($installers.Count -lt 1) { throw "no installer exe in $Dist" }

$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
  Sort-Object { [version]$_.Directory.Parent.Name } -ErrorAction SilentlyContinue |
  Select-Object -Last 1
if (-not $signtool) { throw 'signtool.exe not found under Windows Kits\10\bin' }

$files = @($inner) + @($installers)
$failures = New-Object System.Collections.Generic.List[string]
foreach ($f in $files) {
  $p = $f.FullName
  $sig = Get-AuthenticodeSignature -LiteralPath $p
  if ($sig.Status -ne 'Valid') { $failures.Add("${p}: signature is $($sig.Status), not Valid"); continue }
  if (-not $sig.SignerCertificate -or $sig.SignerCertificate.Subject -notmatch [regex]::Escape($Subject)) {
    $failures.Add("${p}: signed by '$($sig.SignerCertificate.Subject)', not $Subject")
  }
  if ($null -eq $sig.TimeStamperCertificate) { $failures.Add("${p}: no timestamp") }
  & $signtool.FullName verify /pa /all /v $p | Out-Null
  if ($LASTEXITCODE -ne 0) { $failures.Add("${p}: signtool verify /pa /all failed (exit $LASTEXITCODE)") }
}
if ($failures.Count) {
  throw ("Windows signature check failed for $($failures.Count) item(s):`n  " + ($failures -join "`n  "))
}
"verify-win: OK ($($files.Count) files)"
