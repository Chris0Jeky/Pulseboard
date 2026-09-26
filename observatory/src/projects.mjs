import { ALIBI_RELEASES } from './alibi-releases.mjs';

const common = ['page.view', 'app.ready', 'app.error', 'action.requested', 'action.completed', 'action.failed', 'duration.ms'];
// A Worker cannot fetch another Worker on the same account through its public hostname (Cloudflare error 1042),
// so same-account targets are probed through a service binding named here; the public edge of those two is
// covered by .github/workflows/collector-canary.yml instead. buildEmbed() never publishes the probe record.
const p = (label, origin, path, marker, events = [], routes = ['home'], binding = null) => ({
  label, origin, probe: { url: origin + path, marker, ...(binding ? { binding } : {}) }, events: [...common, ...events], routes,
  releases: ['unattributed'], measurements: ['duration.ms'], dailyLimit: 1000, productLimit: 20000,
});
export const projects = {
  mdviewer: p('MDviewer', 'https://mdviewer-c9r.pages.dev', '/', 'MDviewer', ['export.print_requested', 'export.pdf_completed'], ['home', 'editor']),
  commitatlas: p('CommitAtlas', 'https://commit-atlas.commit-atlas.workers.dev', '/', 'CommitAtlas', ['studio.opened', 'card.exported'], ['home', 'studio', 'other'], 'COMMITATLAS'),
  alibi: { ...p('Alibi', 'https://alibi-after-hours-preview.commit-atlas.workers.dev', '/', 'Alibi', ['puzzle.started', 'puzzle.completed', 'puzzle.failed', 'hint.requested'], ['home', 'puzzle', 'castle', 'quiet-wing', 'other'], 'ALIBI'),
    releases: ALIBI_RELEASES, contextGlobal: 'ALIBI_OBSERVATORY_CONTEXT',
    operations: [{ id: 'puzzle.solve', version: 1, started: 'puzzle.started', completed: 'puzzle.completed', failed: 'puzzle.failed' }] },
  'developer-lens': p('Developer Lens showcase', 'https://chris0jeky.github.io', '/developer-lens/', 'Developer', ['story.opened', 'share.requested'], ['home', 'story', 'share']),
  idleharbor: p('IdleHarbor site', 'https://chris0jeky.github.io', '/IdleHarbor/', 'IdleHarbor', ['download.requested'], ['home']),
  portfolio: p('Portfolio', 'https://chris0jeky.github.io', '/CV_and_Portfolio/Portfolio/portfolio.html', 'Tcaci', ['project.opened', 'contact.requested'], ['home', 'project', 'cv']),
  wealthlens: p('WealthLens site', 'https://chris0jeky.github.io', '/wealthlens-hq/', 'Wealth', [], ['home']),
  taskdeck: { label: 'Taskdeck (local-first)', origin: null, probe: null, events: common,
    routes: ['home', 'board', 'settings'], releases: ['unattributed'], measurements: ['duration.ms'], dailyLimit: 1000 },
};
