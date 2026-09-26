// Fake browser runtime for the SDK v3 tests: DOM, storage, timers, fetch and performance, no network.
export const ORIGIN = 'https://product.example';
export const COLLECTOR = 'https://collector.example';

export const config = (over = {}) => ({
  id: 'demo', label: 'Demo', origin: ORIGIN, collector: COLLECTOR, release: '1.0.0',
  project: { events: ['page.view', 'app.ready', 'thing.done'], routes: ['home', 'puzzle', 'other'], releases: ['unattributed', '1.0.0'] },
  ...over,
});

export function storage(initial = {}) {
  const map = new Map(Object.entries(initial));
  const writes = [];
  return {
    map, writes,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { writes.push(key); map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
  };
}

export function element(tag, log) {
  const node = {
    tagName: String(tag).toUpperCase(), children: [], attributes: {}, style: {}, listeners: {}, parent: null,
    className: '', textContent: '', type: '', id: '', checked: false, disabled: false, focused: 0,
    set innerHTML(_) { log.html += 1; throw new Error('innerHTML is forbidden'); },
    get innerHTML() { return ''; },
    insertAdjacentHTML() { log.html += 1; throw new Error('insertAdjacentHTML is forbidden'); },
    setAttribute(name, value) { node.attributes[name] = String(value); },
    getAttribute(name) { return node.attributes[name] ?? null; },
    append(...nodes) { for (const n of nodes) { n.parent = node; node.children.push(n); } },
    prepend(...nodes) { for (const n of [...nodes].reverse()) { n.parent = node; node.children.unshift(n); } log.order.push('dom'); },
    remove() { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; node.removed = true; },
    focus() { node.focused += 1; log.focus = node; },
    contains(other) { for (let n = other; n; n = n.parent) if (n === node) return true; return false; },
    addEventListener(type, fn) { (node.listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { node.listeners[type] = (node.listeners[type] || []).filter(f => f !== fn); },
    emit(type, event = {}) { for (const fn of [...(node.listeners[type] || [])]) fn({ type, ...event }); },
  };
  return node;
}

export const walk = (node, out = []) => { out.push(node); for (const child of node.children || []) walk(child, out); return out; };
export const byClass = (root, name) => walk(root).filter(n => (n.className || '').split(' ').includes(name));
export const text = root => walk(root).map(n => n.textContent || '').join('');

/** A controllable runtime. `region`: 'eea' | 'other' | 'fail' | 'pending'. `status`: POST status code. */
export function makeRuntime({ region = 'eea', status = 202, nav = {}, local = storage(), session = storage(), referrer = '',
  search = '', width = 1280, dark = false, slot = false, barHolder = false, scrollPane = false, origin = ORIGIN, loading = false } = {}) {
  const log = { html: 0, order: [], focus: null };
  const timers = new Map();
  let nextTimer = 1, clock = 0, uuidCount = 0;
  const calls = [];
  const observers = [];
  const document = element('#document', log);
  const body = element('body', log);
  const slotNode = slot ? element('div', log) : null;
  const holderNode = barHolder ? element('div', log) : null;
  const paneNode = scrollPane ? Object.assign(element('main', log), { scrollTop: 0, clientHeight: 500, scrollHeight: 2000 }) : null;
  if (holderNode) holderNode.style.height = '2.5rem';
  Object.assign(document, {
    body, referrer, readyState: loading ? 'loading' : 'complete', visibilityState: 'visible',
    documentElement: { scrollHeight: 2000, clientHeight: 800, scrollTop: 0 },
    createElement: tag => element(tag, log),
    querySelector: selector => (selector === '[data-pulseboard-slot]' ? slotNode : selector === '[data-pulseboard-bar]' ? holderNode
      : selector === '[data-pulseboard-scroll]' ? paneNode : null),
  });
  Object.defineProperty(document, 'activeElement', { get: () => log.focus ?? body, configurable: true });
  if (holderNode) body.append(holderNode);
  if (slotNode) body.append(slotNode);
  class PerformanceObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; }
    observe(options) { this.options = options; observers.push(this); }
    disconnect() { this.disconnected = true; }
  }
  const runtime = Object.assign(element('window', log), {
    document, navigator: { ...nav }, localStorage: local, sessionStorage: session, innerWidth: width, innerHeight: 800, scrollY: 0,
    location: { origin, protocol: new URL(origin).protocol, href: origin + '/secret/page?utm_campaign=x', search },
    AbortController, TextEncoder, PerformanceObserver,
    crypto: { randomUUID: () => '00000000-0000-4000-8000-' + String(++uuidCount).padStart(12, '0') },
    performance: { now: () => clock, getEntriesByType: type => (type === 'navigation' ? [{ responseStart: 420, activationStart: 20 }] : []) },
    matchMedia: query => ({ matches: dark && query === '(prefers-color-scheme: dark)' }),
    setTimeout: (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => { timers.delete(id); },
    fetch: (url, init) => {
      const call = { url, init, body: init.body ? JSON.parse(init.body) : null, aborted: false };
      calls.push(call);
      log.order.push('fetch');
      init.signal?.addEventListener?.('abort', () => { call.aborted = true; call.reject?.(new DOMException('The operation was aborted.', 'AbortError')); });
      if (url.includes('/v1/consent/')) {
        if (region === 'fail') return Promise.reject(new TypeError('network'));
        if (region === 'pending') return new Promise(() => {});
        return Promise.resolve({ ok: true, json: async () => ({ v: 1, region }) });
      }
      if (call.hold) return new Promise(() => {});
      return new Promise((resolve, reject) => {
        if (runtime.hold) { call.release = resolve; call.reject = reject; return; }
        resolve({ ok: runtime.status >= 200 && runtime.status < 300, status: runtime.status });
      });
    },
  });
  runtime.status = status;
  runtime.hold = false;
  return {
    runtime, document, body, slot: slotNode, holder: holderNode, pane: paneNode, log, calls, timers, observers,
    posts: () => calls.filter(c => c.init.method === 'POST'),
    counts: () => calls.filter(c => c.url.includes('/v1/collect-stat/')),
    products: () => calls.filter(c => c.url.includes('/v1/product/')),
    tick: ms => { clock += ms; },
    /** Fire every timer scheduled for `ms` (default: the 2 s flush). */
    fire(ms = 2000) { for (const [id, t] of [...timers]) if (t.ms === ms) { timers.delete(id); t.fn(); } },
    emitEntries(type, entries) { for (const o of observers) if (o.options.type === type && !o.disconnected) o.callback({ getEntries: () => entries }); },
  };
}

export const settle = () => new Promise(resolve => setImmediate(resolve));
