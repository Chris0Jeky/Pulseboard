# Survey revision consumer: isolated v2 experiment

**Experimental, not deployed, not a published stable contract.** This advances
Pulseboard #218 and replaces #227's incompatible v1 no-op prototype. It does not
close #218. The production Worker, core schema, deployed settings, existing
`VOICES.md` contract and original Voices route tests remain unchanged. The
experiment is not imported by a production or default local entry point.

## Implemented boundary

The scratch-only handler consumes the existing v1 fields at `/v1/survey/<id>` and
the proposed `pulseboard.survey/2` at `/v2/survey/<id>`. A v2 body has exactly the
same fields, `v: 2`, and one additional `revision`: a positive integer no larger
than `Number.MAX_SAFE_INTEGER`. The existing closed registry, text redaction,
release validation, origin checks, admission switches and 16 KiB reader still
apply. Parsing v2 does not teach the published v1 validator to accept extra keys.

Revision ordering is scoped to `(project, survey, subject, respondent)`. The
respondent stays the existing project-scoped hash; no raw key or unredacted text
is persisted. This is client-reported edit ordering, not authentication or a
verified person. Arbitrary client wall clocks do not determine precedence.

| Incoming submission | Effect | Response |
| --- | --- | --- |
| First v2 for a new identity | Store answer and revision; charge both budgets | 202, `outcome: created`, `updated: false` |
| Higher revision, including identical deliberate reconfirmation | Replace answer; advance revision, receipt time and day; charge both budgets | 202, `outcome: updated`, `updated: true` |
| Equal revision, identical normalized content | Preserve answer, revision, timestamps, country, submissions and budgets | 202, `outcome: duplicate`, `updated: false` |
| Equal revision, different normalized content | No write or charge | 409, `error: revision_conflict` |
| Lower revision | Preserve current answer and budgets | 202, `outcome: stale`, `updated: false` |
| v1 for a v1-only identity | Preserve v1's existing resubmission/charging behaviour | Existing 202 `{accepted, updated}` shape |
| v1 after that identity has accepted v2 | Refuse downgrade without charging | 409, `error: version_conflict` |

All successful responses also contain `accepted: true`. The v2 `accepted` field
acknowledges terminal handling, not that stale content was stored. No respondent,
revision counter, receipt token or raw content is returned. Origin-qualified
responses use `no-store` and CORS; unexpected storage failures return a generic
503. New writes still share the existing project/global voice budgets. This does
not separate feedback capacity or resolve #150's budget-allocation decision.

Equality compares canonical answers/meta, redacted comment and redaction count,
release and device. JSON field order, optional empty selections and registry
option order do not create edits. Edge country and server receipt time are not
producer content. Deliberately confirming identical answers requires a NEW
revision; retrying a delivery retains its old revision and exact producer fields.

## Atomic storage, not read-then-write

The experiment's optional schema adds only `voice_survey_revisions` and its own
schema marker. It does not change core schema version 5 or alter existing tables.
Each request validates the installed scratch schema without creating anything.
Missing/partial schema fails closed, including v1 requests through this handler.

One D1-shaped batch contains: classification; guarded project quota reservation;
receipt-gated global quota; receipt-gated answer upsert; and, for v2, the
receipt-gated revision upsert. The classification AND reservation guard execute
inside the transaction. Guarding only the final revision upsert would still
charge for stale work and could overwrite the answer first. Both budgets and
both data rows roll back together on statement failure. Quota exhaustion never
turns a duplicate into a new write. A higher revision refused for lack of quota
is not recorded as accepted and may be retried later.

Revision metadata has a foreign key to the answer with `ON DELETE CASCADE`.
The existing 400-day answer-retention boundary therefore also removes its
revision on the tested SQLite backend. Schema reapplication is idempotent.
Externally orphaned metadata fails closed rather than certifying absent content.

**Ordering is guaranteed only while the answer/revision survives.** No immortal
identifier tombstone is introduced. After expiry or authorized deletion, a very
old request cannot be distinguished from a first request with that identity.
Producer queue expiry and the reset/deletion protocol remain rollout decisions;
this experiment does not claim replay protection across deletion or forever.

## Exercise it without touching a deployment

From `observatory/`:

```sh
node --test tests/survey-v2*.test.mjs tests/voices-*.test.mjs
npm test
```

The HTTP regression uses the existing `startLocalRunner` with an explicit
`requestHandler: createSurveyV2Experiment({acceptV2: true})`, a fresh in-memory
database and synthetic bodies. Other tests use temporary SQLite files deleted
at teardown. Two connection tests synchronize transaction entry; separate
worker-thread tests also exercise genuinely parallel SQLite writers for identical
submissions, conflicting equal revisions, reordered revisions and v1/v2 takeover.
The normal `npm start` and Wrangler entry do not install or expose this handler.
Do not apply this directory's SQL to production.

`createSurveyV2Experiment()` defaults to refusing v2 intake. It STILL guards v1
writes using installed revision metadata. Turning v2 off must not permit an old
v1 payload to overwrite a protected answer. The factory rejects nonboolean
activation values. There is no CLI activation command, automated migration,
credential access, hosted resource creation or new probe.

## Producer and rollout work still required

1. **Coordinate the Alibi producer in its own repository/session.** Allocate and
   persist a monotonically increasing revision together with the exact queued
   payload, atomically across tabs for the installation/survey/subject. Never
   allocate another revision merely because a transport failed. Never relabel an
   old queued payload as the latest revision when it is flushed. LocalStorage
   read/increment/write alone is not an atomic cross-tab transaction.
2. **Make 409 handling explicit.** A same-revision conflict is not a transient
   network failure. A v1 downgrade refusal needs an upgrade/export decision, not
   an endless retry or a fabricated new respondent. Handle terminal `stale` and
   `duplicate` acknowledgements without telling the player an obsolete answer
   was stored. Recheck source reset, storage failure, counter exhaustion, queue
   eviction and crash recovery; resetting an installation key changes the
   respondent population and is not a silent recovery technique.
3. **Validate one complete producer-to-consumer journey.** Include deliberate
   reconfirmation, B-before-A, A/B/delayed-A, lost acknowledgements, concurrent
   tabs, offline upgrades, consent/admission refusal, last quota slot, corruption,
   expired answers and actual read-model results. Current HTTP tests use synthetic
   producer envelopes, not a released Alibi client.
4. **Prove hosted parity and cost in an approved disposable environment.** Verify
   D1 transactions, foreign keys/cascade, migrations, read/write cost and
   concurrent reservations. Local SQLite passing is not hosted-D1 evidence.
5. **Review mixed-worker deployment and rollback.** All active writers of v2
   identities must enforce the v1 guard before v2 is admitted. The old production
   Worker does not know this side table and can overwrite protected content; do
   not roll a v2 database back to that binary. Disabling v2 intake while retaining
   this handler's v1 guard is the tested rollback boundary. Restoring the old
   Worker or removing the side table requires a separate reviewed data plan.

The duplicated survey-route SQL is intentional isolation for this experiment,
not a second production implementation to maintain indefinitely. Consolidation
with the shared voice reservation helper belongs to the reviewed integration,
with these regressions retained. No rollout or stable-contract approval is
implied by green tests, repository review or merging inert experiment files.
