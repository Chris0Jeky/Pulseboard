# Product error coverage

`GET /v1/product/<project>` reports `errorsTruncated` as an additive boolean in
`pulseboard.product/1`. It describes the raw-group read used to construct error
counts, not whether the separate, documented top-100 display limit was reached.

The query reads at most 501 distinct raw `(kind, message)` groups from the selected
project and date window, ordered deterministically by count, last-seen timestamp,
kind and message. The 501st row is a sentinel only. With more than 500 groups,
`errorsTruncated` is true; normalization and re-merging use only the first 500.
Returned counts and last-seen timestamps are then lower bounds, normalized groups
may be absent, and ranking may be incomplete. The response limitations and the
Desk error panel both say so; the count column reads `Count (at least)`.

At or below 500 raw groups, all raw groups are normalized before choosing the
maximum 100 displayed groups. Their returned counts and timestamps are complete
for the selected window. This does not imply complete client delivery, all users,
or a complete list when the separate top-100 display limit is reached.

The query covers existing and newly collected rows identically. No ingestion-only
normalization, migration, historical property rewrite, or retention change is
required. The regression fixture has 500 raw variants normalizing to A (1,000
records) and 499 variants normalizing to B (499 records): the A-only response is
explicitly partial, including after a new canonical B event is collected. Raw
historical properties remain unchanged.

The Desk accepts responses from older collectors without this field, but calls
that coverage unknown, not complete. New collectors always send a boolean; null,
string and numeric flags are rejected by the closed reader contract.

Validation:

```sh
cd observatory
npm test
python tests/error-coverage-browser.py --output /tmp/error-coverage
```

The browser test starts a real local HTTP server and SQLite database, checks the
historical fixture and desktop/mobile panel, then removes only the coverage flag
from one real response to test old-collector compatibility. GitHub Actions saves
its screenshots and result JSON. These fixtures are not live product or hosted-D1
evidence.
