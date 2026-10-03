# Claude Verification Handoff — Collaboration Release Upgrade

Date: 2026-07-31

## Task 5 pre-deploy addendum — collection cache and slot hardening

Date: 2026-07-31. This addendum records only Task 5 steps 1, 2, and the
pre-deploy documentation portion of step 4 for the separately approved
collection-cache/slot-hardening plan. It preserves the earlier deployment and
history facts below; none is evidence of a deployment of this hardening range.
No push, Sites mutation, production request, live access check, or worker-log
read was performed for this addendum.

### Hardening range and review status

- Hardening implementation range awaiting independent scoped review:
  `36ad1f1c366c969ee708e7f66dd3030786fb5320..9371d0f44da91bef5bf669f44ef3cbe8adbd1d7d`.
- Task 5 documentation started from `9371d0f44da91bef5bf669f44ef3cbe8adbd1d7d`.
- Independent Task 5 review is **pending**. This local executor did not perform
  the required broad review and makes no deploy/approval verdict.
- Completed task-review outcomes: Task 1 reviewer **APPROVE** (focused 58/58);
  Task 2 reviewer **APPROVE** (schema 7/7, additive migration); Task 3 reviewer
  **APPROVE** (focused 47/47); Task 4 reviewer **APPROVE** (full suite 212/212
  and build). These outcomes do not replace the pending independent range review.

### Fresh local verification

- `npm test`: exit `0`; `212` tests passed, `0` failed/cancelled/skipped/todo;
  duration `1335.8824 ms`.
- `npm run build`: exit `0`; Vinext completed all five stages in `489`, `70`,
  `535`, `199`, and `295 ms`. It emitted the eight established routes: `/`,
  `/admin`, `/calendar`, `/api/admin/collect`, `/api/admin/reviews`,
  `/api/admin/reviews/:id`, `/api/releases`, and `/api/saved-releases`.
- `git diff --check`: exit `0`, with no whitespace errors.
- Pre-documentation `git status --short`: clean; branch
  `feature/collaboration-release-upgrade` at
  `9371d0f44da91bef5bf669f44ef3cbe8adbd1d7d`.

### Independent disposable SQLite/D1 migration exercise

An in-memory SQLite database with `PRAGMA foreign_keys = ON` applied, in order:
`0000_talented_millenium_guard.sql`, `0001_collaboration_release_cache.sql`,
`0002_handy_wendigo.sql`, and `0003_collection_slot_claim_token.sql`.

`PRAGMA table_info(collection_slots)` reported nullable non-key
`claim_token TEXT` after `slot_key`, `status`, `started_at`, and `completed_at`.
Through `createCollectionRepositoryWithDb(drizzle(sqliteD1, { schema }))`:

- owner A created a running slot with `{ state: "claimed", claimToken:
  "owner-a", reclaimed: false }`;
- owner B reclaimed that same row at exactly 15 minutes (`started_at` and
  `staleBefore` both `2026-07-31T01:00:00.000Z`) with `{ state: "claimed",
  claimToken: "owner-b", reclaimed: true }`;
- old owner A's `completeSlot` and `failSlot` both returned `false`; current
  owner B's completion returned `true`;
- later claim returned `{ state: "completed" }`; a separate current-owner
  failure returned `true`, a later completion returned `false`, and later claim
  returned `{ state: "failed" }`;
- `PRAGMA foreign_key_check` returned `0` rows.

### Deferred Claude findings

Only V1 and V4 are in the hardening plan's scope. Claude findings **V2, V3,
and V5–V9 remain deferred** and were not evaluated, changed, or closed by this
Task 5 pre-deploy work.

### New hardening production fields — pending

| Field | Status |
| --- | --- |
| Reviewed hardening SHA | Pending independent scoped review |
| Production URL / private access | Pending; no new production request made |
| Sites version / deployment terminal status | Pending; no Sites version saved or deployed |
| `/`, `/calendar`, and owner `/admin` checks | Pending live verification |
| Identity-less `/`, `/api/releases`, `/api/admin/reviews` boundaries | Pending live verification |
| Same-slot collection/fanout observation | Pending live verification |
| Production worker-log observation | Pending live verification |

## Task 5 post-deployment addendum — collection cache and slot hardening

This addendum supersedes the hardening increment's pending review/deployment
fields above. It records the controller-supplied observed facts only; earlier
deployment/history entries remain preserved.

### Final independent review and release gate

- Final independent review range:
  `36ad1f1c366c969ee708e7f66dd3030786fb5320..389d9af11fb6117840997bf0759581353c0843d0`.
- Verdict: **DEPLOY** — Critical `0`, Important `0`, Minor `2` (coverage gaps
  only):
  1. The legacy NULL-ownership test inserts NULL after migration `0003`, rather
     than proving a pre-migration row.
  2. Confirmed-empty omitted/`false` authority coverage is in-memory rather than
     D1-backed.
- The independent reviewer freshly observed `npm test` at `212/212`, a build
  with eight routes, and a clean diff check.

### Private deployment record

| Field | Observed value |
| --- | --- |
| Deployed source SHA | `389d9af11fb6117840997bf0759581353c0843d0` |
| Sites project | `appgprj_6a6024cfb5988191b0c9823944ebdcfe` |
| Version / version ID | `27` / `appgprj_6a6024cfb5988191b0c9823944ebdcfe~appgver_a26538f759f88191bc3b3182eee510cb` |
| Deployment ID / terminal status | `appgdep_6a6cb968f5948191a0264a26198c6ef5` / `succeeded` |
| Environment revision | `3` |
| URL | `https://droplog-class-release.curve2320.chatgpt.site` |
| Access | Custom owner-only; 1 allowed user, 0 allowed groups |
| Configured secrets | `ADMIN_EMAILS` and two source secrets configured; values were not read or exposed |
| Packaged archive | 39 files, 2,355,200 bytes; included `dist/server/index.js`, `hosting.json`, and migration `0003` |

### Observed production UI and identity boundaries

- Signed-in `/`: HTTP `200`; h1 `오늘·내일 발매, 빠르게 확인.`; today `22`, tomorrow `1`.
- Signed-in `/calendar`: monthly calendar loaded with Jul 31=`1`, Aug 1=`22`,
  and source-channel data.
- Signed-in `/admin`: h1 `Release administration`; 15 source-health rows and
  pending-review count `66`.
- Anonymous without bypass: `/` `401`, `/calendar` `401`, and
  `/api/admin/reviews` `401`.
- With Sites dispatch bypass but no app identity: `/` `200`, `/calendar` `200`,
  `/admin` `307`, and `/api/admin/reviews` `401` JSON. This demonstrates the
  app-level admin identity boundary for the admin route/API.

### Collection-state and worker-log observations

Two sequential dispatch-bypass `/api/releases` reads returned HTTP `200` with
`collection.status = stale`, message `Release collection is currently in
progress.`, `38` releases, and `16` source entries. Source-health and release
SHA-256 hashes were identical between the reads, demonstrating no second source
fanout. A later read observed the same stale/in-progress state. No completion
claim is made.

Worker logs recorded one `/api/releases` outcome as `canceled` at
`2026-07-31T15:05:58.993Z` because browser navigation abandoned that request;
subsequent `/api/releases` requests had worker outcome `ok`. This canceled
request is not recorded as an application error. One existing KREAM
listing-fallback warning was present; no application exception/error message
was observed. The canceled claim becomes eligible for 15-minute reclaim at
`2026-07-31T15:20:58.993Z`; no post-threshold observation is part of this
hardening deployment check and it may be rechecked after later work.

## Required references

- Approved design: `docs/superpowers/specs/2026-07-31-collaboration-release-upgrade-design.md`
- Implementation plan: `docs/superpowers/plans/2026-07-31-collaboration-release-upgrade.md`
- Local review: `docs/superpowers/reviews/2026-07-31-collaboration-release-upgrade-review.md`
- SDD ledger: `.superpowers/sdd/2026-07-31-collaboration-release-upgrade/progress.md`
- Committed probe: `docs/source-probes/2026-07-31-kith-eql-onthespot.md`
- Feature baseline: `3479ee95abf97e74f1fe69b4a7de80db7375b9b9`
- Task 13 starting base: `75f962e5152508dabe31c9fe21c58a117fb2fa81`
- Scoped-review follow-up base: `bf54cec9539abc0bbd90ef3288bbd546273ca105`

The plan was not modified. The controller updated the SDD ledger after final review and production verification.

## Final-fix handoff addendum

Final-fix base: `0eee50d`.

Three new external findings were verified against the implementation before
changes. Deployment finding 4 was left entirely controller-owned. No push or
deployment occurred.

1. Total source persistence failure now propagates after all writes settle and
   the slot is marked failed. This prevents `ensureCurrentSlotCollected` from
   making an empty cache appear `current`/200. Partial persistence success
   remains isolated and usable.
2. Parser completeness now crosses the adapter/orchestrator/repository
   boundary as `authoritativeSnapshot`. A connected result with
   `malformedRows > 0` can persist valid rows but cannot prune omitted cached
   identities or confirm empty deletion.
3. The ASICS parser now supports the current observed official
   `sps_gallerylist`/`datalist`/`viewlink` markup and `/p/` plus `/raffleEvent/`
   official targets. Rows without explicit dates remain review-only.

Exact RED evidence:

- `node --import tsx --test tests/run-collection.test.ts`: exit 1, 17/19 pass;
  missing total-persistence rejection and missing snapshot-authority signal.
- `node --import tsx --test tests/collection-repository.test.ts`: exit 1,
  34/35 pass; stale-channel deletion remained present for a partial snapshot.
- `node --import tsx --test tests/new-source-adapters.test.ts`: exit 1,
  14/15 pass; current official ASICS markup parsed zero rows.

Focused GREEN evidence:

- orchestration `19/19`;
- production repository `35/35`;
- source adapters `15/15`.

Read-only ASICS evidence:

- a normal browser rendered the official page with the current gallery and
  product-target markup;
- the collector's direct request received a 3,804-byte NetFUNNEL/bootstrap
  document without the calendar sentinel;
- the post-change live collector diagnostic remained conservative:
  `status=error`, `releases=0`, `undated=0`, `malformedRows=0`, message
  `ASICS Launch Calendar 구조 확인 실패`.

No challenge/consent control was bypassed and no authenticated/browser state
was copied into the collector. Reliable live ASICS server-side collection is an
unresolved external blocker; do not treat parser fixture GREEN as live-source
success. Last successful D1 cache remains preserved.

Final-fix files are the five production modules, three focused test files, and
the two Task 13 review/handoff documents listed in the local review addendum.
The focused diff received a read-only self-review; a separate reviewer-agent
facility was unavailable in this single-implementer session.

Fresh final-fix completion gate before commit:

- `npm test`: exit 0; 186/186 passed, no failures, duration 1422.4454 ms.
- `npm run build`: exit 0; five stages completed in 567/92/503/147/240 ms;
  all expected application and API routes emitted.
- `git diff --check`: exit 0, no whitespace errors.
- Pre-commit diff: 10 intentional files; no migration or deployment file.

## Controller-owned production fields

| Field | Value |
| --- | --- |
| Production URL | `https://droplog-class-release.curve2320.chatgpt.site` |
| Deployed commit SHA | `a3bd236d07c45bbba6457400163087d8833f5982` |
| Sites version | `26` |
| Terminal deployment status | `succeeded` |
| Private access confirmed | Yes — identity-less requests to `/`, `/api/releases`, and `/api/admin/reviews` returned `401` |

The local implementer performed no remote action. The controller pushed the reviewed SHA, saved version 26, deployed it privately, and completed the checks below.

## Re-review status

The three scoped Important findings have tested follow-up implementations. This handoff does not declare them closed; Claude/controller must independently re-review the final committed range.

## Stable-identity and peer-review contract

- Style catalog identity is permanently `style:<normalized-style>`; no date suffix is persisted.
- Title fallback retains its established `release:<brand>:<title>:<date>` identity.
- Schedule correction updates one catalog ID and records field changes. It does not replace the catalog row or orphan channels, saves, or history.
- Review edits preserve the review payload's canonical key.
- Raw classified releases are compared before grouping:
  - different dates from distinct sources conflict;
  - same date plus two non-null different times conflicts;
  - null versus known time does not;
  - same-source duplicates do not;
  - raffle versus online/general and offline versus online do not.
- Conflict reviews are source/external scoped.
- Repository persistence compares accepted incoming rows against preserved cached channels for the same stable key.
- Incoming cached-peer conflicts create/supersede both peer reviews in the incoming source's guarded D1 batch while suppressing the incoming schedule write.
- Peer channels and health are not mutated; cleanup remains current-source scoped.
- A newer peer review cannot be superseded by an older incoming result.
- Repeated collection leaves exactly one pending conflict review per source/external identity.
- Public channel DTOs do not expose `externalId`.

## Exact RED commands and failure summaries

```powershell
node --import tsx --test tests/dedupe-releases.test.ts
```

- Stable-key cycle: exit `1`, 10 pass / 2 fail; actual style keys contained dates.
- Raw semantics cycle: exit `1`, 12 pass / 2 fail; time conflicts collapsed into one group and stage-different releases were incorrectly conflicted.

```powershell
node --import tsx --test tests/collection-repository.test.ts
```

- Review-edit cycle: exit `1`, 30 pass / 1 fail; title fallback re-keyed from the old date to the edited date.
- Cached-peer cycle: exit `1`, 31 pass / 1 fail; `reviewItemsCreated` was `0`, expected `2`.
- Peer-freshness cycle: exit `1`, 33 pass / 1 fail; older A replaced newer B and created two rows, expected only A's one new row.

```powershell
node --import tsx --test tests/run-collection.test.ts
```

- Raw reconciliation cycle: exit `1`, 17 pass / 1 fail; Alpha remained `possible_duplicate` and Beta remained accepted instead of both exact identities becoming `conflicting_schedule`.

Focused final results:

- Dedupe `14/14`.
- Orchestration `18/18`.
- Production repository/integration `34/34`.
- Combined affected suites `66/66`.

## Real SQLite/D1 integration proof

One production-path test invokes:

`runCollection → createCollectionRepositoryWithDb → drizzle(d1 adapter) → migrated in-memory SQLite`

Foreign keys are enabled. It proves:

1. simultaneous two-source date conflict creates exactly two pending reviews with exact reason/source/external/payload identity;
2. no conflicting catalog/channel write leaks;
3. retry supersedes old rows and remains exactly two pending;
4. same-date/different-time conflict creates two source-scoped reviews;
5. cached B versus incoming A creates both reviews while B channel/health stay unchanged;
6. approving/editing source-scoped payloads yields one stable catalog key/ID and predictable channels/history/save FKs;
7. `PRAGMA foreign_key_check` is empty.

Separate real SQLite tests seed existing `style:<sku>` catalog, channel, saved, and history rows and prove schedule collection/edit retains all IDs/FKs.

## Changed-file summary

The full handoff range is still 68 files: 66 implementation/tooling files plus two Task 13 review documents.

This follow-up changes:

- `app/collection/dedupe.ts` — raw pair semantics, stage exclusions, stable canonical output, source-scoped conflict groups.
- `app/collection/run.ts` — carries raw classified releases separately into global reconciliation.
- `app/collection/repository.ts` — cached-peer planning, guarded review writes, peer freshness, stable review edits.
- `tests/dedupe-releases.test.ts` — exact positive/negative identity breakdown.
- `tests/run-collection.test.ts` — source/external and raw-before-local-grouping assertions.
- `tests/collection-repository.test.ts` — FK identity, cached peer, retry/freshness, and production-path integration.
- Both Task 13 review documents.

Subsystem inventory for the whole feature:

| Subsystem | Scope |
| --- | --- |
| Collection core | 11 modules: model, slots, normalization/classification, dedupe, registry/adapters, run, repository, enrichment, API DTO |
| Official sources | Salomon, ASICS, TUNE, source flags |
| Public API/UI | Cache route, board, filters, badges, retailer channels, safe links, responsive CSS |
| Saved releases | Authenticated API/repository/controller/button |
| Admin/security | Allowlist auth, strict APIs, review dashboard, CSRF, worker no-store |
| Database | Cache/review schema, migrations, snapshots/journal |
| Tests | 20 test/fixture files including the follow-up regressions |
| Probe/tooling | Test harness and committed second-wave probe record |

## Migration list

1. `drizzle/0000_talented_millenium_guard.sql` — baseline manual `releases`.
2. `drizzle/0001_collaboration_release_cache.sql` — additive cache/review/save tables, indexes, and FKs.
3. `drizzle/0002_handy_wendigo.sql` — nullable source/review revision and claim metadata.

All three applied to the final disposable local D1. No migration changed in this follow-up and no remote migration ran.

## Final full verification

- `npm test`: exit `0`; `183` tests, `183` passed, `0` failed/cancelled/skipped/todo; duration `1343.6298 ms`.
- `npm run build`: exit `0`; all five Vinext stages completed in `632`, `100`, `493`, `160`, and `246` ms.
- Emitted routes: `/`, `/calendar`, `/admin`, `/api/releases`, `/api/saved-releases`, `/api/admin/collect`, `/api/admin/reviews`, `/api/admin/reviews/:id`.
- Final `git diff --check` and `git status --short` results are recorded in the Task 13 report and returned with the commit.

## Fresh local HTTP evidence

Runtime: Cloudflare Vite plugin, port `4184`, new disposable D1 with migrations `0000`–`0002`.

| Check | Result |
| --- | --- |
| `/` | `200`; 20,665 bytes; 964 ms |
| `/calendar` | `200`; 33,865 bytes; 55 ms |
| First `/api/releases` | `200`; 47,719 bytes; 3,807 ms; 46 releases / 56 channels / 68 reviews; collection `current` |
| Second same-slot `/api/releases` | `200`; 47,719 bytes; 36 ms; identical counts/shape |
| Fanout proof | Source stderr `0 → 341 → 341`; second delta `0` |
| D1 proof | One completed `2026-07-31@18:00` slot; 15 source rows; one revision; 46 catalog / 56 channel / 68 pending-review rows |
| Salomon / ASICS / TUNE | `connected` / `error` / `connected` |
| Anonymous saved GET/POST/DELETE | `401`; `private, no-store` |
| Anonymous admin GET/POST/PATCH | `401`; `private, no-store` |

Top-level payload keys were `collection`, `releases`, `reviewCount`, and `sources`. Public channel keys remained `sourceKey`, retailer/URL/price, date, and time; no external identity leaked.

The server was stopped and port `4184` closed. Policy blocked deletion of the validated temp D1 directory:

`C:\Users\1\AppData\Local\Temp\release-calendar-task13-followup-a35963175b9641eb8cd5bf159076f8eb`

## Known limitations

- Lazy five-slot refresh: the first `/api/releases` request in each Seoul slot claims collection; no traffic means no collection.
- SNS deferred: Instagram and other SNS collection are not implemented.
- No alerts: push, email, and Kakao notifications are not implemented.
- No resale pricing: KREAM market-price and expected-profit collection/calculation are not implemented.

Additional local observations:

- ASICS failed conservatively because the live page lacked the validated structure sentinel; prior cache was preserved.
- A crashed same slot is not reclaimed because the approved terminal interface has no owner token; later slots remain claimable.

## Questions for Claude

1. Data-loss risk: can any cleanup, confirmed-empty result, stable-key update, peer-review action, or review resolution delete/orphan catalog, channel, history, or saved rows?
2. Auth bypass risk: can SIWC headers, ADMIN_EMAILS, proxy origin handling, route ordering, or local-only behavior create a production bypass?
3. Duplicate false positives: are stable identity, title fallback, fuzzy threshold, source/external partitioning, and stage exclusions calibrated safely?
4. Parser brittleness: do Salomon, ASICS, TUNE, and existing adapters fail conservatively on challenge/consent/selector drift?
5. Race conditions: are slot/source/review claims, peer-review freshness, atomic D1 batches, saved mutations, and admin refresh generations safe?
6. D1 migration safety: are `0001` and `0002` additive, ordered, parameter-safe, FK-compatible, and operationally reversible?
7. Responsive regressions: do `/`, `/calendar`, saved controls, disclosures, filters, badges, and `/admin` remain usable at desktop and 375 px?

## Controller finish sequence

1. Independently review the final committed range, including all three scoped Important dispositions.
2. Resolve every load-bearing finding before remote action.
3. Push the exact reviewed commit.
4. Package matching source/build state, save one Sites version, and deploy privately.
5. Poll to terminal status.
6. Fill every production field/check with observed evidence.
7. Inspect worker logs during checks and record new errors, if any.

## Scoped re-review follow-up

The final scoped reviewer reproduced a silent ASICS omission when one current-gallery item had no recognized product target. A new parser-level regression failed because `malformedRows` remained `0`; production code now counts recognized gallery candidates (`datalist`, `goods_sbj`, or `goods_sbt`) without a product target as malformed. This prevents partial ASICS snapshots from gaining stale-cache cleanup authority. Focused verification passed `16/16`, full verification passed `187/187`, and the production build passed.

## Controller production verification

- Final independent scoped review: no Critical, Important, or Minor findings; verdict `DEPLOY`.
- `/calendar`: loaded after a production reload with the category, collaboration, raffle, and saved-release filters.
- `/`: loaded with the release board, featured collaboration, retailer channel, and calendar navigation.
- `/admin`: owner session loaded the exception-only administration dashboard and source health controls.
- Identity-less `/`, `/api/releases`, and `/api/admin/reviews`: all returned `401`, confirming owner-only access at the Sites gate.
- Production environment: `ADMIN_EMAILS` exists as a secret at environment revision 3; no value was exposed.
- Worker logs during verification: no application exception or failed invocation. One `/favicon.ico` request returned `404` with worker outcome `ok`.
- ASICS remains a documented external limitation: the official server response currently presents a NetFUNNEL bootstrap document, so collection fails conservatively and preserves prior cache.

## Monthly overseas filter — pre-deployment verification (2026-08-01)

This is a documentation-only pre-deployment addendum for the monthly overseas
filter at `8d8784d65b21571f2ae6b69d02512265ca9166f2`. It preserves the earlier
collection-hardening deployment history recorded above and in its ledger; it
does not revise, replace, or infer a deployment for this filter.

### Recorded RED/GREEN and reviewer evidence

| Task | RED evidence | GREEN evidence and reviewer disposition |
| --- | --- | --- |
| Task 1 | Fixture/type coverage initially made `npx tsc --noEmit` exit `1` with the expected `TS2353` properties missing from `Partial<FixtureRelease>` at `tests/release-view-model.test.ts:98,103,108,114,122`. The market helper was initially undefined (`21` pass / `2` fail), and the selected-day helper was initially undefined (`10` pass / `1` fail). | Exposing market metadata made the classifier suite pass `9/9`; the helper suite then passed `23/23`; final focused command `node --import tsx --test tests/release-view-model.test.ts tests/saved-releases.test.ts` passed `24/24`. One fixture-encoding/category-literal review fix was required: before the fix, `npx tsc --noEmit` reported exactly two introduced `TS2322` errors at lines `155` and `200`; after it, those two diagnostics were absent and the focused suite remained `24/24`. Reviewer verdict: **APPROVE**. |
| Task 2 | Monthly-control coverage first failed (`23` pass / `1` fail) because the semantic overseas button with `aria-pressed="true"` was absent. Filter-aware selected-day empty-copy coverage then failed (`24` pass / `1` fail) because `selectedDayEmptyCopy` was undefined. An initial board extraction also exposed `Unexpected token` at `app/release-board.tsx:1100` before the delimiter correction. | The control cycle passed `24/24`; the final focused command passed `25/25`. The corrected board built successfully. Reviewer verdict: **APPROVE**; full suite `217/217`; build passed. |

Task 1 commits were `3cb010127c815b2cf68729f7dc4d2fb65e10df0f`
(`feat: compose overseas release filters`) and the required review-fix commit
`3071f06efa5fd24db1f5f6686f8f978b9a5e689f`
(`fix: use valid raffle fixture category`). Task 2 commit was
`8d8784d65b21571f2ae6b69d02512265ca9166f2`
(`feat: add monthly overseas filter`). The implementation/test files in that
range are `app/release-filters.tsx`, `app/release-board.tsx`,
`tests/release-view-model.test.ts`, and `tests/saved-releases.test.ts`.

### Fresh pre-deploy gate

- `npm test`: exit `0`; `217` tests passed, `0` failed/cancelled/skipped/todo;
  duration `1440.7295 ms`.
- `npm run build`: exit `0`; all five Vinext stages completed. It emitted the
  eight established routes: `/`, `/admin`, `/api/admin/collect`,
  `/api/admin/reviews`, `/api/admin/reviews/:id`, `/api/releases`,
  `/api/saved-releases`, and `/calendar`.
- `git diff --check`: exit `0` with no whitespace output.
- `git status --short`: empty before this documentation update.

### Still pending — controller-owned

| Field | Status |
| --- | --- |
| Independent broad review and release disposition | Pending; not performed by this documentation task. |
| Push, Sites credentials, source packaging, version save, and private deployment | Pending; no remote action was performed. |
| Deployment URL, deployed SHA, Sites version, and terminal status | Pending. |
| Signed-in calendar interaction, overseas-button state, composed-filter behavior, tab visibility/restoration, and filter-aware empty copy | Pending; no live browser interaction was performed. |
| Identity-less `401` boundary recheck and worker-log inspection | Pending. |

## Monthly overseas filter — post-deployment finalization (2026-08-01)

The preceding pending table is superseded by the recorded final evidence below.
This section documents the monthly-overseas-filter release only; it preserves
the earlier collection-hardening history unchanged.

### Final review and local release gate

- Deployed code: `0c58db5884fa4be5e4825c0eb6a3e8aa7da56f5e`
  (`0c58db5 fix: address overseas filter review findings`).
- Final re-review: Critical `0`, Important `0`, Minor `0`; verdict **DEPLOY**.
- Final code gate: `npm test` `219/219` in `1293.6495 ms`; `npm run build`
  succeeded and emitted all eight established routes; `git diff --check` was
  clean; the worktree was clean before deployment documentation.

### Private Sites deployment

| Field | Recorded value |
| --- | --- |
| Project | `appgprj_6a6024cfb5988191b0c9823944ebdcfe` |
| Production version | `28` — `appgprj_6a6024cfb5988191b0c9823944ebdcfe~appgver_e6ad8f7b49d4819197e5e8a021258945` |
| Deployment | `appgdep_6a6cc9faf740819186d5e32ac40523b2`; `succeeded`; environment revision `3` |
| URL | `https://droplog-class-release.curve2320.chatgpt.site` |
| Archive | `tar`; `39` files; `2,355,200` bytes; `sha256:3df02ebc43b797c39a6132a2fefcb191d16250f74b82ba1799b99b5573f8c65b` |
| Access | Custom, owner-only; `1` allowed user; `0` groups |

### Production access and monthly-calendar interaction

- Anonymous `/`, `/calendar`, and `/api/admin/reviews` each returned `401`.
- Dispatch-bypass `/` and `/calendar` returned `200`; `/admin` redirected
  `307` to sign-in; `/api/admin/reviews` returned `401` JSON.
- In a signed-in owner session, `/admin` loaded **Release administration** with
  `16` source-health entries and `66` pending exceptions.
- The overseas filter appears only on the monthly calendar, defaults off and
  resets on remount, composes with category filters, and is absent from home
  discovery filters. Current live data had no overseas releases: all `42`
  calendar cells displayed an explicit `0` count while it was active.
- The overseas selected-day empty state has no orphan tabpanel semantics.
  Disabling overseas restores the expected raffle card and valid
  tab/tabpanel linkage.

### Stale-boundary collection and cache evidence

Before the exact fifteen-minute stale boundary, final-version calls for slot
`2026-07-31@22:30` returned `200` with collection status `stale`, message
`Release collection is currently in progress.`, `38` cached releases, `16`
source keys, and `66` reviews. The browser-navigation owner was canceled at
`2026-07-31T16:15:46.806Z`.

At `2026-07-31T16:31:31.606Z`, after that exact boundary, a sustained
`GET /api/releases` reclaimed and completed the slot in `9,121 ms`: `200`,
`Cache-Control: private, max-age=60`, collection status `current`, null
message, `41` releases, `16` sources, `81` reviews, and `14` connected / `2`
error source statuses. A second same-slot request at
`2026-07-31T16:31:34.628Z` completed in `1,965 ms` with identical hashes:

- releases: `d4f0f2c0317a289f2af95b4760dac801c2c0fde118573eeeeab78ee3a3386328`
- sources: `60edb1bba8f6460ae8d145c84e0cc2081533c0b8f2b9567936eb749fdfabb39e`

The conservative post-refresh source errors were `adidas` and `kream`; KREAM
reported upstream HTTP `520`. Cached/site data remained available.

### Worker-log conclusion

The error-filtered query covering the ten minutes after reclaim returned `0`
events. A broader 25-minute error-filtered query contained the earlier
browser-navigation `GET /api/releases` at `2026-07-31T16:15:46.806Z`
(`canceled`, informational, no error, `1,316 ms`), plus an OK admin API event
and an OK favicon event. That canceled navigation is distinct from the later
successful sustained reclaim/current API evidence. No application exception or
failed invocation was observed.

SNS collection remains intentionally deferred.
