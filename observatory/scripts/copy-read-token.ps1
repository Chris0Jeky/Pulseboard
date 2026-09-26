<#
.SYNOPSIS
Copies the saved Desk read token to the clipboard, then clears the clipboard.

.DESCRIPTION
Reads %LOCALAPPDATA%\Pulseboard\read-token.dpapi (written by rotate-read-token.ps1 for this
Windows user), puts the token on the clipboard without printing it, and clears the clipboard
after you press Enter or after -ClearAfter seconds, whichever comes first.

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File observatory\scripts\copy-read-token.ps1
#>
[CmdletBinding()]
param([int]$ClearAfter = 120)
$ErrorActionPreference = 'Stop'
$file = Join-Path $env:LOCALAPPDATA 'Pulseboard\read-token.dpapi'
if (-not (Test-Path $file)) { throw "No saved token at $file. Run rotate-read-token.ps1 first." }
$saved = Get-Content $file | ConvertTo-SecureString
Set-Clipboard -Value ([PSCredential]::new('operator', $saved)).GetNetworkCredential().Password
try {
  Write-Host "Token copied. Paste it into the Desk's Connect data. The clipboard clears in $ClearAfter s or when you press Enter."
  $deadline = (Get-Date).AddSeconds($ClearAfter)
  while ((Get-Date) -lt $deadline) {
    $pressed = $false
    try { $pressed = [Console]::KeyAvailable -and [Console]::ReadKey($true).Key -eq 'Enter' } catch { }  # no console: wait out the timer
    if ($pressed) { break }
    Start-Sleep -Milliseconds 250
  }
} finally {
  Set-Clipboard -Value ' '
  Write-Host 'Clipboard cleared. Windows clipboard history (Win+V), if on, may still hold it: delete it there too.'
}
