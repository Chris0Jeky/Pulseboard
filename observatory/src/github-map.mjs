/** Reviewed GitHub mapping, pulseboard.github-map/1. Numeric repository and workflow ids only: names are checked, never matched.
 *  Adding or widening a project is an owner decision (HUMAN_TODO.md q-9), not cleanup. Alibi was mapped first on 2026-09-22.
 *  Ids verified that day through the GitHub API: repository 1360756863 (Chris0Jeky/Alibi, default branch main) and workflow
 *  352677495 (.github/workflows/check.yml, "Verify puzzle cabinet", runs on every push to main). Alibi publishes through
 *  Cloudflare outside GitHub deployments and none of its workflows declares an environment, so none is mapped. */
export const githubMap = { schema: 'pulseboard.github-map/1', revision: 2, reviewedAt: '2026-09-22', projects: {
  alibi: [{ repositoryId: 1360756863, repository: 'Chris0Jeky/Alibi',
    workflows: [{ workflowId: 352677495, path: '.github/workflows/check.yml', branch: 'main', role: 'ci' }],
    environments: [], releases: { max: 5 } }],
} };
