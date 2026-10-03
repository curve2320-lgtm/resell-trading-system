# Collaboration Release Upgrade — Local Review

Date: 2026-07-31

Reviewer: Task 13 local executor (self-review)

Scope: local code, migrations, tests, build, and Cloudflare-aware HTTP behavior only

## Task 5 pre-deploy addendum — collection cache and slot hardening

This is local evidence for Task 5 steps 1, 2, and the pre-deploy portion of
step 4 only. Earlier deployment/history statements in this document remain
historical facts and are not claims about the hardening range. No push, Sites
change, deployment, production request, live access check, or worker-log read
occurred for this addendum.

### Range and task-review outcome

The hardening implementation range awaiting independent scoped review is
`36ad1f1c366c969ee708e7f66dd3030786fb5320..9371d0f44da91bef5bf669f44ef3cbe8adbd1d7d`.
Task 5 documentation began at
`9371d0f44da91bef5bf669f44ef3cbe8adbd1d7d`. The mandatory independent Task 5
review is **pending**; this executor did not perform it and makes no production
approval claim.

Task-level reviewers recorded **APPROVE** for Task 1 (focused 58/58), Task 2
(schema 7/7 and additive migration), Task 3 (focused 47/47), and Task 4 (full
suite 212/212 and build). Those completed task reviews are not a substitute for
the outstanding range review.

### Fresh full local gate

| Command | Observed result |
| --- | --- |
| `npm test` | Exit `0`; 212/212 passed; 0 failed/cancelled/skipped/todo; `1335.8824 ms` |
| `npm run build` | Exit `0`; five Vinext stages: 489/70/535/199/295 ms; eight routes emitted |
| `git diff --check` | Exit `0`; no whitespace errors |
| Pre-documentation `git status --short` | Clean at `9371d0f44da91bef5bf669f44ef3cbe8adbd1d7d` on `feature/collaboration-release-upgrade` |

Build routes: `/`, `/admin`, `/calendar`, `/api/admin/collect`,
`/api/admin/reviews`, `/api/admin/reviews/:id`, `/api/releases`, and
`/api/saved-releases`.

### Disposable SQLite/D1 migration and ownership proof

With `PRAGMA foreign_keys = ON`, an independent in-memory SQLite/D1 adapter
applied `0000_talented_millenium_guard.sql`,
`0001_collaboration_release_cache.sql`, `0002_handy_wendigo.sql`, and
`0003_collection_slot_claim_token.sql`, in order. `PRAGMA table_info` showed
`collection_slots.claim_token` as nullable `TEXT`, non-key.

The production repository factory was exercised through
`createCollectionRepositoryWithDb(drizzle(sqliteD1, { schema }))`:

| Behavior | Observed result |
| --- | --- |
| New claim | owner A: `claimed`, token `owner-a`, `reclaimed: false` |
| Exact 15-minute boundary | owner B reclaimed at `01:15` with `staleBefore = 01:00`: `claimed`, token `owner-b`, `reclaimed: true` |
| Replaced-owner writes | owner A complete and fail both returned `false` |
| Terminal completion | owner B complete returned `true`; later claim returned `completed` |
| Terminal failure | current owner fail returned `true`; later complete returned `false`; later claim returned `failed` |
| FK integrity | `PRAGMA foreign_key_check`: 0 rows |

### Scope boundary and production status

Claude findings **V2, V3, and V5–V9 remain deferred** by design. This work
only records the V1/V4 hardening evidence and does not evaluate, modify, or
close those deferred findings.

All production fields for this hardening increment are **pending**:
reviewed SHA, private URL/access, Sites version, terminal deployment status,
route/access checks, same-slot collection/fanout observation, and worker-log
inspection. No live result is entered here.

## Task 5 post-deployment addendum — collection cache and slot hardening

This addendum replaces only the hardening increment's pending deployment fields
with the observed facts supplied by the controller. It does not alter the
historical deployment facts elsewhere in this review.

### Independent release gate

The final independent review covered
`36ad1f1c366c969ee708e7f66dd3030786fb5320..389d9af11fb6117840997bf0759581353c0843d0`
and returned **DEPLOY**: Critical `0`, Important `0`, Minor `2`.

The two Minor findings are coverage gaps only:

1. The legacy NULL-ownership test inserts NULL after `0003`, not as a
   pre-migration row.
2. Confirmed-empty omitted/`false` authority coverage is in-memory rather than
   D1-backed.

The reviewer freshly ran `npm test` (`212/212`), a build that emitted eight
routes, and `git diff --check` clean. No additional local review was performed
in this documentation update.

### Deployment and package evidence

| Field | Observed value |
| --- | --- |
| Exact source SHA | `389d9af11fb6117840997bf0759581353c0843d0` |
| Sites project | `appgprj_6a6024cfb5988191b0c9823944ebdcfe` |
| Version | `27` |
| Version ID | `appgprj_6a6024cfb5988191b0c9823944ebdcfe~appgver_a26538f759f88191bc3b3182eee510cb` |
| Deployment ID | `appgdep_6a6cb968f5948191a0264a26198c6ef5` |
| Terminal status / environment revision | `succeeded` / `3` |
| URL | `https://droplog-class-release.curve2320.chatgpt.site` |
| Access | Custom owner-only: 1 allowed user, 0 allowed groups |
| Secret configuration | `ADMIN_EMAILS` plus two source secrets configured; values not read or exposed |
| Archive | 39 files, 2,355,200 bytes; contained `dist/server/index.js`, `hosting.json`, and `0003` migration |

### Production observations

| Check | Observed result |
| --- | --- |
| Signed-in `/` | `200`; h1 `오늘·내일 발매, 빠르게 확인.`; today 22, tomorrow 1 |
| Signed-in `/calendar` | Monthly calendar; Jul 31=1, Aug 1=22; source-channel data loaded |
| Signed-in `/admin` | h1 `Release administration`; 15 source-health rows; pending reviews 66 |
| Anonymous no bypass | `/` 401; `/calendar` 401; `/api/admin/reviews` 401 |
| Dispatch bypass, no app identity | `/` 200; `/calendar` 200; `/admin` 307; `/api/admin/reviews` 401 JSON — app-level admin identity boundary observed |

Two sequential dispatch-bypass `/api/releases` reads were HTTP `200` with
`collection.status=stale`, message `Release collection is currently in
progress.`, 38 releases, and 16 source entries. Their source-health and release
SHA-256 hashes were identical, demonstrating no second source fanout. A later
read had the same stale/in-progress state; collection completion was not
observed or claimed.

### Worker-log interpretation

At `2026-07-31T15:05:58.993Z`, one `/api/releases` worker outcome was
`canceled` when browser navigation abandoned the request. Subsequent
`/api/releases` outcomes were `ok`. The canceled request is distinct from an
application error. One existing KREAM listing-fallback warning was present; no
application exception/error message was observed. Its canceled claim becomes
eligible for 15-minute reclaim at `2026-07-31T15:20:58.993Z`; post-threshold
behavior was not observed in this hardening deployment check and may be
rechecked after later work.

## Final-fix addendum — persistence, partial snapshots, and ASICS

This addendum records the final external-review verification performed after
commit `0eee50d`. Finding 4 (deployment incomplete) remains controller-owned and
was not implemented. No push, deployment, Sites mutation, production request,
or production log read occurred.

### F-1 — total persistence failure was hidden from the public API

Verified against `app/collection/run.ts`: every source persistence rejection
was settled and counted, the slot was marked failed, and `runCollection`
returned normally. `ensureCurrentSlotCollected` therefore resolved, allowing an
empty cache to be labelled `current` with HTTP 200.

Disposition:

- all source persistence attempts still settle, preserving per-source
  isolation;
- after the failed slot transition, an all-rejected persistence set rethrows
  the first persistence error;
- partial persistence success still completes and returns a summary;
- the existing release API boundary sanitizes the propagated error and returns
  stale cached data, or HTTP 503 when no cache is available.

### F-2 — malformed partial snapshots could prune omitted cached identities

Verified across `existing-adapters.ts`, `run.ts`, and `repository.ts`:
`malformedRows` stopped at the source wrapper, while every connected non-empty
result enabled stale-channel deletion. A valid parsed row plus a malformed
omitted row could therefore delete the omitted row's cached identity.

Disposition:

- source wrappers now mark snapshots with reported malformed rows as
  non-authoritative;
- that authority is carried through orchestration to persistence;
- non-authoritative snapshots may insert/update valid rows and health, but may
  not delete omitted cached channels or confirm an empty schedule;
- adapters without an incompleteness signal retain the established behavior.

### F-3 — current ASICS markup is supported, but live collection remains gated

Read-only official-source inspection on 2026-07-31 observed the rendered
calendar at `https://www.asics.co.kr/board/?id=spscalendar` using
`ul.sps_gallerylist > li.datalist`, `viewlink` attributes,
`.goods_sbt/.goods_sbj`, and official `/p/...` or `/raffleEvent/...` targets.
The parser now accepts that exact family in addition to the legacy fixture,
validates the ASICS HTTPS domain, extracts the first style code, and leaves rows
without an explicit date as undated review candidates.

The collector's direct read-only request still received a 3,804-byte
NetFUNNEL/bootstrap document with no calendar sentinel. The exact post-change
diagnostic returned:

```text
status: error
releases: 0
undated: 0
malformedRows: 0
message: ASICS Launch Calendar 구조 확인 실패
```

No browser cookies were copied, no consent/challenge control was accepted, and
no gate was bypassed. ASICS live collection is therefore still blocked and is
not claimed as connected; prior D1 cache remains protected.

### Final-fix TDD evidence

| Cycle | RED command and observed failure | Focused GREEN |
| --- | --- | --- |
| Persistence propagation and parser authority | `node --import tsx --test tests/run-collection.test.ts` — exit 1; 17 pass / 2 fail: missing total-persistence rejection and `authoritativeSnapshot` was `undefined` | exit 0; 19/19 pass |
| Conservative repository cleanup | `node --import tsx --test tests/collection-repository.test.ts` — exit 1; 34 pass / 1 fail: a stale `release_channels` delete was still planned | exit 0; 35/35 pass |
| Current ASICS markup | `node --import tsx --test tests/new-source-adapters.test.ts` — exit 1; 14 pass / 1 fail: expected one undated row, received zero | exit 0; 15/15 pass |

### Final-fix changed files

- Production: `app/asics.ts`, `app/collection/existing-adapters.ts`,
  `app/collection/registry.ts`, `app/collection/repository.ts`,
  `app/collection/run.ts`.
- Tests: `tests/new-source-adapters.test.ts`,
  `tests/collection-repository.test.ts`, `tests/run-collection.test.ts`.
- Handoff: this review and
  `docs/superpowers/reviews/2026-07-31-claude-handoff.md`.

The final-fix diff received a read-only self-review against the approved design,
Task 13 constraints, auth boundaries, and conservative cache semantics. A
separate reviewer-agent facility was unavailable in this single-implementer
session. No additional Critical or Important finding was identified.

Final-fix completion gate:

- `npm test`: exit 0; 186 tests, 186 pass, 0 fail/cancelled/skipped/todo;
  duration 1422.4454 ms.
- `npm run build`: exit 0; all five Vinext stages completed in 567, 92, 503,
  147, and 240 ms; expected eight routes emitted.
- `git diff --check`: exit 0 with no whitespace errors.
- Pre-commit scope: 10 intentional files; no migration or deployment file.

## Verdict

The three scoped Important findings have follow-up implementations and local regression evidence. Important-finding closure is intentionally withheld until the controller's independent whole-branch re-review.

This is not the controller's independent final review, a production approval, or a production verification claim. No branch push, Sites environment/access change, Sites version save, deployment, production request, or production worker-log inspection was performed.

## Authority and reviewed range

- Approved design: `docs/superpowers/specs/2026-07-31-collaboration-release-upgrade-design.md`
- Implementation plan: `docs/superpowers/plans/2026-07-31-collaboration-release-upgrade.md`
- SDD ledger: `.superpowers/sdd/2026-07-31-collaboration-release-upgrade/progress.md`
- Feature baseline: `3479ee95abf97e74f1fe69b4a7de80db7375b9b9`
- Task 13 starting base: `75f962e5152508dabe31c9fe21c58a117fb2fa81`
- Scoped-review follow-up base: `bf54cec9539abc0bbd90ef3288bbd546273ca105`
- Review input: baseline-to-current branch diff, Task 1–13 reports, the committed probe record, checked-in migrations, and current implementation/tests.

The approved plan and SDD ledger were read but not modified.

## Corrected stable-identity and peer-review design

1. `canonicalReleaseKey` remains persistent identity. A style uses `style:<normalized-style>` with no date suffix. The established title fallback remains `release:<brand>:<title>:<date>`.
2. Date remains an internal grouping discriminator, not a persistent catalog identity component. Source schedule corrections update the same catalog row and release ID.
3. Current-result conflicts are detected from raw classified releases before grouping. Comparison is by stable identity and release stage:
   - different dates across distinct sources conflict;
   - the same date with two non-null, different times conflicts;
   - null versus known time does not conflict;
   - same-source duplicates do not create a cross-source conflict;
   - raffle versus online/general and offline versus online are excluded.
4. Each conflicting source/external identity receives a source-scoped `conflicting_schedule` payload. Public release-channel DTOs still omit `externalId`.
5. Before accepted source writes are planned, the production repository reads preserved channels for matching stable catalog keys. Incoming-versus-cached conflicts suppress the incoming schedule write and create/supersede reviews for both source/external identities.
6. Peer-review supersession, review insertion, accepted writes, cleanup, and current-source health are one guarded D1 batch. Peer source health is not updated. Cross-source peer groups are not passed to source cleanup.
7. Review edits preserve the payload's canonical key. Date/time edits therefore cannot re-key the catalog, saved-release FK, channel FK, or history FK.
8. Pending peer-review freshness is independent: an older incoming source result cannot supersede a newer peer review.

## Requirements evidence

| Requirement area | Local evidence | Disposition |
| --- | --- | --- |
| Five Seoul refresh slots | `COLLECTION_SLOTS`; slot tests; final disposable D1 completed one `2026-07-31@18:00` slot | Verified locally |
| No per-user external fanout | Two final `/api/releases` requests; second source-stderr delta `0`; one D1 slot/revision | Verified locally |
| Preserve last good cache | Repository tests for failures, unconfirmed empty results, stale revisions, conflict suppression, and peer-channel preservation | Verified locally |
| Stable catalog identity | Real SQLite tests seed existing style catalog/channel/save/history rows, correct schedules, edit reviews, and run `PRAGMA foreign_key_check` | Verified locally |
| Exact conflict review | Raw-current, source/external breakdown, stage-negative, cached-peer, retry, and freshness tests | Follow-up implemented; controller re-review pending |
| Salomon, ASICS, TUNE | Parser/registry tests and final API source keys | Verified locally; ASICS remained conservatively `error` |
| Saved releases | Ownership, idempotence, CSRF, shared-controller, and auth invalidation tests; anonymous local methods returned `401` | Verified locally |
| Exception-only admin | Auth, DTO, transition, race, SSR, and no-store tests; anonymous local methods returned `401` | Verified locally |
| Second-wave sources disabled | Probe tests/record; no Kith/EQL/On The Spot registry entries | Verified |
| Migrations | Disposable local D1 applied `0000`, `0001`, and `0002`; SQLite tests enable foreign keys | Verified locally |

## Scoped Important findings and dispositions

### I-1 — Date-qualified persistent style keys broke catalog identity

Prior behavior emitted `style:<sku>:<date>` from `ReleaseGroup.canonicalKey`. Repository writes and review edits could then change the unique catalog key when a schedule changed.

Local disposition:

- restored stable style canonical keys while retaining date-only grouping;
- review edits no longer recompute canonical identity;
- added real SQLite schedule-change and review-edit tests with existing catalog, channel, saved, and history FKs;
- asserted stable catalog ID/key plus an empty `PRAGMA foreign_key_check`.

Status: implemented and locally verified; independent re-review pending.

### I-2 — Grouped results could lose exact raw conflict evidence

Prior reconciliation operated on per-source groups. A local `possible_duplicate` group could hide a raw classified release from global conflict comparison, same-time groups were not source-scoped, and stage differences were not excluded.

Local disposition:

- conflict pairs are evaluated on raw classified releases;
- `runCollection` carries raw classified rows separately from classification-only reviews;
- conflict payloads are partitioned by source/external identity;
- exact null-time, same-source, raffle/general, and offline/online negative tests were added.

Status: implemented and locally verified; independent re-review pending.

### I-3 — Preserved cached channels were absent from conflict decisions

Prior repository persistence compared no incoming schedule against cached peer channels. A stale B channel and conflicting incoming A schedule could therefore publish A or silently change the aggregate schedule.

Local disposition:

- repository reads matching cached channels before planning accepted writes;
- conflicting incoming identities are withheld from catalog/channel writes;
- current and peer reviews are superseded/inserted in the same source-claim-guarded batch;
- peer health and peer channels remain untouched;
- result cleanup uses only the current source's actual groups/external IDs;
- retries remain exactly one pending review per source/external identity;
- peer `createdAt` prevents an older incoming claim from replacing a newer peer review;
- a real `runCollection → CollectionRepository → SQLite/D1 adapter` test covers simultaneous date conflict, retry, time conflict, stale peer conflict, and source-scoped review resolution.

Status: implemented and locally verified; independent re-review pending.

## Exact TDD RED evidence

| Cycle | Exact command | Observed failure before production change |
| --- | --- | --- |
| Stable style identity | `node --import tsx --test tests/dedupe-releases.test.ts` | Exit `1`; 10 pass / 2 fail. Actual keys were `style:dd1399100:2026-08-01` and `:2026-08-02`; expected stable `style:dd1399100`. |
| Raw conflict/stage semantics | `node --import tsx --test tests/dedupe-releases.test.ts` | Exit `1`; 12 pass / 2 fail. Same-date different-time rows collapsed into one two-channel group; general/raffle/offline rows were all incorrectly marked `conflicting_schedule`. |
| Review edit identity | `node --import tsx --test tests/collection-repository.test.ts` | Exit `1`; 30 pass / 1 fail. Title-fallback key changed from `release:nike:air-example:2026-08-01` to `...:2026-08-02`. |
| Cached peer path | `node --import tsx --test tests/collection-repository.test.ts` | Exit `1`; 31 pass / 1 fail. Outcome was `reviewItemsCreated: 0`; expected two source-scoped reviews. |
| Raw run reconciliation | `node --import tsx --test tests/run-collection.test.ts` | Exit `1`; 17 pass / 1 fail. Alpha stayed `possible_duplicate` and Beta stayed accepted instead of both exact identities becoming `conflicting_schedule`. |
| Peer-review freshness | `node --import tsx --test tests/collection-repository.test.ts` | Exit `1`; 33 pass / 1 fail. Older A created two reviews and replaced newer B; expected only A's one new review while B remained untouched. |

After the stable-key implementation, two earlier run-test expectations also failed because they still expected date-qualified keys (15 pass / 2 fail); only those obsolete expectations were corrected.

Focused final evidence before the full gate:

- Dedupe: `14/14`.
- Orchestration: `18/18`.
- Production repository, including integration: `34/34`.
- Combined affected suites before the final documentation gate: `66/66`.

## Changed-file summary by subsystem

The full baseline-to-handoff range remains 68 files: 66 implementation/tooling files and these two review documents. This scoped follow-up changes six existing source/test files and both existing review documents; it adds no migration or production configuration file.

| Subsystem | Files | Summary |
| --- | --- | --- |
| Collection core (11) | `app/collection/{types,slots,normalize,classify,dedupe,repository,registry,existing-adapters,run,tune-enrichment,release-api}.ts` | Model, slots, classification, stable grouping, raw conflict detection, guarded D1 persistence, cached-peer review, orchestration, and public DTOs |
| Official sources (4) | `app/{salomon,asics,tune,source-flags}.ts` | New source parsers/wrappers and registry flags |
| Public API/UI (6) | `/api/releases`, board/filter/badge/link modules, CSS | Cache-first API, discovery views, retailer channels, safe links, responsive styling |
| Saved releases (4) | Saved API/repository/controller/button | Authenticated ownership and shared optimistic state |
| Admin/security/worker (11) | Admin modules/routes, request origin, worker | ADMIN_EMAILS, strict APIs, review UI, CSRF, and no-store boundaries |
| D1 schema/migrations (6) | `db/schema.ts`, `0001`, `0002`, snapshots/journal | Additive cache/review schema and claim metadata |
| Tests/fixtures (20) | `tests/*` | Full suite plus stable-ID, raw conflict, cached-peer, freshness, and real SQLite integration coverage |
| Tooling/probe record (4) | Package files, probe script, committed probe record | Test harness and read-only second-wave evidence |
| Task 13 documents (2) | This review and Claude handoff | Corrected local evidence and controller verification package |

## Database migration review

| Migration | Status | Local evidence | Safety assessment |
| --- | --- | --- | --- |
| `0000_talented_millenium_guard.sql` | Baseline | Applied to disposable D1 | Existing manual `releases` table |
| `0001_collaboration_release_cache.sql` | Added earlier | Applied successfully | Additive tables/indexes/FKs; no destructive DDL |
| `0002_handy_wendigo.sql` | Added earlier | Applied successfully | Nullable revision/claim columns only |

No migration changed in this follow-up. No remote migration ran.

## Final branch-wide verification

- `npm test`: exit `0`; `183` tests, `183` pass, `0` fail/cancelled/skipped/todo; duration `1343.6298 ms`.
- `npm run build`: exit `0`; all five Vinext stages completed in `632`, `100`, `493`, `160`, and `246` ms.
- Emitted routes: `/`, `/calendar`, `/admin`, `/api/releases`, `/api/saved-releases`, `/api/admin/collect`, `/api/admin/reviews`, `/api/admin/reviews/:id`.
- `git diff --check`: final pre-commit result recorded in the Task 13 report.
- `git status --short`: final pre-commit result recorded in the Task 13 report.

## Fresh Cloudflare-aware local HTTP evidence

All three checked-in migrations were applied to a new disposable local D1. The Cloudflare Vite plugin used only that directory.

| Check | Result |
| --- | --- |
| `GET /` | `200`; 20,665 bytes; 964 ms |
| `GET /calendar` | `200`; 33,865 bytes; 55 ms |
| First `GET /api/releases` | `200`; 47,719 bytes; 3,807 ms; `private, max-age=60`; 46 releases; 56 channels; 68 pending reviews |
| Second same-slot `GET /api/releases` | `200`; 47,719 bytes; 36 ms; identical counts and collection shape |
| Fanout proof | Source stderr bytes `0 → 341 → 341`; second-request delta `0` |
| D1 proof | One completed `2026-07-31@18:00` slot; 15 source rows; one revision `2026-07-31T09:19:14.369Z`; 46 catalog / 56 channel / 68 pending-review rows |

Inspected payload shape:

- Top-level keys: `collection`, `releases`, `reviewCount`, `sources`.
- Public channel keys: `sourceKey`, `retailer`, `productUrl`, `sourceUrl`, `priceLabel`, `releaseDate`, `releaseTime`; `externalId` is not exposed.
- Source-health keys: `status`, `count`, `message`, `sourceUrl`; Nike may add `undated`.
- Source map: `adidas`, `asics`, `converse`, `database`, `fila`, `grandstage`, `kasina`, `kream`, `musinsa`, `newBalance`, `nike`, `salomon`, `shoeprize`, `soldout`, `tune`, `worksout`.
- Final local statuses: Salomon `connected`, ASICS `error`, TUNE `connected`; collection `current`.

Anonymous saved GET/POST/DELETE and admin review GET/collect POST/review PATCH all returned `401` with `private, no-store`.

The server was stopped and port `4184` was closed. Policy blocked recursive deletion of the validated disposable directory:

`C:\Users\1\AppData\Local\Temp\release-calendar-task13-followup-a35963175b9641eb8cd5bf159076f8eb`

It is isolated local D1 state and contains no credentials.

## Minor / deferred observations

| ID | Area | Disposition |
| --- | --- | --- |
| M-1 | Schema-contract tests do not assert every DDL invariant | Critical identity/FK paths now run against migrated SQLite with foreign keys enabled. |
| M-2 | TUNE enriched rows can retain stale undated note/category provenance | Deferred; no date is inferred without confirmed style evidence. |
| M-3 | Same-tab authenticated-account replacement relies on remount or API `401` | Deferred; server ownership remains authenticated-email scoped. |
| M-4 | A crashed running slot has no reclaim owner token | Accepted design limitation; later slot keys remain claimable. |
| M-5 | ASICS live local structure sentinel was absent | Conservative `error`; prior cache is preserved. |
| M-6 | Leading `db/schema.ts` comment describes older request-time behavior | Documentation-only cleanup deferred. |

## Known limitations

- Lazy five-slot refresh: the first `/api/releases` request in each Seoul slot claims collection; no traffic means no collection.
- SNS deferred: Instagram and other SNS collection are not implemented.
- No alerts: push, email, and Kakao notifications are not implemented.
- No resale pricing: KREAM market-price and expected-profit collection/calculation are not implemented.

## Production handoff

Controller production verification completed for `a3bd236d07c45bbba6457400163087d8833f5982` as private Sites version 26 at `https://droplog-class-release.curve2320.chatgpt.site`. Deployment reached `succeeded`. The production `/`, `/calendar`, and owner `/admin` surfaces loaded; identity-less `/`, `/api/releases`, and `/api/admin/reviews` returned `401`. `ADMIN_EMAILS` was present as a production secret. Worker-log inspection found no application exception or failed invocation; the only error-filtered event was an expected `/favicon.ico` 404 with worker outcome `ok`.

## Scoped re-review follow-up

The scoped re-review found one remaining ASICS partial-snapshot path: a recognized gallery candidate without a product target was skipped without increasing `malformedRows`. A focused regression failed with `0 !== 1`; the parser now counts recognized `datalist`, `goods_sbj`, and `goods_sbt` candidates without product targets as malformed so the adapter withholds stale-cache cleanup authority. The focused suite passed `16/16`, the full suite passed `187/187`, and the production build completed successfully.

## Monthly overseas filter — pre-deployment addendum (2026-08-01)

The following is limited to pre-deployment evidence for
`8d8784d65b21571f2ae6b69d02512265ca9166f2`; it does not alter the prior
hardening deployment record in this document (including its historical Sites
version, URL, production checks, and worker-log observations).

### Task evidence and dispositions

| Task | Exact RED evidence | Final GREEN / disposition |
| --- | --- | --- |
| 1 | `npx tsc --noEmit` exit `1`: expected `TS2353` fixture metadata gaps at lines `98,103,108,114,122`; market-helper focused test `21/2` failed because the helper was undefined; selected-day test `10/1` failed because its helper was undefined. | Classifier `9/9`, helper `23/23`, then focused `24/24`. One fixture-encoding/category-literal review correction was needed: `npx tsc --noEmit` first had exactly two introduced `TS2322` diagnostics at lines `155` and `200`; afterward those were absent and focused tests were `24/24`. Reviewer: **APPROVE**. |
| 2 | Control test `23/1` failed because the monthly semantic overseas button lacked `aria-pressed="true"`; selected-day empty-copy test `24/1` failed because `selectedDayEmptyCopy` was undefined. The first board build also found `Unexpected token` at `app/release-board.tsx:1100`. | Focused tests `25/25`; full `npm test` `217/217`; `npm run build` passed after the delimiter correction. Reviewer: **APPROVE**. |

Committed implementation scope:

- `3cb010127c815b2cf68729f7dc4d2fb65e10df0f` — `feat: compose overseas release filters`
- `3071f06efa5fd24db1f5f6686f8f978b9a5e689f` — `fix: use valid raffle fixture category`
- `8d8784d65b21571f2ae6b69d02512265ca9166f2` — `feat: add monthly overseas filter`
- Changed production/test files: `app/release-filters.tsx`,
  `app/release-board.tsx`, `tests/release-view-model.test.ts`, and
  `tests/saved-releases.test.ts`.

### Fresh local release gate

At the Task 3 pre-deployment checkpoint:

- `npm test` exited `0`: `217/217` pass, `0` fail/cancelled/skipped/todo,
  `1440.7295 ms`.
- `npm run build` exited `0`: all five Vinext stages completed and emitted `/`,
  `/admin`, `/api/admin/collect`, `/api/admin/reviews`,
  `/api/admin/reviews/:id`, `/api/releases`, `/api/saved-releases`, and
  `/calendar`.
- `git diff --check` exited `0` with no output; `git status --short` was empty
  before these documentation changes.

### Pending fields (intentionally blank)

Independent broad review; release verdict; push; Sites credentials and source
packaging; private deployment; URL; deployed SHA; Sites version; terminal
status; signed-in monthly-calendar interaction; overseas `aria-pressed` state;
composed filters; selected-day tab hiding/restoration; empty copy; anonymous
`401` recheck; and worker-log observations are all pending controller work.
No deployment, production request, or live browser interaction occurred for
this addendum.

## Monthly overseas filter — final deployment record (2026-08-01)

The immediately preceding “pending” fields are historical pre-deployment
state. This final record closes Task 3 without changing the preceding
collection-hardening deployment history.

### Review and source verification

- Final deployed commit: `0c58db5884fa4be5e4825c0eb6a3e8aa7da56f5e`
  (`0c58db5 fix: address overseas filter review findings`).
- Re-review: Critical `0`, Important `0`, Minor `0`; verdict **DEPLOY**.
- Final code-commit gate: `npm test` `219/219` (`1293.6495 ms`); build
  succeeded with all eight routes; `git diff --check` was clean; worktree was
  clean before documentation.

### Deployment record

| Field | Value |
| --- | --- |
| Sites project | `appgprj_6a6024cfb5988191b0c9823944ebdcfe` |
| Version | `28`; `appgprj_6a6024cfb5988191b0c9823944ebdcfe~appgver_e6ad8f7b49d4819197e5e8a021258945` |
| Deployment | `appgdep_6a6cc9faf740819186d5e32ac40523b2`; `succeeded`; environment revision `3` |
| URL | `https://droplog-class-release.curve2320.chatgpt.site` |
| Archive | `tar`, `39` files, `2,355,200` bytes, `sha256:3df02ebc43b797c39a6132a2fefcb191d16250f74b82ba1799b99b5573f8c65b` |
| Access | Custom/owner-only; `1` allowed user; `0` groups |

### Production checks

- Anonymous `/`, `/calendar`, and `/api/admin/reviews`: `401`.
- Dispatch-bypass `/` and `/calendar`: `200`; `/admin`: `307` to sign-in;
  `/api/admin/reviews`: `401` JSON.
- Owner `/admin`: **Release administration** loaded with `16` source-health
  entries and `66` pending exceptions.
- The overseas control is monthly-calendar-only, defaults off, resets on
  remount, composes with category filters, and is absent from home discovery.
  Because current live data has no overseas releases, all `42` calendar cells
  show an explicit `0` count while active. Its selected-day empty state has no
  orphan tabpanel semantics; turning it off restores the expected raffle card
  and valid tab/tabpanel linkage.

### Post-stale-boundary API and worker evidence

While slot `2026-07-31@22:30` was younger than fifteen minutes, final-version
`/api/releases` calls returned `200`, `stale`, `Release collection is currently
in progress.`, `38` cached releases, `16` source keys, and `66` reviews. The
browser-navigation owner was canceled at `2026-07-31T16:15:46.806Z`.

At `2026-07-31T16:31:31.606Z`, after the exact boundary, sustained
`GET /api/releases` reclaimed the slot and completed in `9,121 ms`: `200`,
`private, max-age=60`, `current`, null message, `41` releases, `16` sources,
`81` reviews, and `14` connected / `2` error sources. The same-slot request at
`2026-07-31T16:31:34.628Z` completed in `1,965 ms` with identical hashes:
`d4f0f2c0317a289f2af95b4760dac801c2c0fde118573eeeeab78ee3a3386328`
(releases) and
`60edb1bba8f6460ae8d145c84e0cc2081533c0b8f2b9567936eb749fdfabb39e`
(sources). `adidas` and `kream` remained conservative errors; KREAM reported
upstream HTTP `520`, while cached/site data remained available.

The ten-minute post-reclaim error-filtered worker-log query returned `0`
events. The broader 25-minute query contained only the earlier canceled
browser-navigation GET (`info`, no error, `1,316 ms`) plus OK admin API and
favicon events. It is distinct from the later successful reclaim/current API
evidence. No application exception or failed invocation was observed.

SNS collection remains intentionally deferred.
