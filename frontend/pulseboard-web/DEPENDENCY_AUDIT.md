# Frontend dependency audit

Evidence captured on 17 September 2026 for the workbench frontend under Node 22 and npm 10.

## Baseline

The restored frontend gate initially installed 610 packages and reported 31 advisories across the complete development graph. A production-only audit narrowed the deployable exposure to three vulnerable packages:

- `echarts` below 6.1.0: moderate XSS advisory
- `nanoid` through 3.3.17: high-severity generator advisories
- `postcss` through 8.5.22: high-severity source-map and CSS serialization advisories

The remaining findings were development-tool dependencies rather than browser runtime dependencies.

## Remediation

1. Ran the normal, non-forced `npm audit fix` path and committed the resulting dependency lock changes.
2. Reinstalled strictly from the repaired lock with `npm ci`.
3. Verified the production-only graph with `npm audit --omit=dev --audit-level=low`: zero vulnerabilities.
4. The remaining findings were isolated to Vitest 4 tooling: `vitest`, `@vitest/ui`, and transitive `@vitest/mocker`.
5. Updated `vitest` and `@vitest/ui` together to 5.0.1, then reinstalled from the lock.
6. Verified the complete dependency graph with `npm audit --audit-level=low`: zero vulnerabilities.

No `--force`, advisory suppression, audit allowlist, or lockfile-only override was used.

## Regression evidence

- `npx vitest run --maxWorkers=2`: 7 files and 59 tests passed under Vitest 5.0.1.
- `npm run build`: TypeScript, Tailwind, Vite and PWA production build passed.
- `npm audit --audit-level=low`: zero vulnerabilities across production and development dependencies.
- `npm ci` reproduced the repaired graph before every test and build pass.

## Ongoing gate

`.github/workflows/workbench-frontend.yml` now treats the complete npm audit as a required step after tests and the production build:

```sh
npm audit --audit-level=low
```

A future vulnerable direct or transitive package therefore fails the frontend workflow instead of being reported as an informational warning.

## Separate performance observation

The production build still warns that its main JavaScript chunk is above Vite's 500 kB warning threshold. That is a bundle-shaping and loading-performance concern, not a dependency-audit exception, and should be handled as a separate measured optimization slice.
