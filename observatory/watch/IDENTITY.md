# Security Watch event identity

An admitted `(source, id)` binds to the immutable, validated event fields. Events
are closed, flat scalar objects. Reordering JSON properties is an exact replay;
changing, adding, or removing an event field is not.

The collector returns `202` for exact replays with `inserted: 0`. Reusing an ID
with different evidence returns `409` and `error: "identity_conflict"`. No events
or heartbeat state from that conflicting batch are admitted. Sources must not
retry contradictory evidence as though this were a transient collector outage;
correct their event-identity handling instead. Existing evidence is never replaced.

The attempt budget is unchanged: valid submissions, including exact retries and
conflicting batches, consume one unit per submitted event. A budget refusal
returns `429` before conflict classification and does not charge beyond the cap.
The conflict response reports `charged` and `used`, but never the stored payload.

The reservation, identity check and all evidence writes run in one `DB.batch`
transaction. A conflict marks that transaction's reservation ineligible for all
evidence writes while preserving its budget charge. This uses existing columns;
no schema migration or preflight-read race is introduced. Database errors still
roll back the transaction and return `503`.

`tests/watch-identity.test.mjs` covers API refusal, unchanged budgets, exact and
historical reordered replays, heartbeat freshness, source separation, and two
SQLite connections racing contradictory batches. These are isolated synthetic
fixtures, not a claim of live hosted D1 verification.
