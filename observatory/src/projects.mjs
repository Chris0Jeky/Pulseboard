const common = ['page.view', 'app.ready', 'app.error', 'action.requested', 'action.completed', 'action.failed', 'duration.ms'];
const p = (label, origin, path, marker, events = [], routes = ['home']) => ({
  label, origin, probe: { url: origin + path, marker }, events: [...common, ...events], routes,
  releases: ['unattributed'], measurements: ['duration.ms'], dailyLimit: 1000,
});
export const projects = {
  mdviewer: p('MDviewer', 'https://mdviewer-c9r.pages.dev', '/', 'MDviewer', ['export.print_requested', 'export.pdf_completed'], ['home', 'editor']),
  commitatlas: p('CommitAtlas', 'https://commit-atlas.commit-atlas.workers.dev', '/', 'CommitAtlas', ['studio.opened', 'card.exported'], ['home', 'studio', 'other']),
  alibi: p('Alibi', 'https://alibi-after-hours-preview.commit-atlas.workers.dev', '/', 'Alibi', ['puzzle.started', 'puzzle.completed', 'hint.requested'], ['home', 'puzzle', 'castle', 'quiet-wing', 'other']),
  'developer-lens': p('Developer Lens showcase', 'https://chris0jeky.github.io', '/developer-lens/', 'Developer', ['story.opened', 'share.requested'], ['home', 'story', 'share']),
  idleharbor: p('IdleHarbor site', 'https://chris0jeky.github.io', '/IdleHarbor/', 'IdleHarbor', ['download.requested'], ['home']),
  portfolio: p('Portfolio', 'https://chris0jeky.github.io', '/CV_and_Portfolio/Portfolio/portfolio.html', 'Tcaci', ['project.opened', 'contact.requested'], ['home', 'project', 'cv']),
  wealthlens: p('WealthLens site', 'https://chris0jeky.github.io', '/wealthlens-hq/', 'Wealth', [], ['home']),
  taskdeck: { label: 'Taskdeck (local-first)', origin: null, probe: null, events: common,
    routes: ['home', 'board', 'settings'], releases: ['unattributed'], measurements: ['duration.ms'], dailyLimit: 1000 },
};
