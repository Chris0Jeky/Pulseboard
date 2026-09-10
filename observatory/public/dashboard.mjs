let data = null, demo = false, readToken = '', generation = 0, flight = null;
function invalidate() { generation++; flight?.abort(); flight = null; }
const $ = id => document.getElementById(id);
const element = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };
const number = n => Number(n || 0).toLocaleString();
function draw(d) {
  data = d; $('projects').replaceChildren(); $('totals').replaceChildren(); $('insights').replaceChildren();
  $('mode').textContent = demo ? 'SYNTHETIC DEMO' : 'COLLECTOR DATA';
  $('message').textContent = `${demo ? 'Invented demonstration data. ' : ''}Snapshot ${new Date(d.generated).toLocaleString()}. Seven-day window. Refresh is manual.`;
  const total = d.projects.reduce((n, p) => n + p.counts.reduce((a, e) => a + e.n, 0), 0);
  const summaries = [[d.projects.length, 'Registered surfaces'], [d.projects.filter(p => p.monitor.state === 'up').length, 'Probes confirmed up'], [total, 'Accepted browser events'], [d.projects.filter(p => !p.counts.length).length, 'Without product evidence']];
  for (const [value, label] of summaries) { const box = element('div', undefined, 'stat'); box.append(element('strong', number(value)), element('span', label)); $('totals').append(box); }
  for (const p of d.projects) {
    const card = element('article', undefined, 'project');
    const heading = element('h2', p.label); heading.append(element('span', p.monitor.state, 'state ' + p.monitor.state)); card.append(heading);
    card.append(element('p', p.probeExpected ? (p.monitor.checked ? 'Probe checked ' + new Date(p.monitor.checked).toLocaleString() : 'No probe result received') : 'No public runtime probe configured', 'note'));
    const stats = element('div', undefined, 'numbers');
    for (const [n, text] of [[p.sessions, 'Observed page sessions'], [p.counts.reduce((sum, r) => sum + r.n, 0), 'Events']]) { const group = element('div'); group.append(element('strong', number(n)), element('span', text)); stats.append(group); } card.append(stats);
    // Native meter, not dynamically injected CSS: compatible with the strict CSP.
    const budget = element('div', undefined, 'budget'), meter = element('meter'); meter.max = p.budgetLimit; meter.value = p.budgetUsed;
    meter.setAttribute('aria-label', 'Daily event admission budget'); budget.append(meter, element('span', `${p.budgetUsed}/${p.budgetLimit} admitted today`)); card.append(budget);
    const table = element('table'), tr = element('tr'); tr.append(element('th', 'Event / release'), element('th', 'Count')); table.append(tr);
    for (const row of p.counts.slice(0, 8)) { const r = element('tr'); r.append(element('td', row.event + ' / ' + row.release), element('td', number(row.n))); table.append(r); } card.append(table);
    if (!p.counts.length) card.append(element('p', 'No product evidence. Consent may be off, integration may be unconfigured, or there may be no traffic.', 'note'));
    if (p.funnel) card.append(element('p', `${p.funnel.completed}/${p.funnel.started} observed sessions completed after requesting an action. ${p.funnel.started < 30 ? 'Small sample: investigate individual tests before drawing conclusions.' : 'Descriptive only, not a causal experiment.'}`, 'note'));
    $('projects').append(card);
    if (['unknown', 'stale', 'down'].includes(p.monitor.state)) $('insights').append(element('p', `${p.label}: ${p.monitor.state === 'down' ? 'three consecutive probes failed; check the service and monitor path.' : 'verify the monitoring path before judging availability.'}`, 'prompt'));
    if (p.funnel && p.funnel.started >= 10 && p.funnel.completed / p.funnel.started < .5) $('insights').append(element('p', `${p.label}: fewer than half of observed action sessions completed. Reproduce the journey and check event definitions; this does not establish a product defect.`, 'prompt'));
  }
  $('export').disabled = false;
}
function fixture() {
  const now = Date.now();
  return { generated: now, windowDays: 7, provenance: 'SYNTHETIC DEMO', projects: ['MDviewer', 'CommitAtlas', 'Alibi', 'Developer Lens', 'IdleHarbor', 'Taskdeck'].map((label, i) => ({
    id: label.toLowerCase().replaceAll(' ', '-'), label, probeExpected: i !== 5,
    monitor: { state: ['up', 'up', 'down', 'up', 'stale', 'unknown'][i], ...(i !== 5 ? { checked: now - (i === 4 ? 7200000 : 120000) } : {}) },
    sessions: i === 5 ? 0 : 27 + i * 41, budgetUsed: i === 5 ? 0 : 90 + i * 47, budgetLimit: 1000,
    counts: i === 5 ? [] : [{ event: 'page.view', release: 'demo-r1', n: 45 + i * 61 }, { event: 'action.requested', release: 'demo-r1', n: 20 + i * 15 }],
    daily: [], funnel: i < 3 ? { started: 20 + i * 15, completed: [16, 29, 15][i] } : null,
  })) };
}
async function load() {
  invalidate(); const current = generation;
  if (demo) { draw(fixture()); return; }
  if (!readToken) { $('message').textContent = 'Enter a read token. No request was made.'; return; }
  const abort = new AbortController(); flight = abort;
  const timer = setTimeout(() => abort.abort(), 8000);
  try { const r = await fetch('/v1/summary', { headers: { Authorization: 'Bearer ' + readToken }, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: abort.signal });
    if (!r.ok) throw new Error('Read failed (' + r.status + ')');
    const snapshot = await r.json(); if (current === generation) draw(snapshot);
  } catch (e) { if (current === generation) $('message').textContent = e.message + '. Any displayed snapshot is now historical, not a fresh health result.'; }
  finally { clearTimeout(timer); if (flight === abort) flight = null; }
}
$('connect').addEventListener('submit', e => { e.preventDefault(); readToken = $('token').value; $('token').value = ''; demo = false; void load(); });
$('demo').addEventListener('click', () => { invalidate(); readToken = ''; $('token').value = ''; demo = true; draw(fixture()); });
$('refresh').addEventListener('click', () => void load());
$('disconnect').addEventListener('click', () => { invalidate(); data = null; demo = false; readToken = ''; $('token').value = ''; $('projects').replaceChildren(); $('totals').replaceChildren(); $('insights').replaceChildren(); $('export').disabled = true; $('mode').textContent = 'NOT CONNECTED'; $('message').textContent = 'Disconnected. Token and displayed snapshot cleared.'; });
$('export').addEventListener('click', () => { if (!data) return; const url = URL.createObjectURL(new Blob([JSON.stringify({ ...data, demo }, null, 2)], { type: 'application/json' }));
  const a = element('a'); a.href = url; a.download = 'observatory-aggregates.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
