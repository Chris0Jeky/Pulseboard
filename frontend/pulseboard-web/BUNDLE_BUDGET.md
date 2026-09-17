# Workbench frontend bundle budget

Measured on 17 September 2026 with Node 22, npm 10, Vite 7.3.6 and the production PWA build.

## Why this exists

The workbench previously imported every route view eagerly. Opening the dashboard list therefore loaded the live-dashboard view, Vue ECharts, ECharts and ZRender before the visitor selected a dashboard. The production build emitted one 707 kB JavaScript entry chunk and Vite warned that it exceeded 500 kB.

This change uses route-level dynamic imports and deliberately isolates the stable framework and chart runtimes. It does not increase Vite's warning threshold or hide a large entry bundle behind a configuration exception.

## Before and after

| Measurement | Before | After | Change |
|---|---:|---:|---:|
| Initial JavaScript, raw | 707,227 B | 111,445 B | -84.2% |
| Initial JavaScript, gzip | 240,815 B | 43,734 B | -81.8% |
| Largest JavaScript chunk | 707,093 B | 345,026 B | -51.2% |
| Named async route boundaries | 0 | 3 | dashboard list, live dashboard, feeds |

The initial set now consists of the small application entry, the Vue/Router/Pinia runtime and the service-worker registration helper. ECharts and ZRender load only with the live-dashboard route.

## Resulting major chunks

| Chunk | Raw | Gzip | Loading boundary |
|---|---:|---:|---|
| `vue-vendor` | 104,955 B | 40,894 B | initial framework runtime |
| application entry | 6,356 B | 2,715 B | initial |
| `echarts` | 345,026 B | 119,285 B | live-dashboard route |
| `zrender` | 175,919 B | 58,559 B | live-dashboard route |
| live-dashboard view | 37,713 B | 10,668 B | `/dashboards/:id` |
| feeds view | 17,405 B | 4,924 B | `/feeds` |
| dashboard-list view | 10,971 B | 3,378 B | `/dashboards` |
| `vue-echarts` | 7,993 B | 3,561 B | live-dashboard route |

Hashed filenames change between builds, so the executable checker measures generated output rather than relying on the names in this table.

## Enforced budgets

`npm run build:budget` runs after the production build and fails when:

- JavaScript referenced directly by `index.html` exceeds 250,000 bytes raw in total;
- any individual emitted JavaScript file exceeds 500,000 bytes raw;
- `dist/sw.js` is missing; or
- any emitted application JavaScript chunk is absent from the generated PWA precache manifest.

These thresholds retain useful headroom over the measured result while preventing a return to the eager 707 kB entry bundle.

## Offline and container evidence

The split build generated 27 PWA precache entries covering every application JavaScript chunk. The larger number of files increased manifest overhead slightly, from 774.05 KiB to 777.97 KiB of precached assets, while keeping route chunks available offline.

The same output was rebuilt successfully inside the Node 22 to nginx production container. The complete frontend dependency audit remained at zero vulnerabilities.

## Verification commands

```sh
npm ci
npx vitest run --maxWorkers=2
npm run build
npm run build:budget
docker build --tag pulseboard-frontend:bundle-ci .
npm audit --audit-level=low
```

The route regression test asserts that every named route remains behind an async component loader. The budget script is intentionally independent of hashed output names and prints raw and gzip evidence for review.
