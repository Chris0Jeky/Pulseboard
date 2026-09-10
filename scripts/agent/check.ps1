param(
    [string]$HarnessRoot = (Join-Path $PSScriptRoot '../../../agent-harness'),
    # Review-range base for the third whitespace check. It must already be
    # fetched in this checkout; on a branch whose origin/main is missing the
    # range check fails rather than silently passing.
    [string]$Base = 'origin/main'
)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$harness = Join-Path ([IO.Path]::GetFullPath($HarnessRoot)) 'harness.py'
if (-not (Test-Path -LiteralPath $harness)) { throw 'Pass -HarnessRoot with the canonical agent-harness checkout' }
Push-Location $repoRoot
try {
    git diff --check
    if ($LASTEXITCODE -ne 0) { throw 'Whitespace check failed: working tree (git diff --check)' }
    git diff --check --cached
    if ($LASTEXITCODE -ne 0) { throw 'Whitespace check failed: staged changes (git diff --check --cached)' }
    git diff --check "$Base...HEAD"
    if ($LASTEXITCODE -ne 0) { throw "Whitespace check failed: review range (git diff --check $Base...HEAD)" }
    python $harness audit $repoRoot
    if ($LASTEXITCODE -ne 0) { throw 'Harness audit failed' }
    Push-Location 'observatory'
    try {
        npm.cmd test
        if ($LASTEXITCODE -ne 0) { throw 'Desk tests failed' }
    } finally { Pop-Location }
} finally { Pop-Location }
