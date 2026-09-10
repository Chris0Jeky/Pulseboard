/** Explicit asset routes shared by the Worker and local server. No filesystem path inference. */
export const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/dashboard.mjs', ['dashboard.mjs', 'text/javascript; charset=utf-8']],
  ['/dashboard.css', ['dashboard.css', 'text/css; charset=utf-8']],
  ['/desk-model.mjs', ['desk-model.mjs', 'text/javascript; charset=utf-8']],
  ['/desk-demo.mjs', ['desk-demo.mjs', 'text/javascript; charset=utf-8']],
  ['/desk-bridge.mjs', ['desk-bridge.mjs', 'text/javascript; charset=utf-8']],
  ['/mark.svg', ['mark.svg', 'image/svg+xml']],
]);
