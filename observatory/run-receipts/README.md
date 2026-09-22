# Private run receipts

This is the first, deliberately local slice of issue #23. It imports reviewed JSON files containing bounded CI or experiment run measurements. It does **not** connect to GitHub, a billing account or an agent provider; it does not read prompts, source code, task bodies, private PR titles or credentials.

Run receipts remain a separate private evidence plane. They are not part of the Observatory browser collector, portfolio endpoint, public pulse exporter, static Desk assets or deployment schema.

## What a receipt can say

`pulseboard.run-receipts/1` records:

- one registered Pulseboard project id;
- stable source, receipt and run identities;
- canonical UTC start/end times and status;
- explicit attempt/retry linkage;
- allowlisted measured units such as runner seconds or network bytes;
- optional cost in integer minor units, with `actual`, `estimated` and `subscription-allocation` kept distinct;
- an explicit outcome state and an opaque bounded verification reference for verified outcomes;
- coverage completeness and allowlisted limitations.

The contract contains no free-text title, message, URL, branch, commit, actor, prompt, code, repository path or task field. Unknown fields fail closed. A file is limited to 256 KiB, 256 receipts, 16 projects, eight resource units per receipt, four currencies and a 90-day coverage window.

## Preview before import

The preview validates the whole document and emits private aggregates only. Receipt ids, run ids, retry links and verification references are redacted.

```sh
cd observatory
node run-receipts/file-adapter.mjs preview run-receipts/examples/github-actions.sample.json
```

The command reads one regular local file after checking its size. There is no stdin, URL or arbitrary network adapter.

## Explicit local import

Import requires an explicit SQLite path:

```sh
cd observatory
node run-receipts/file-adapter.mjs import \
  run-receipts/examples/github-actions.sample.json \
  .data/private-run-receipts.sqlite
```

The adapter creates only the tables in `run-receipts/schema.sql`. Import is idempotent by source/run/attempt identity. Re-importing identical evidence reports duplicates; changed evidence under an existing identity is rejected rather than overwritten. A repeated receipt still moves its export coverage forward: a complete export replaces the coverage an incomplete one recorded, and among equals the newer export wins, so a later complete export can certify a window. A later incomplete export never withdraws an earlier complete certification. The full document is validated before any write.

The sample is synthetic and incomplete. It exists to exercise the adapter, not to claim real CI activity or cost.

## Reading the aggregate

`readRunReceiptSummary()` requires one registered project and a bounded start-inclusive/end-inclusive run window. It returns:

- status, attempt, retry and distinct-run counts;
- measured resource sums with units preserved;
- costs grouped by kind and currency, with earliest/latest source time;
- explicit outcome counts and source coverage limitations;
- a cost-per-verified-accepted-outcome fraction only when coverage is complete, every receipt has one consistent cost kind/currency and at least one accepted outcome is verified.

Otherwise the read model abstains and explains why. It never adds currencies, mixes actual and estimated values, or treats run count as productivity.

`makeRunReceiptQuestionCard()` converts the aggregate into a review question. It does not cancel workflows, create tasks, notify anyone or change CI.

## Privacy and export boundary

Every projection carries `visibility: "private"`. Tests prove that:

- the existing `makePublicPulse()` exporter rejects the receipt projection;
- no run-receipt module or file is present in the Worker's static asset map;
- preview and question-card serialization contain no run, receipt or verification identities.

The local SQLite database is operationally sensitive. Keep it outside source control and do not publish it as a build artifact.

## Verification

```sh
cd observatory
npm ci
node --test tests/run-receipts.test.mjs
npm test
node --check run-receipts/contracts.mjs
node --check run-receipts/store.mjs
node --check run-receipts/model.mjs
node --check run-receipts/file-adapter.mjs
npx wrangler deploy --dry-run
```

The Worker dry-run proves this private local module does not alter the deployed bundle. Automatic provider connections, hosted storage, invoices and real account scopes remain future reviewed gates.
