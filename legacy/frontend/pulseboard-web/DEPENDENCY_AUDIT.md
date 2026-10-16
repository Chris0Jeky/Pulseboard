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

## 16 October 2026 - Tailwind CSS v4 migration

The preceding lockfile refresh reduced the full-graph audit from 12 to seven findings. The remaining chain was rooted in Tailwind 3.4.x (braces, micromatch, chokidar, fast-glob, postcss-nested, postcss-selector-parser and tailwindcss); braces had no patched 3.x release.

### Remediation

1. Migrated to Tailwind CSS 4.3.3 and its official `@tailwindcss/postcss` integration, keeping `npm run build:css` and the checked-in generated stylesheet. The latest CLI was evaluated but still imported vulnerable braces through its Parcel watcher; the PostCSS integration removes that chain.
2. Replaced JavaScript configuration with CSS-first theme, explicit source paths and the existing class-based dark variant. Removed the obsolete Tailwind config and autoprefixer-only PostCSS config; v4 handles prefixing.
3. Updated template classes: `backdrop-blur-sm` -> `backdrop-blur-xs`, `rounded` -> `rounded-sm`, `focus:outline-none` -> `focus:outline-hidden`, `flex-shrink-0` -> `shrink-0`, and directional gradients -> `bg-linear-to-*/srgb`. Retained existing shadow-lg/shadow-2xl values and explicit two-pixel colored rings.
4. Preserved the used v3 color palette, default gray-200 borders, gray-400 placeholders, pointer cursors and sibling spacing. Added a compilation regression test for the migrated controls and defaults.

No `--force`, advisory suppression, audit allowlist or dependency override was used.

### Regression evidence

From `legacy/frontend/pulseboard-web` on Windows with Node 22.23.3 and npm 11.8.0 (also passed first on the host Node 24.13.1):

- `npm ci`: 540 packages installed; complete graph audited with zero vulnerabilities.
- `npx vitest run --maxWorkers=2`: 11 files, 70 tests passed.
- `npm run build`: Tailwind, TypeScript, Vite and PWA build passed.
- `npm run build:budget`: passed; entry 117,516 bytes, largest chart chunk 345,034 bytes, chart chunks lazy, offline precache verified.
- `npm audit --audit-level=low`: zero vulnerabilities across production and development dependencies.
- `git diff --check`: passed.

The final Node 22 pass invoked the installed npm/npx CLI JavaScript files with the scratch-installed Node 22 executable and placed that executable first on PATH for child build processes; command arguments matched the workflow.

Parsed CSS rule selectors before/after regeneration contained 251/249 distinct class names. Old names absent from the new CSS: `backdrop-blur-sm`, `bg-gradient-to-br`, `bg-gradient-to-r`, `blur`, `filter`, `flex-shrink-0`, `focus:outline-none`, `rounded`, `visible`. The six template utility names have the replacements listed above. The other three were incidental v3 scan matches from CSS/JavaScript/comments, not template class attributes. No used template utility was left without an equivalent.

Browser visual comparison and Docker image construction were not verified. Docker CLI is installed, but `docker version` could not connect to the local engine pipe. Tailwind v4 requires Safari 16.4+, Chrome 111+ or Firefox 128+; older browsers are outside its supported range. Official migration reference: https://tailwindcss.com/docs/upgrade-guide.
