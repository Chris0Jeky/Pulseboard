param([string]$HarnessRoot = (Join-Path $PSScriptRoot '../../../agent-harness'))
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$harness = Join-Path ([IO.Path]::GetFullPath($HarnessRoot)) 'harness.py'
if (-not (Test-Path -LiteralPath $harness)) { throw 'Pass -HarnessRoot with the canonical agent-harness checkout' }
Push-Location $repoRoot
try {
    git diff --check
    if ($LASTEXITCODE -ne 0) { throw 'Whitespace check failed' }
    python $harness audit $repoRoot
    if ($LASTEXITCODE -ne 0) { throw 'Harness audit failed' }
    Push-Location 'observatory'
    try {
        npm.cmd test
        if ($LASTEXITCODE -ne 0) { throw 'Desk tests failed' }
    } finally { Pop-Location }
} finally { Pop-Location }
