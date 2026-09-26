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
Set-Location (Join-Path $PSScriptRoot '..')

$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

$dir = Join-Path $env:LOCALAPPDATA 'Pulseboard'
$file = Join-Path $dir 'read-token.dpapi'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
if (Test-Path $file) { Copy-Item $file "$file.previous" -Force }
# Saved before the secret changes, so a failure below never leaves the new token unrecorded.
ConvertTo-SecureString $token -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -Path $file -Encoding ascii
Write-Host "Saved the new token (DPAPI, this Windows user only) to $file"

$token | npx wrangler secret put READ_TOKEN --env=""
if ($LASTEXITCODE -ne 0) {
  throw "wrangler secret put failed; the hosted token is unchanged. The previous local copy is at $file.previous."
}

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
