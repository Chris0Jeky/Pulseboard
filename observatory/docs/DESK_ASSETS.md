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
