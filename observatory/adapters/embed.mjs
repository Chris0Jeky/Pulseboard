/** Optional UI facade. Loaded scripts stay inert until deployment configuration exists. */
export function mountObserver(config, create, runtime = globalThis) {
  const { document, location, navigator } = runtime;
  if (!document || !config.endpoint || location?.origin !== config.origin || location.protocol !== 'https:') return null;
  if (!location.pathname.startsWith(config.scopePath || '/')) return null;
  if (navigator?.globalPrivacyControl || navigator?.doNotTrack === '1' || navigator?.webdriver) return null;
  try { const u = new URL(config.endpoint); if (u.protocol !== 'https:' || u.search || u.hash || u.username || u.password) return null; } catch { return null; }
  if (config.publicFlag && runtime[config.publicFlag.global]?.[config.publicFlag.key] !== config.publicFlag.expected) return null;
  const observer = create(config, runtime);
  const key = 'pulseboard:consent:v1:' + config.id + ':' + config.endpoint, CONSENT_MS = 90 * 86400000;
  let granted = false, overdue = false;
  // A stored expiry is never trusted past 90 days from now; a tampered or corrupt one cannot grant indefinite consent.
  try {
    const stored = JSON.parse(runtime.localStorage.getItem(key) || 'null'), cap = Date.now() + CONSENT_MS;
    const until = Number.isFinite(stored?.until) ? Math.min(stored.until, cap) : 0;
    granted = stored?.allow === true && until > Date.now(); overdue = granted && stored.until > cap;
  } catch { /* Session choice still works without storage. */ }
  const details = document.createElement('details'); details.id = 'pulseboard-usage-sharing';
  const title = document.createElement('summary'); title.textContent = 'Usage sharing';
  const note = document.createElement('p'); note.textContent = 'Optional: share a small set of action counts with ' + new URL(config.endpoint).hostname + '. No document text, filenames, form values or browsing history is sent. Raw events expire after 14 days. Your choice lasts 90 days on this browser.';
  const label = document.createElement('label'), checkbox = document.createElement('input'); checkbox.type = 'checkbox';
  label.append(checkbox, document.createTextNode(' Share basic usage for this site'));
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  let announced = false;
  function apply(value, persist) {
    checkbox.checked = observer.setConsent(value);
    status.textContent = checkbox.checked ? 'Sharing is on. Untick to stop future collection.' : 'Sharing is off. The app works normally.';
    if (persist) { try { runtime.localStorage.setItem(key, JSON.stringify({ allow: checkbox.checked, until: Date.now() + CONSENT_MS })); } catch { status.textContent += ' This choice could not be saved.'; } }
    // One page view per page, on the first time sharing is on: re-ticking the box is not another visit.
    if (checkbox.checked && !announced) { announced = true; observer.track('page.view'); void observer.flush(); }
  }
  checkbox.addEventListener('change', () => apply(checkbox.checked, true));
  details.append(title, note, label, status); document.body.append(details); apply(granted, overdue);
  const error = () => observer.track('app.error');
  const click = event => {
    try { for (const item of config.clicks || []) { if (event.target?.closest?.(item.selector)) { observer.track(item.event); break; } } }
    catch { /* A bad selector must never throw inside a listener on the host document. */ }
  };
  runtime.addEventListener('error', error); runtime.addEventListener('unhandledrejection', error); document.addEventListener('click', click);
  const dispose = () => { observer.dispose(); runtime.removeEventListener('error', error); runtime.removeEventListener('unhandledrejection', error); document.removeEventListener('click', click); details.remove(); };
  // A tracked click that navigates would otherwise be discarded by dispose(); hand the queue over first.
  runtime.addEventListener('pagehide', () => { observer.flushOnHide(); dispose(); }, { once: true });
  return { track: observer.track, flush: observer.flush, flushOnHide: observer.flushOnHide, status: observer.status, dispose };
}
