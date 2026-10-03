# Collection Cache and Slot Hardening Design

Date: 2026-07-31

## Goal

Resolve Claude findings V1 and V4 before implementing the monthly overseas filter:

1. A partial or structurally drifted source response must not delete previously cached release channels.
2. A collection slot abandoned by a dead worker must become safely reclaimable after 15 minutes, and an in-progress slot must not be reported as current.

## Scope

- Change stale-channel cleanup authority from inferred opt-out behavior to explicit opt-in behavior.
- Add collection-slot ownership tokens and 15-minute stale-claim recovery.
- Propagate slot outcomes to the release API so active collection is represented as stale when cache exists and unavailable when cache is empty.
- Add one additive D1 migration for the slot claim token.
- Do not change source schedules, collection frequency, dedupe rules, review rules, authentication, or public release DTO fields.
- Do not address Claude findings V2, V3, or V5–V9 in this task.

## V1: explicit snapshot authority

### Contract

- `authoritativeSnapshot` is fail-closed. Only the literal value `true` grants stale-channel cleanup authority.
- Missing, `false`, malformed, blocked, manual, or error results preserve all previously cached channels.
- `createExistingAdapter()` must not infer authority from `connected` plus a missing `malformedRows` field.
- A fetch result may request authority only through an explicit `snapshotComplete: true` signal, and the adapter grants it only when status is connected and `malformedRows === 0`.
- `confirmedEmpty` additionally requires explicit snapshot completeness and the existing per-adapter empty-confirmation opt-in.

### Initial source policy

- Existing legacy adapters remain non-authoritative until each parser has source-specific completeness evidence and regression tests.
- New HTML parsers also remain non-authoritative by default. Structural sentinels and malformed-row counts continue to improve health reporting and review behavior but do not independently authorize deletion.
- Valid parsed releases still update or add catalog/channel rows. The restriction applies only to removal of cached channels omitted from a later response.
- This intentionally prefers temporary stale channels over accidental disappearance. Past releases remain naturally outside upcoming views; future cancellation cleanup can be added later through a reviewed operator workflow or source-specific authority opt-in.

### Repository enforcement

- Both non-empty stale cleanup and confirmed-empty deletion require `result.authoritativeSnapshot === true`.
- The repository must not treat `undefined` as authoritative, including for custom adapters and tests that bypass `createExistingAdapter()`.

## V4: slot ownership and recovery

### Schema

- Add nullable `claim_token` to `collection_slots` through a new additive migration.
- Existing completed/failed rows remain valid with a null token.
- New running claims always receive a cryptographically random token.

### Claim behavior

- A new slot is inserted atomically with `status=running`, `started_at`, and its claim token.
- A running slot older than or equal to 15 minutes may be reclaimed by one caller through a conditional atomic update that replaces `started_at` and `claim_token`.
- A younger running slot is not reclaimed and returns an explicit `in_progress` outcome.
- A completed or failed slot is not rerun and returns an explicit terminal outcome.
- Concurrent reclaim attempts are guarded by the previous token/start timestamp so exactly one caller wins.

### Ownership enforcement

- `completeSlot()` and `failSlot()` require the caller's claim token in their update predicate.
- A late worker whose token has been replaced cannot mark the slot complete or failed.
- Existing per-source claim tokens and revision guards continue to protect source writes. Slot ownership adds orchestration ownership; it does not replace source-level freshness checks.
- Losing slot ownership after work has begun returns a specific non-destructive lost-claim outcome rather than overwriting the winner's terminal state.

## API collection status

- `ensureCurrentSlotCollected()` returns a typed outcome instead of discarding whether the slot was collected, already terminal, or currently owned by another worker.
- A successful fresh collection or an already completed slot produces `collection.status = current`.
- A younger running slot produces:
  - `collection.status = stale` with cached releases and HTTP 200;
  - `collection.status = failed` with no cached releases and HTTP 503.
- Collection exceptions retain the existing stale/failed behavior and sanitized public message.
- No claim token, internal slot key, source diagnostic, or exception detail is exposed publicly.

## Error handling

- Failed reclaim compare-and-swap is treated as another caller winning; the caller re-reads the slot outcome and does not start duplicate work.
- A lost owner cannot execute a terminal slot transition.
- Migration absence or database errors fail closed through the existing cache/API error handling.
- Slot recovery never deletes release data.

## Tests

### Snapshot authority

- A connected legacy result with no completeness signal persists valid rows but preserves omitted cached channels.
- `authoritativeSnapshot: undefined` and `false` cannot delete stale channels in the production repository path.
- Only explicit `snapshotComplete: true`, zero malformed rows, and connected status can produce `authoritativeSnapshot: true`.
- Explicit authoritative non-empty cleanup still removes stale source channels without deleting catalog, saved, or history rows.
- Confirmed-empty deletion remains impossible without both explicit authority and adapter opt-in.

### Slot recovery

- A fresh running slot returns `in_progress` and cannot be reclaimed.
- A 15-minute-old running slot is reclaimed exactly once with a new token.
- The old owner cannot complete or fail a reclaimed slot.
- The new owner can complete it.
- Concurrent stale reclaims produce one winner.
- Completed and failed slots are not reclaimed.

### API status

- In-progress plus cache returns HTTP 200 and `stale`.
- In-progress plus empty cache returns HTTP 503 and `failed`.
- Already completed and freshly completed outcomes return `current`.
- No internal token or slot detail appears in the response.

### Verification

- Apply every migration to a disposable D1/SQLite database.
- Run focused repository, orchestration, API, and migration tests.
- Run the full test suite and production build before review and deployment.

## Deployment

- Request an independent scoped code review after implementation.
- Deploy the exact reviewed commit as a new private Sites version.
- Verify `/`, `/calendar`, owner `/admin`, identity-less 401 boundaries, release collection status, and production worker error logs.
- After this hardening deploys successfully, implement the separately approved monthly overseas-filter design.
