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
7. Aligned the production Docker builder with the supported Node 22 runtime. Vitest 5 is loaded by `vite.config.ts` during a production build, so retaining the previous Node 20 builder would leave the container path outside the package's declared engine support.

No `--force`, advisory suppression, audit allowlist, or lockfile-only override was used.

## Regression evidence

- `npx vitest run --maxWorkers=2`: 7 files and 59 tests passed under Vitest 5.0.1.
- `npm run build`: TypeScript, Tailwind, Vite and PWA production build passed.
- `docker build --tag pulseboard-frontend:ci .`: the complete Node 22 builder and nginx runtime image path passed.
- `npm audit --audit-level=low`: zero vulnerabilities across production and development dependencies.
- `npm ci` reproduced the repaired graph before every test and build pass.

## Ongoing gate

`.github/workflows/workbench-frontend.yml` now requires all of the following after a clean install:

```sh
npx vitest run --maxWorkers=2
npm run build
docker build --tag pulseboard-frontend:ci .
npm audit --audit-level=low
```

A future test regression, unsupported container toolchain, broken production image, or vulnerable direct/transitive package therefore fails the frontend workflow instead of being reported as an informational warning.

## Separate performance observation

The production build still warns that its main JavaScript chunk is above Vite's 500 kB warning threshold. That is a bundle-shaping and loading-performance concern, not a dependency-audit exception, and is tracked separately in issue #60.
