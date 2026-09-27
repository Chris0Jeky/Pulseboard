# Voices: player feedback, surveys and puzzle ratings (contract v1)

Owner decision, 2026-09-27 (in chat; recorded in Alibi `HUMAN_TODO.md` and here as HUMAN_TODO q-30): player
feedback and survey answers go to **Pulseboard**. Written feedback is stored only when a player presses Send. The
owner also asked for a survey tied to an installation id "so a user can re-submit the same survey multiple times with
updated answers without making it seem like there are many users", and to understand what players like and want more of.

Pulseboard owns this contract. The producer is Alibi (later any admitted product); the consumers are the collector and
the Desk. Alibi implements the client half; both halves cite this file. Field names, enums, status codes and semantics
here are the shared contract and change only by a new version.

Code: `src/voice-contract.mjs` (validation, cleaning, redaction, hashing), `src/surveys.mjs` (the closed registry),
`src/worker.mjs` (routes, budget, retention), `src/voices.mjs` (read model), `migrations/0005-voices.sql` (schema 5),
`public/desk-voices.mjs` and the Voices view in `public/dashboard.mjs` (Desk). Tests: `tests/voices-*.test.mjs` and
`tests/desk-browser.py`.

## Privacy position (what is new, and why it is acceptable)

The usage plan (`USAGE_PLAN.md`) stores no cross-visit identifier and no free text. Voices is a separate,
**player-initiated** channel with a narrower rule set:

- Nothing is sent unless the player acts: presses Send on a message, submits a survey, or taps a rating. Automatic
  prompts only *ask*; they never send.
- Written feedback carries no identifier at all. The server removes e-mail addresses, IP addresses, URLs and
  phone-number-like runs from the text (best effort) and counts removals.
- Surveys and ratings carry a random **survey key** (UUID v4) created on the device the first time the player submits
  one. Its only purpose is to let the same installation replace its own earlier answer. It is never sent with usage
  counts, diagnostics or journeys, and the collector stores only `SHA-256(project + ':' + key)`, never the raw key.
  Players can reset it from Privacy.
- No IP address, User-Agent string, page URL, name or e-mail is stored. Country, browser and OS are derived
  server-side exactly as for product events (classified, UA dropped).
- The Pulseboard consent switches (counts / diagnostics / journeys) do not gate Voices, because Voices is an explicit
  submission, not measurement. GPC/DNT likewise does not block an explicit Send.
- Retention: feedback 365 days, survey answers and ratings 400 days, then deleted by the existing retention sweep.

## Admission

- Producer switch `COLLECT_VOICE_PROJECTS`: an exact comma list parsed with `exactProjectList` (same rules as
  `COLLECT_STAT_PROJECTS` / `COLLECT_PRODUCT_PROJECTS`: no spaces, case changes, empty entries or duplicates, and any
  malformed entry disables the whole list). An id must also have an entry in `src/surveys.mjs`, so a project without a
  voice vocabulary fails the list closed. `COLLECT_ENABLED` and a valid session policy gate it exactly like product
  events; it needs no `COLLECT_PROJECTS`, `COLLECT_STAT_PROJECTS` or `COLLECT_PRODUCT_PROJECTS` membership and opens none
  of them. `wrangler.jsonc` lists `alibi` for production and nothing for the preview environment. `/readyz` reports
  `voices: { configured, admitted }`.
- `Origin` must equal the registered project origin. CORS mirrors the product route:
  `Access-Control-Allow-Origin: <origin>`, `Vary: Origin`; the preflight (`OPTIONS`, on either route) answers 204 with
  `Access-Control-Allow-Methods: POST, PUT`, `Access-Control-Allow-Headers: Content-Type`, max age 600.
- `content-type: application/json` only (a `charset` parameter is allowed); bodies are read with the existing bounded
  reader: 16 KiB, 5 seconds.
- Budget: each accepted write reserves one unit under `<project>:voice` (default 300 a UTC day, overridable per project
  as `voiceLimit` in `src/projects.mjs`) and one under the global key `*:voice` (100 a day, "Budget and storage"
  below), charged with the same receipt-gated two-budget statement as product events: the project row is reserved only
  if the global row has room, the global row is charged only against that receipt, and the stored row is gated on the
  same receipt in the same D1 batch. Either budget full: `429` with `Retry-After: 3600`; nothing stored, neither charged.

Checks run in this order, and CORS headers are present on every answer after the origin check:

| Status | Body | When |
|---|---|---|
| `404` | `{ error: 'not_found' }` | unknown, local-only or mis-cased project id, or any query string |
| `403` | `{ error: 'origin' }` | `Origin` is not the project's registered origin |
| `204` | none | `OPTIONS` preflight |
| `405` | `{ error: 'method' }` | not `POST` (feedback) or `PUT` (survey); `Allow` names the method |
| `503` | `{ error: 'disabled' }` | `COLLECT_ENABLED` off, invalid session policy, or the id not in `COLLECT_VOICE_PROJECTS` |
| `415` | `{ error: 'media_type' }` | not `application/json` |
| `400` | `{ error: 'contract' }` | over 16 KiB, not UTF-8 JSON, or outside the contract below |
| `429` | `{ error: 'daily_budget' }` | a budget is full (`Retry-After: 3600`) |
| `202` | `{ accepted: true, duplicate: <bool> }` | feedback stored, or its `id` was already stored |
| `202` | `{ accepted: true, updated: <bool> }` | survey or rating stored; `updated` when it replaced an earlier answer |

An unexpected failure answers `503 { error: 'unavailable' }`.

## 1. Feedback: `POST /v1/feedback/<project>`, contract `pulseboard.feedback/1`

```json
{
  "v": 1,
  "id": "0b8f6c7e-3f1a-4d8e-9c55-2a1d9e7b6f10",
  "release": "0.15.0",
  "kind": "bug",
  "route": "puzzle",
  "subject": "vault-binary-04",
  "text": "The last row won't accept a moon even though the row has room.",
  "written": "2026-09-27",
  "context": { "device": "mobile" }
}
```

| Field | Rule |
|---|---|
| `v` | exactly `1` |
| `id` | lower-case UUID v4, created on the device when Send is pressed; idempotency key |
| `release` | as for product batches: `^[0-9A-Za-z.+-]{1,32}$` and admitted by the project's release rule (`src/release-label.mjs`, q-28; Alibi: any well-formed `MAJOR.MINOR.PATCH` with an optional short lower-case `-prerelease`) |
| `kind` | `bug`, `idea`, `puzzle`, `praise`, `other` |
| `route` | the project's route vocabulary in `src/surveys.mjs` (Alibi: `home`, `puzzle`, `castle`, `quiet-wing`, `games`, `settings`, `other`) |
| `subject` | `''` or `^[a-z0-9][a-z0-9-]{0,63}$` (Alibi sends only official catalogue ids, else `''`) |
| `text` | 1–2000 characters after trimming; control characters other than `\n` and `\t` become spaces |
| `written` | UTC day (`YYYY-MM-DD`, a real date) the player pressed Send; not after the receipt day + 1 and not more than 30 days before it (offline queue) |
| `context` | exactly `{ device }` with `mobile`, `tablet` or `desktop` |

Every key is required and no other key is accepted at any level. Storage (`voice_feedback`, primary key
`(project, id)`): `project, id, received, day, written, release, kind, route, subject, text, redacted, device, country,
browser, os`; `day` is the UTC receipt day and `received` the receipt time. The duplicate check, the reservation and
`INSERT ... ON CONFLICT DO NOTHING` run in one transaction: a resend of a stored `id` is
`202 { accepted: true, duplicate: true }`, stores nothing (the first stored copy wins) and charges no budget, even when
today's budget is full.

## 2. Surveys and ratings: `PUT /v1/survey/<project>`, contract `pulseboard.survey/1`

```json
{
  "v": 1,
  "survey": "alibi-taste-1",
  "subject": "",
  "respondent": "5f0a0c2e-8f7d-4b61-a3d4-0a8e77b1c9d2",
  "release": "0.15.0",
  "answers": { "often": "weekly", "more": ["sudoku", "scene"], "difficulty": "mostly-right" },
  "meta": {},
  "comment": "",
  "context": { "device": "mobile" }
}
```

The collector validates against a closed registry, `src/surveys.mjs`, keyed by project and survey id. Each survey
declares its questions (`one` or `many`, option ids, `required`, `max` for `many`), whether it takes a `subject`
(`none` or `puzzle`), its allowed `meta` keys and values, and whether a `comment` (≤ 500 characters, same text cleaning
and redaction as feedback) is allowed. Unknown surveys, questions, options, meta keys or values are `400 contract`.
`respondent` is a lower-case UUID v4; it is hashed before storage and never returned.

- All nine keys are required. `subject` is exactly `''` for a `none` survey and matches the feedback subject pattern
  for a `puzzle` survey. `meta` is `{}` for a survey that declares none. `comment` is a string: `''` (or blank after
  cleaning) where comments are not allowed.
- `one` answers are one option id. `many` answers are an array of distinct option ids, at most `max`; an empty array
  for an optional question is the same as no answer. A required question must be answered.
- Answers and meta are stored as canonical JSON: questions, options and meta keys in registry order.

Storage (`voice_survey`, primary key `(project, survey, subject, respondent)` where `respondent` is the hash):
`first_received, received, day, release, answers` (canonical JSON), `meta` (canonical JSON), `comment, redacted,
device, country, submissions`. An existing row is replaced in place (answers, meta, comment and its `redacted` count,
release, received, day, device, country) and `submissions` increments: `202 { accepted: true, updated: true }`. A
player therefore counts once per survey and subject however often they resubmit. Every accepted write is charged,
updates included.

### Alibi surveys (registry v1)

Families (`family`): `bridges, scene, dossier, witness, sudoku, nonogram, binary, futoshiki, lightup, tents,
aquarium, network, trail`. Tiers (`tier`): `gentle, steady, tricky, expert, master, grandmaster`.

**`alibi-taste-1`** (subject `none`, comment allowed):

| id | type | options |
|---|---|---|
| `often` (required) | one | `daily`, `few-a-week`, `weekly`, `now-and-then`, `first-time` |
| `more` | many, max 5 | the 13 families plus `archive-heist`, `borough`, `duel`, `block-cabinet`, `gardens`, `casebooks`, `castle` |
| `difficulty` (required) | one | `too-easy`, `mostly-right`, `too-hard`, `mixed` |
| `tiers` | many, max 3 | the 6 tiers |
| `next` | one | `more-puzzles`, `harder-puzzles`, `new-families`, `more-story`, `club-games`, `polish` |
| `feel` | one | `love-it`, `fine`, `cluttered`, `confusing` |
| `recommend` | one | `definitely`, `probably`, `not-sure`, `probably-not` |

**`puzzle-rating`** (subject `puzzle`, no comment, meta `family` and `tier` required from the enums above):

| id | type | options |
|---|---|---|
| `difficulty` (required) | one | `too-easy`, `just-right`, `too-hard` |
| `more` | one | `yes` (the "More like this" heart; absent means not chosen) |

A published option list is never edited: a changed survey gets a new id (`alibi-taste-2`), because the read model counts
only the options the registry lists.

## Text on the server

Feedback `text` and survey `comment` are cleaned (control characters other than newline and tab become spaces, then
trimmed) before the length check, then redacted before storage. Redaction replaces each removal with a marker and
counts it in `redacted`; it never rejects:

| Removed | Marker | Shape |
|---|---|---|
| Links | `[link]` | `scheme://…` or `www.…` up to the next space; closing punctuation stays |
| E-mail addresses | `[email]` | the product events' e-mail pattern |
| IP addresses | `[ip]` | IPv4, IPv6 and IPv4-mapped IPv6, as for product events (a dotted quad such as `v1.2.3.4` counts) |
| Phone-number-like runs | `[phone]` | a run of digits with spaces, dots, dashes, slashes, brackets or a leading `+`: nine or more digits, or seven or more with a separator, `+` or brackets. Longer digit runs (card or account numbers) are removed too |

Dates standing alone (`2026-09-27`, `27/09/2026`, `2026/09/27`), clock times, release strings, puzzle ids and short
numbers are kept. A date shape that starts or ends a longer digit run (`06.12.34.56.78`) is treated as part of that run.
A marker can be longer than what it replaced, so the result is cut back to the bound without splitting a surrogate
pair. This is best effort: text can still describe a person.

## 3. Reads: `GET /v1/voices/<project>?days=1|7|14|30|90`

Read token only, with the same authentication, window parsing (one canonical `days`, default 7, no other parameter)
and errors as `/v1/product/<id>`: `401`, `404 { error: 'project' }` for an unregistered or local-only id, `400
{ error: 'window' }`, `503` for an invalid session policy. A public project with no voice registry reads empty. One D1
batch, one snapshot, `pulseboard.voices/1`:

```
{ schema, project, generatedAt, window: { startDay, endDay, days, timezone: 'UTC', partialToday: true },
  collectionAdmitted, population, limitations: [sentence],
  feedback: [{ id, day, written, release, kind, route, subject, text, redacted, device, country, browser, os }],
  feedbackTruncated,
  surveys: [{ survey, respondents, questions: [{ id, type, required, max?, answered, options: [{ id, n }] }],
              comments: [text], commentsTruncated }],
  ratings: null | { survey: 'puzzle-rating', n, subjects: [{ subject, family, tier, n, tooEasy, justRight, tooHard, more }],
                    subjectsTruncated, families: [{ family, n, tooEasy, justRight, tooHard, more }], tiers: [{ tier, … }] } }
```

- `feedback`: newest first, at most 500 rows in the window; `feedbackTruncated` when more exist.
- `surveys`: for each survey with subject `none`, in registry order: `respondents`, and per question per option the
  number of current respondents choosing it (a `many` question can sum above `respondents`; `answered` counts the
  respondents who answered that question), every registry option listed including zeros; `comments` are the newest 100,
  text only, no respondent.
- `ratings`: for `puzzle-rating`: per subject (top 500 by `n`, ties by subject), and the same totals rolled up per
  `family` and per `tier` over every rating in the window, in registry order with zeros. A subject reported with
  different family or tier values appears once per combination.
- `limitations`: plain sentences (client-reported and spoofable; a survey key is an installation, not a person;
  clearing site data or resetting the key creates a new respondent; redaction is best effort; the window is by last
  update day).

No respondent hash, survey key, `received` time, `submissions` count or raw `answers`/`meta` is returned.

## The Desk

The **Voices** view (key 7) shares the site and window picker with Usage and Product and reads only while it is open.
It shows a feedback list with a kind filter (text rendered as text nodes, never markup, newlines kept), survey answer
bars with `n` per option, the comments, ratings tables by family, by tier and by puzzle, and the reading limits. It
fits the existing Desk patterns: no framework, self-only CSP, keyboard reachable (native controls, focusable scrolling
regions, number keys), and narrow layouts (tables scroll inside their shells). The sandbox builds invented Voices in
the tab and sends nothing. `public/desk-voices.mjs` refuses any read outside the shape above.

## 4. Content demand (phase 2)

Alibi adds `family` and `tier` props to `puzzle.started`, `puzzle.completed`, `puzzle.failed` and `hint.requested`
journey events. The Voices view's **Content** section reads those four event names for the window on demand (newest
5,000 per name through `/v1/product/<id>/events`, truncation shown) and computes, in the tab, per family and per tier:
started, completed, completions per start, the nearest-rank median of the raw `props.seconds` on completions, and hint
requests per completion; joined with the rating roll-ups above. Events without family or tier are counted, not
guessed. This is the "what do players play, finish, find hard and want more of" answer without asking them. It adds no
collector route.

## Budget and storage

The account is on Cloudflare's free plan, where one D1 database holds at most 500 MB and product events are sized to
about 310 MB (`DESK_ARCHITECTURE.md`). A feedback row at the 2,000-character bound is about 2.5 KB with its indexes for
Latin text (up to about 6 KB for three-byte scripts). The global `*:voice` key of 100 writes a day therefore bounds a
year of feedback at about 100 × 2.5 KB × 365 ≈ 91 MB. Survey and rating updates replace rows in place and add no
storage; a new survey row is under 1 KB. The per-project default of 300 is the contract's; while the global key is 100
the global key binds first. Raise either only after measuring D1's reported size or moving to a paid plan.

## Retention

The existing 15-minute sweep deletes feedback whose receipt `day` is 365 or more UTC dates old and survey rows whose
last update `day` is 400 or more dates old (365 and 400 dates are kept, including today), through the `day` indexes.

## Rollout and rollback

1. Apply `migrations/0005-voices.sql` to production D1 (additive: two tables, two indexes, the schema marker).
2. Deploy the collector built from this change; `/readyz` must report schema 5 and `voices.admitted: ["alibi"]`.
3. Release the Alibi client that sends Voices.

Rolling back to a schema-4 Worker needs `UPDATE schema_version SET version=4 WHERE id=1 AND version=5` after the
deploy; the tables stay and nothing writes to them. Emptying `COLLECT_VOICE_PROJECTS` and redeploying stops intake
without a schema change; the Alibi client keeps its queue on `503`.

## Alibi client behaviour (the producer half)

- Eligibility: only the primary Cloudflare origin (`ALIBI_CONFIG.standalone === false`) and only when the collector
  base URL is known. Elsewhere (Sites, standalone file, Android preview) the feedback sheet explains that sending works
  on the main site and keeps the existing "Create issue report" export path.
- **Feedback entry points**: one quiet "Feedback" control reachable from every screen (global navigation), "Report a
  problem with this puzzle" on the puzzle screen (pre-fills `kind: puzzle` and `subject`), and a Feedback panel in
  Settings. The sheet: kind chips, a text area with a character counter, one line saying what is attached (app
  version, screen, puzzle id, device type; no saves, names or e-mail; we can't reply, so don't include personal
  details), Send.
- **Offline queue**: `localStorage` key `alibi:voices:queue:v1`, at most 20 items, each the exact payload plus attempts
  and next-try time. Flush on start (after first render, idle), on `online`, after enqueue, and on `visibilitychange` to
  visible. Backoff 1 min, 5 min, 30 min, 2 h, then every 6 h. `202` removes; `400` removes and keeps a local "could not
  be sent" note; network errors, `429`, `5xx` and `503` keep it; items older than 30 days are dropped. Settings shows
  "N messages waiting to send" with delete. A queued survey or rating for the same survey and subject replaces the older
  queued one. The `alibi-device` IndexedDB schema is not touched.
- **Survey key**: `localStorage` `alibi:voices:respondent:v1`, created on first survey or rating submit; Privacy
  explains it and offers Reset.
- **Survey timing**: never on first visit, never mid-puzzle, never over a board. First offer on a completion screen
  after at least 5 completed official puzzles on at least 2 different days. Afterwards: "Update your answers?" at most
  every 30 days and only after 10 more completions or a new release. "Not now" snoozes 7 days; three snoozes or "Don't
  ask again" stop automatic offers. The survey is always available from Settings. The form pre-fills the last submitted
  answers.
- **Puzzle rating**: a compact optional row on every official puzzle's completion screen: "How was it? Too easy · Just
  right · Too hard" and a "More like this" heart. A tap sends (queued offline); changing it re-sends (upsert). A Settings
  switch hides the row.
- Bundle budget: no ceiling is raised. The sheet and survey form load as a deferred, precached chunk (like the Vault
  chunk) so they work offline; only the entry points, the rating row and the queue flush live in the startup bundle.
- Privacy page, `docs/SECURITY-AND-PRIVACY.md` and README state all of the above in plain language.
