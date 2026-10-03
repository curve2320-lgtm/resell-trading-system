# Collection Cache and Slot Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent partial source snapshots from deleting cached channels and safely reclaim abandoned collection slots after 15 minutes without reporting active collection as current.

**Architecture:** Snapshot cleanup becomes explicit opt-in at both adapter and repository boundaries. Collection slots gain an additive ownership token, atomically reclaim stale running rows, and return typed outcomes that the API maps to current, stale, or failed without exposing internal identifiers.

**Tech Stack:** TypeScript 5.9, React 19, Drizzle ORM 0.45, Cloudflare D1/SQLite, Node test runner, Vinext 0.0.50

## Global Constraints

- Only literal `authoritativeSnapshot === true` may delete stale release channels.
- Existing adapters are non-authoritative unless their fetch result explicitly supplies `snapshotComplete: true` with `malformedRows === 0`.
- A running collection slot becomes reclaimable at exactly 15 minutes.
- Slot completion and failure require the current ownership token.
- In-progress collection is `stale` with cache and `failed` with an empty cache; it is never `current`.
- Additive migration only; no table rebuild, destructive DDL, or dependency upgrade.
- Preserve authentication, dedupe, review, source schedules, and public release DTO fields.

---

### Task 1: Fail-closed snapshot cleanup authority

**Files:**
- Modify: `app/collection/existing-adapters.ts:25-135`
- Modify: `app/collection/repository.ts:1425-1485`
- Test: `tests/run-collection.test.ts`
- Test: `tests/collection-repository.test.ts`

**Interfaces:**
- Consumes: existing `ExistingSourceFetchResult`, `PersistSourceResult`, and `persistSourceResult()` flow.
- Produces: `ExistingSourceFetchResult.snapshotComplete?: boolean`; repository cleanup guarded by `authoritativeSnapshot === true`.

- [ ] **Step 1: Write failing adapter authority tests**

Add focused cases proving omission is non-authoritative and explicit completeness is authoritative:

```ts
function existingReleaseFixture() {
  return {
    id: "existing:kept",
    externalId: "existing:kept",
    title: "Existing Kept Release",
    brand: "Existing",
    category: "정보" as const,
    releaseDate: "2026-08-01",
    releaseTime: null,
    channel: "Existing Store",
    sourceName: "Existing",
    sourceUrl: "https://existing.example/releases/kept",
    status: "예정",
    confidence: 100,
    note: "official",
    isFeatured: false,
    productUrl: "https://existing.example/releases/kept",
  };
}

test("a connected legacy adapter without completeness proof is non-authoritative", async () => {
  const adapter = createExistingAdapter({
    key: "existing",
    retailer: "Existing Store",
    allowedDomains: ["existing.example"],
    fetcher: async () => ({
      status: "connected",
      releases: [existingReleaseFixture()],
      message: "ok",
    }),
  });
  const result = await adapter.collect(now);
  assert.equal(result.authoritativeSnapshot, false);
});

test("explicit complete snapshots require zero malformed rows", async () => {
  const collect = async (malformedRows: number) =>
    createExistingAdapter({
      key: "existing",
      retailer: "Existing Store",
      allowedDomains: ["existing.example"],
      fetcher: async () => ({
        status: "connected",
        releases: [existingReleaseFixture()],
        message: "ok",
        snapshotComplete: true,
        malformedRows,
      }),
    }).collect(now);
  const complete = await collect(0);
  const partial = await collect(1);
  assert.equal(complete.authoritativeSnapshot, true);
  assert.equal(partial.authoritativeSnapshot, false);
});
```

- [ ] **Step 2: Run the adapter tests and verify RED**

Run: `node --import tsx --test tests/run-collection.test.ts`

Expected: FAIL because connected results without `malformedRows` currently gain authority and `snapshotComplete` is not part of the contract.

- [ ] **Step 3: Implement explicit adapter authority**

Change the fetch-result type and authority calculation:

```ts
export type ExistingSourceFetchResult = Pick<
  SourceFetchResult,
  "status" | "releases" | "message" | "undated"
> & {
  malformedRows?: number;
  snapshotComplete?: boolean;
};

const snapshotComplete =
  result.status === "connected" &&
  result.snapshotComplete === true &&
  result.malformedRows === 0;

return {
  // existing fields
  authoritativeSnapshot: snapshotComplete,
  confirmedEmpty:
    snapshotComplete &&
    releases.length === 0 &&
    config.confirmsEmptySchedule === true,
};
```

- [ ] **Step 4: Write failing repository authority tests**

Seed two cached source channels, persist one accepted group, and assert omitted channels survive for both `undefined` and `false`. Add a positive test where explicit `true` removes only the omitted channel while catalog, saved, and history rows remain.

```ts
for (const authority of [undefined, false]) {
  const outcome = await repository.persistSourceResult(
    sourceResult({ groups: [keptGroup], authoritativeSnapshot: authority }),
  );
  assert.deepEqual(await sourceExternalIds(db), ["kept", "omitted"]);
  assert.equal(outcome.reviewItemsCreated, 0);
}
```

- [ ] **Step 5: Run the repository test and verify RED**

Run: `node --import tsx --test tests/collection-repository.test.ts`

Expected: FAIL for `undefined`, because repository cleanup currently uses `authoritativeSnapshot !== false`.

- [ ] **Step 6: Make repository cleanup literal-true only**

Change both deletion gates:

```ts
if (result.confirmedEmpty && result.authoritativeSnapshot === true) {
  // existing confirmed-empty delete
}

const clearStaleChannels =
  result.authoritativeSnapshot === true && acceptedGroups.length > 0;
```

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```powershell
node --import tsx --test tests/run-collection.test.ts
node --import tsx --test tests/collection-repository.test.ts
```

Expected: all tests pass; the positive explicit-authority cleanup case still passes.

- [ ] **Step 8: Commit Task 1**

```powershell
git add app/collection/existing-adapters.ts app/collection/repository.ts tests/run-collection.test.ts tests/collection-repository.test.ts
git commit -m "fix: require explicit snapshot cleanup authority"
```

---

### Task 2: Add collection-slot ownership schema

**Files:**
- Modify: `db/schema.ts:92-98`
- Create: `drizzle/0003_collection_slot_claim_token.sql`
- Create: `drizzle/meta/0003_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Test: `tests/schema-contract.test.ts`

**Interfaces:**
- Consumes: existing `collection_slots(slot_key, status, started_at, completed_at)` table.
- Produces: nullable `collectionSlots.claimToken` mapped to `claim_token`.

- [ ] **Step 1: Write the failing schema contract test**

Add `claimToken` to the required collection-slot columns:

```ts
["collectionSlots", collectionSlots, [
  "slotKey",
  "status",
  "startedAt",
  "completedAt",
  "claimToken",
]],
```

- [ ] **Step 2: Run the schema test and verify RED**

Run: `node --import tsx --test tests/schema-contract.test.ts`

Expected: FAIL because `claimToken` is absent.

- [ ] **Step 3: Add the Drizzle field**

```ts
export const collectionSlots = sqliteTable("collection_slots", {
  slotKey: text("slot_key").primaryKey(),
  status: text("status").notNull(),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  claimToken: text("claim_token"),
});
```

- [ ] **Step 4: Generate and inspect the additive migration**

Run: `npm run db:generate -- --name collection_slot_claim_token`

Expected generated SQL in `drizzle/0003_collection_slot_claim_token.sql`:

```sql
ALTER TABLE `collection_slots` ADD `claim_token` text;
```

Reject any generated table rebuild, DROP, DELETE, or non-null constraint. Confirm `drizzle/meta/_journal.json` adds index 3 and `drizzle/meta/0003_snapshot.json` includes the nullable column.

- [ ] **Step 5: Apply all migrations to a disposable local database**

Use the project's established local D1/SQLite migration helper from `tests/collection-repository.test.ts`; apply `0000` through `0003`, then run:

```sql
PRAGMA table_info(collection_slots);
PRAGMA foreign_key_check;
```

Expected: `claim_token` exists and `foreign_key_check` returns no rows.

- [ ] **Step 6: Run the schema test and verify GREEN**

Run: `node --import tsx --test tests/schema-contract.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```powershell
git add db/schema.ts drizzle tests/schema-contract.test.ts
git commit -m "feat: add collection slot ownership token"
```

---

### Task 3: Implement atomic stale-slot reclaim and token-guarded terminal transitions

**Files:**
- Modify: `app/collection/repository.ts:30-45,1280-1335`
- Test: `tests/collection-repository.test.ts`

**Interfaces:**
- Consumes: `collectionSlots.claimToken` from Task 2.
- Produces:

```ts
export type SlotClaimOutcome =
  | { state: "claimed"; claimToken: string; reclaimed: boolean }
  | { state: "in_progress" }
  | { state: "completed" }
  | { state: "failed" };

claimSlot(
  slotKey: string,
  startedAt: string,
  claimToken: string,
  staleBefore: string,
): Promise<SlotClaimOutcome>;
completeSlot(slotKey: string, claimToken: string, completedAt: string): Promise<boolean>;
failSlot(slotKey: string, claimToken: string, completedAt: string): Promise<boolean>;
```

- [ ] **Step 1: Write failing repository slot tests**

Cover new claim, young running, exactly-15-minute reclaim, one-winner concurrent reclaim, completed/failed terminal rows, and old-owner rejection:

```ts
const t0 = "2026-07-31T01:00:00.000Z";
const t5 = "2026-07-31T01:05:00.000Z";
const t15 = "2026-07-31T01:15:00.000Z";
const t16 = "2026-07-31T01:16:00.000Z";
const first = await repository.claimSlot(slot, t0, "owner-a", "2026-07-31T00:45:00.000Z");
assert.deepEqual(first, { state: "claimed", claimToken: "owner-a", reclaimed: false });

const young = await repository.claimSlot(slot, t5, "owner-b", "2026-07-31T00:50:00.000Z");
assert.deepEqual(young, { state: "in_progress" });

const reclaimed = await repository.claimSlot(slot, t15, "owner-b", t0);
assert.deepEqual(reclaimed, { state: "claimed", claimToken: "owner-b", reclaimed: true });
assert.equal(await repository.completeSlot(slot, "owner-a", t16), false);
assert.equal(await repository.completeSlot(slot, "owner-b", t16), true);
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --import tsx --test tests/collection-repository.test.ts`

Expected: type/runtime failures because claim returns boolean and terminal transitions do not accept tokens.

- [ ] **Step 3: Implement insert, inspect, and compare-and-swap reclaim**

Implementation sequence:

1. Attempt `INSERT ... ON CONFLICT DO NOTHING RETURNING` with the new token.
2. If inserted, return `claimed/reclaimed:false`.
3. Read only `status`, `startedAt`, and `claimToken` for the slot.
4. Return terminal or young-running outcomes directly.
5. For stale running, update `startedAt` and `claimToken` with predicates on `slotKey`, `status=running`, and the previously read `startedAt`.
6. If the update returns a row, return `claimed/reclaimed:true`; otherwise re-read once and return the winner's current outcome.

The reclaim update must be equivalent to:

```ts
await db.update(collectionSlots)
  .set({ startedAt, completedAt: null, claimToken })
  .where(and(
    eq(collectionSlots.slotKey, slotKey),
    eq(collectionSlots.status, "running"),
    eq(collectionSlots.startedAt, existing.startedAt),
    lte(collectionSlots.startedAt, staleBefore),
  ))
  .returning({ slotKey: collectionSlots.slotKey })
  .get();
```

- [ ] **Step 4: Guard terminal transitions by token**

```ts
.where(and(
  eq(collectionSlots.slotKey, slotKey),
  eq(collectionSlots.status, "running"),
  eq(collectionSlots.claimToken, claimToken),
))
```

Return `Boolean(updatedRow)` instead of throwing when ownership was lost.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `node --import tsx --test tests/collection-repository.test.ts`

Expected: all repository tests pass, including exactly one stale-reclaim winner.

- [ ] **Step 6: Commit Task 3**

```powershell
git add app/collection/repository.ts tests/collection-repository.test.ts
git commit -m "feat: reclaim abandoned collection slots safely"
```

---

### Task 4: Propagate slot ownership outcomes to orchestration and API status

**Files:**
- Modify: `app/collection/run.ts:15-30,230-330`
- Modify: `app/collection/release-api.ts:10-95`
- Test: `tests/run-collection.test.ts`
- Test: `tests/releases-route-contract.test.ts`
- Test: `tests/collection-repository.test.ts`

**Interfaces:**
- Consumes: `SlotClaimOutcome` and token-guarded terminal methods from Task 3.
- Produces:

```ts
export type CollectionAttemptOutcome =
  | { state: "current"; summary: CollectionSummary }
  | { state: "in_progress"; summary: CollectionSummary }
  | { state: "failed"; summary: CollectionSummary };

export async function ensureCurrentSlotCollected(
  now?: Date,
): Promise<CollectionAttemptOutcome>;
```

- [ ] **Step 1: Write failing orchestration tests**

Update the in-memory repository to model token outcomes. Add tests proving adapters do not run for `in_progress`/terminal rows, a reclaimed owner uses the new token, and a lost old owner cannot overwrite terminal state.

```ts
const result = await runCollection(inputWithClaim({ state: "in_progress" }));
assert.equal(result.state, "in_progress");
assert.equal(adapterCalls, 0);
```

- [ ] **Step 2: Run orchestration tests and verify RED**

Run: `node --import tsx --test tests/run-collection.test.ts`

Expected: FAIL because orchestration expects a boolean claim and discards the result in `ensureCurrentSlotCollected()`.

- [ ] **Step 3: Implement token generation, 15-minute cutoff, and typed outcomes**

Use an injectable UUID source in `RunCollectionInput` for deterministic tests:

```ts
const claimToken = (input.randomUUID ?? crypto.randomUUID)();
const staleBefore = new Date(input.now.getTime() - 15 * 60_000).toISOString();
const claim = await input.repository.claimSlot(
  slotKey,
  input.now.toISOString(),
  claimToken,
  staleBefore,
);
```

Map `completed` to current without adapter execution, `failed` to a failed outcome, and `in_progress` to an in-progress outcome. Pass `claim.claimToken` to `completeSlot()`/`failSlot()`. If a terminal update returns false, return `in_progress` rather than claiming success.

- [ ] **Step 4: Write failing API status tests**

In `tests/releases-route-contract.test.ts`, change the dependency to return typed outcomes and add:

```ts
const emptyCollectionSummary: CollectionSummary = {
  slotKey: "2026-07-31@09:30",
  sourcesRun: 0,
  sourcesSucceeded: 0,
  sourcesFailed: 0,
  releasesCollected: 0,
  reviewItemsCreated: 0,
};

test("GET reports an active slot as stale when cache exists", async () => {
  const response = await getHandlerFactory()({
    ensureCurrentSlotCollected: async () => ({
      state: "in_progress",
      summary: emptyCollectionSummary,
    }),
    readReleaseApiPayload: async () => apiPayload({ releases: [cachedRelease] }),
    configuredSourceKeys: ["nike"],
  })();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).collection.status, "stale");
});

test("GET reports an active slot as unavailable when cache is empty", async () => {
  const response = await getHandlerFactory()({
    ensureCurrentSlotCollected: async () => ({
      state: "in_progress",
      summary: emptyCollectionSummary,
    }),
    readReleaseApiPayload: async () => apiPayload(),
    configuredSourceKeys: ["nike"],
  })();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).collection.status, "failed");
});
```

- [ ] **Step 5: Run API tests and verify RED**

Run: `node --import tsx --test tests/releases-route-contract.test.ts`

Expected: FAIL because every non-throwing attempt is currently labeled current.

- [ ] **Step 6: Map typed outcomes in the API handler**

Change `ReleaseGetDependencies.ensureCurrentSlotCollected` to return `CollectionAttemptOutcome`. Build the public context as follows:

```ts
if (attempt.state === "in_progress") {
  collection = {
    status: hasCachedReleases ? "stale" : "failed",
    message: "Release collection is currently in progress.",
  };
} else if (attempt.state === "failed") {
  collection = {
    status: hasCachedReleases ? "stale" : "failed",
    message: COLLECTION_ERROR_MESSAGE,
  };
} else {
  collection = { status: "current", message: null };
}
```

Return 503 when there are no releases and the attempt is not current. Keep exception sanitization unchanged.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```powershell
node --import tsx --test tests/run-collection.test.ts
node --import tsx --test tests/releases-route-contract.test.ts
node --import tsx --test tests/collection-repository.test.ts
```

Expected: all pass; response JSON contains no `claimToken`, `slotKey`, or internal exception text.

- [ ] **Step 8: Commit Task 4**

```powershell
git add app/collection/run.ts app/collection/release-api.ts tests/run-collection.test.ts tests/releases-route-contract.test.ts tests/collection-repository.test.ts
git commit -m "fix: expose accurate collection freshness"
```

---

### Task 5: Full verification, independent review, documentation, and private deployment

**Files:**
- Modify: `docs/superpowers/reviews/2026-07-31-claude-handoff.md`
- Modify: `docs/superpowers/reviews/2026-07-31-collaboration-release-upgrade-review.md`
- Modify: `.superpowers/sdd/2026-07-31-collaboration-release-upgrade/progress.md` (ignored local ledger)

**Interfaces:**
- Consumes: Tasks 1-4 final commit and the approved hardening design.
- Produces: reviewed private Sites deployment and exact evidence for the overseas-filter plan gate.

- [ ] **Step 1: Run full local verification**

Run:

```powershell
npm test
npm run build
git diff --check
git status --short
```

Expected: every test passes, build emits all eight established routes, diff check is clean, and only intentional documentation edits remain.

- [ ] **Step 2: Verify migrations on disposable D1/SQLite**

Apply migrations `0000` through `0003`, then exercise new claim, 15-minute reclaim, old-token rejection, and `PRAGMA foreign_key_check`. Record exact results in the review document.

- [ ] **Step 3: Request independent scoped review**

Review range: hardening plan base through current HEAD. Reviewer must check snapshot cleanup gates, migration safety, reclaim CAS, lost-owner behavior, API status mapping, and absence of token exposure. Fix every Critical/Important finding with a new RED/GREEN cycle and request one focused re-review.

- [ ] **Step 4: Update verification documents**

Record exact test count, build result, migration evidence, review verdict, known deferred Claude findings V2/V3/V5-V9, and pending production fields. Commit:

```powershell
git add docs/superpowers/reviews
git commit -m "docs: record collection hardening verification"
```

- [ ] **Step 5: Publish exact reviewed commit privately with Sites**

Follow `sites:sites-building` then `sites:sites-hosting`: push the exact reviewed SHA with a short-lived per-command credential, package the matching `dist` and migrations, save one version, deploy with owner-only access, and poll to `succeeded`.

- [ ] **Step 6: Verify production**

Check `/`, `/calendar`, owner `/admin`, identity-less `/`, `/api/releases`, and `/api/admin/reviews` 401 boundaries. Trigger/read release data twice in one slot and confirm no second source fanout. Inspect worker errors and record only observed results.

- [ ] **Step 7: Commit final production evidence**

Fill deployed SHA, Sites version, URL, terminal status, access checks, collection-status observations, and worker-log result in both handoff documents. Update the ignored SDD ledger locally and commit tracked docs:

```powershell
git add docs/superpowers/reviews
git commit -m "docs: record collection hardening deployment"
```

The monthly overseas-filter plan may begin only after this task has a clean review and successful private deployment.
