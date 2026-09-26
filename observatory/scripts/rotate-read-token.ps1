<#
.SYNOPSIS
Rotates the hosted Desk read token and saves an encrypted copy for the current Windows user.

.DESCRIPTION
Generates a random 43-character token, installs it as the Worker secret READ_TOKEN through
Wrangler (read from stdin, never on the command line), saves it with Windows DPAPI at
%LOCALAPPDATA%\Pulseboard\read-token.dpapi, and proves the hosted Worker accepts it and still
refuses an unauthenticated read. The token is never printed.

Rotating logs out every other copy: other machines and any browser tab holding the old token.
Run copy-read-token.ps1 afterwards to paste the new token into the Desk's Connect data.

Needs: Node and an authorised Wrangler login (npx wrangler whoami). Works in Windows PowerShell 5.1.

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File observatory\scripts\rotate-read-token.ps1
#>
[CmdletBinding()]
param(
  [string]$Origin = 'https://pulseboard-observatory.commit-atlas.workers.dev',
  [int]$WaitSeconds = 60
)
$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {

$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

$dir = Join-Path $env:LOCALAPPDATA 'Pulseboard'
$file = Join-Path $dir 'read-token.dpapi'
$pending = "$file.pending"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
# Written to a pending file first: read-token.dpapi keeps the live token until Wrangler accepts the new one,
# and the pending file keeps the new one if Wrangler succeeds but a later step fails.
ConvertTo-SecureString $token -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -Path $pending -Encoding ascii

$ErrorActionPreference = 'Continue'  # Wrangler writes warnings to stderr; judge it by its exit code alone.
$token | npx.cmd wrangler secret put READ_TOKEN --env=""
$exit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($exit -ne 0) {
  Remove-Item $pending -Force
  throw "wrangler secret put failed (exit $exit); the hosted token and $file are unchanged."
}
if (Test-Path $file) { Move-Item $file "$file.previous" -Force }
Move-Item $pending $file -Force
Write-Host "Saved the new token (DPAPI, this Windows user only) to $file; the replaced copy is $file.previous"

function Get-Status([hashtable]$Headers) {
  try { return (Invoke-WebRequest -Uri "$Origin/v1/portfolio" -Headers $Headers -UseBasicParsing -TimeoutSec 15).StatusCode }
  catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode } return 0 }
}

$deadline = (Get-Date).AddSeconds($WaitSeconds)
do {
  $status = Get-Status @{ Authorization = "Bearer $token" }
  if ($status -eq 200) { break }
  Start-Sleep -Seconds 5
} while ((Get-Date) -lt $deadline)
$anonymous = Get-Status @{}

if ($status -ne 200) { throw "The hosted Worker returned $status for the new token after $WaitSeconds s. Re-run this script." }
if ($anonymous -ne 401) { throw "An unauthenticated read returned $anonymous, expected 401. Investigate before using the Desk." }
Write-Host "Verified: authenticated read 200, unauthenticated read 401. Old copies no longer work."
Write-Host 'Next: run scripts\copy-read-token.ps1 and paste into the Desk (Connect data).'
} finally { Pop-Location }
