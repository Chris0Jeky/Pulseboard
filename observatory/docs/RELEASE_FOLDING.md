# Bounded release lists and honest display

The collector's open Alibi version pattern can produce more labels than the Desk
can display individually. The existing read contract still returns at most 64
release rows. When folding is required, the 63 heaviest rows are retained, with
label order breaking weight ties. The remaining counts are summed into `other`.
This is a combined bucket, not a release version.

Selection and display order are distinct. Portfolio release rows are ordered by
latest receipt descending **after** folding; the combined row carries the latest
receipt among its contributors and can therefore appear first. Statistics and
operation release lists retain their existing ordering. Consumers must find a
combined row by its `release` field, never assume it is the last row.

The combined row has no duration distribution. Its duration is `null`; neither
p95 nor any other percentile is averaged. Counts still reconcile to project and
operation totals. The release-comparison helper rejects `other` in either cohort,
as the selector already did, and also rejects `unattributed`.

Every visible release table and its accessible meter label describes `other` as
`other (smaller versions combined)`. Usage counts individually shown labels and
states when additional labels have been combined. It does not invent an exact
count of the labels hidden by folding.

If `unattributed` is present, its event count is exact. If absent in an unfolded
list, its count is zero. If absent in a folded list, it is unknown (`null`), not
zero. The Desk surfaces that limitation as `release.attribution_unknown`; it does
not infer that the folded events are all unattributed. Under the current weight
selection an excluded positive unattributed row is at most 1/64 of events, so
folding alone cannot hide the existing 50% unattributed-event observation.

## Regression evidence

`tests/release-fold-display.test.mjs` covers comparisons, display labels, all three
attribution states, Usage copy, and a real SQLite fixture with 65 release labels
whose low-volume tail contains the newest receipt. `tests/release-fold-browser.py`
uses real SQLite response fixtures to exercise drawer text, Usage text, meter
accessible names and a 390px layout. Its default uses HTTP assets; offline mode
is only a rendering fallback. No fixture data is sent to a product or collector.

No schema, admission, budget or registered release vocabulary change is needed.
