# Desk asset provenance

The mark in `public/mark.svg`, the interface composition, CSS, chart SVG generation
and demo scenarios were authored for this change. They use the repository's
GPL-3.0-only licence. No stock photography, downloaded icon set, commercial font,
third-party animation library or remotely served design asset is required.

Typography uses installed system fonts with a monospace fallback for technical
labels. Font files are not bundled. Charts are created as DOM SVG with text-node
labels; no user or imported text becomes executable SVG or HTML. The charts have
accessible labels and an alternative daily-count table where appropriate.

`tests/desk-browser.py --screenshots <directory>` regenerates desktop/mobile views
from the implementation. Captures are generated test artifacts, not a separate
mockup or a promise that production data exists. Use the synthetic scenario for
public screenshots and retain the visible synthetic marking.

The README loop in `docs/assets/Pulseboard-loop.svg` is a synthetic illustration,
not a hosting receipt. Its seven project labels follow the probe registrations in
`src/projects.mjs`; Taskdeck remains local-only. The sample Alibi event uses the
registered `puzzle.completed` name. D1 holds bounded records as well as aggregates:
Voices feedback carries no user or survey key. It retains a per-message UUID v4
for idempotency; surveys and ratings use the separate hashed survey-key contract
in `VOICES.md`. The loop retains a static composition
under `prefers-reduced-motion: reduce`.
