$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Push-Location $repoRoot
try {
    git status --short --branch
    if ($LASTEXITCODE -ne 0) { throw 'Git status failed' }
    git log -3 --oneline
    Get-Content -LiteralPath '.agent-harness/tier.json'
    Get-Content -LiteralPath 'CLAUDE.md'
    Get-Content -LiteralPath 'HUMAN_TODO.md'
} finally { Pop-Location }
