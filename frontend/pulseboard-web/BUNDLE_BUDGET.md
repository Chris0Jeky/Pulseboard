# Workbench frontend bundle budget

Measured on 2026-09-17 with Node 22, Vite 7.3.6 and the production PWA build.
Sizes are minified bytes followed by gzip bytes. Hashed filenames change between builds.

## Guardrails

- entry JavaScript: at most **150,000 bytes**
- every JavaScript chunk: at most **500,000 bytes**
- dashboard, live-dashboard and feeds views must remain async route boundaries
- ECharts and ZRender must remain separate measured chunks
- chart chunks must not be module-preloaded by `index.html`
- every application JavaScript/CSS asset and `registerSW.js` must remain named in the generated service worker precache

Run after a production build:

```bash
npm run build
npm run check:bundle
```

The executable check lives in `scripts/check-bundle-budget.mjs` and runs in the frontend CI gate.
It reports minified and gzip sizes before enforcing the limits.

## Measurements

| Stage | Asset | Minified | Gzip | Reading |
|---|---|---:|---:|---|
| Baseline | single entry | 707,093 B | 240,690 B | all routes and charts were eager |
| Async routes only | entry | 111,042 B | 43,293 B | route code left the app shell |
| Async routes only | live-dashboard route | 565,175 B | 191,721 B | ECharts still exceeded the chunk ceiling |
| Final | entry | 111,119 B | 43,326 B | no static imports; chart stack remains lazy |
| Final | live-dashboard route | 45,590 B | 14,109 B | includes `vue-echarts` and live UI code |
| Final | ECharts | 345,034 B | 119,287 B | chart engine isolated by package boundary |
| Final | ZRender | 175,919 B | 58,559 B | renderer isolated by package boundary |
| Final | feeds route | 17,362 B | 4,901 B | loaded only on `/feeds` |
| Final | dashboard-list route | 10,928 B | 3,350 B | loaded only on `/dashboards` |

The final build generated 25 precache entries totalling 777.47 KiB. Splitting changes
startup download, parse and execution boundaries; it does not materially reduce the complete
offline application payload because route and chart chunks are deliberately still precached.

## Boundary rationale

The routes are the primary product boundary. A visitor opening the dashboard register or feeds
page should not parse the live-dashboard editor and chart stack.

Only `echarts` and `zrender` receive explicit Rollup chunk names. A trial that also placed
`vue-echarts` in a manual chunk pulled shared Vue runtime modules into that chunk, which made the
entry import the chart graph eagerly despite its small apparent size. `vue-echarts` therefore
stays with the lazy live-dashboard route while the two measured chart engines are isolated.

Do not solve a future warning by increasing `chunkSizeWarningLimit`. Re-run the attribution
measurement, identify the importing product boundary, and adjust the code or chunk ownership with
a regression test and before/after evidence.

Workbox's generated runtime file is loaded by the service worker and is not itself an entry in its
own precache manifest. The budget checker verifies application assets separately to avoid treating
that generated support file as missing product content.
