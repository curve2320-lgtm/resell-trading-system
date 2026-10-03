# Collaboration Release Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the release calendar into a cached collaboration-release service with five daily refresh slots, three new official sources, deduplicated retailer channels, collaboration discovery, saved releases, and exception-only administration.

**Architecture:** External sources are called only by a slot-gated collection service or an authenticated administrator. User-facing reads come from D1. Each source adapter produces a shared normalized type; collection orchestration owns classification, deduplication, change detection, persistence, and review routing.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Vinext, Vite, Cloudflare Workers, Drizzle ORM, D1, Node test runner with `tsx`, OpenAI Sites

## Global Constraints

- Preserve the current private Sites project, URL, SIWC authentication, existing routes, and current visual language.
- Use Asia/Seoul refresh slots at 07:30, 09:30, 13:00, 18:00, and 22:30.
- Sites does not currently expose a cron declaration in `.openai/hosting.json`; the first `/api/releases` request in each slot claims that slot and performs at most one collection. No traffic means no collection, and concurrent traffic cannot create duplicate runs.
- External source failure must not remove the last successful cached data.
- Do not publish inferred dates.
- Do not add Instagram or other SNS collection.
- Do not add alerts, resale-price calculations, or image rehosting.
- All behavior changes use test-first development.
- Final completion requires local tests, a production build, production route checks, worker-log inspection, a Superpowers code-review pass, and a Claude handoff report.

---

## File Responsibility Map

- `app/collection/types.ts`: stable interfaces shared by adapters, orchestration, repository, and API responses.
- `app/collection/slots.ts`: Asia/Seoul slot calculation only.
- `app/collection/normalize.ts`: text, style-code, date, URL, and canonical-key normalization.
- `app/collection/classify.ts`: category, release kind, confidence, and review-reason decisions.
- `app/collection/dedupe.ts`: pure duplicate matching and channel grouping.
- `app/collection/repository.ts`: all D1 reads and writes for cached collection data.
- `app/collection/run.ts`: collection orchestration and per-source failure isolation.
- `app/collection/registry.ts`: enabled source adapter registry.
- `app/collection/existing-adapters.ts`: wrappers around the current source fetchers.
- `app/salomon.ts`, `app/asics.ts`, `app/tune.ts`: new source-specific HTTP and parsing logic.
- `app/api/releases/route.ts`: cached public read and existing authenticated manual-release write.
- `app/api/admin/collect/route.ts`: administrator-triggered single-source collection.
- `app/api/admin/reviews/route.ts`: review queue read.
- `app/api/admin/reviews/[id]/route.ts`: approve, edit, ignore, and merge actions.
- `app/api/saved-releases/route.ts`: current user's saved-release reads and writes.
- `app/admin/page.tsx`, `app/admin/admin-dashboard.tsx`: exception review and source health UI.
- `app/release-filters.tsx`, `app/release-badges.tsx`, `app/saved-release-button.tsx`: focused user-facing components.
- `tests/all.test.ts`: single cross-platform Node test entry that imports every test module.

---

### Task 1: Establish the test harness

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tests/all.test.ts`
- Create: `tests/collection-slots.test.ts`

**Interfaces:**
- Consumes: production modules imported directly from TypeScript.
- Produces: `npm test` as the one full-suite command used by every later task.

- [ ] **Step 1: Add the failing slot test**

Create `tests/collection-slots.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { collectionSlotKey } from "../app/collection/slots.ts";

test("maps Seoul time to the latest daily collection slot", () => {
  assert.equal(
    collectionSlotKey(new Date("2026-07-31T00:29:00.000Z")),
    "2026-07-31@07:30",
  );
  assert.equal(
    collectionSlotKey(new Date("2026-07-31T00:31:00.000Z")),
    "2026-07-31@09:30",
  );
  assert.equal(
    collectionSlotKey(new Date("2026-07-30T21:00:00.000Z")),
    "2026-07-30@22:30",
  );
});
```

Create `tests/all.test.ts`:

```ts
import "./collection-slots.test.ts";
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run:

```powershell
node --import tsx --test tests/all.test.ts
```

Expected: FAIL because `app/collection/slots.ts` does not exist.

- [ ] **Step 3: Add the test command**

Install `tsx` as an exact dev dependency and set:

```json
"test": "node --import tsx --test tests/all.test.ts"
```

Run:

```powershell
npm install --save-dev --save-exact tsx
```

- [ ] **Step 4: Implement slot calculation**

Create `app/collection/slots.ts` exporting:

```ts
export const COLLECTION_SLOTS = [
  "07:30",
  "09:30",
  "13:00",
  "18:00",
  "22:30",
] as const;

export function collectionSlotKey(now: Date): string;
```

Use `Intl.DateTimeFormat(..., { timeZone: "Asia/Seoul" })`. Before 07:30, return the previous Seoul calendar day's `22:30` slot.

- [ ] **Step 5: Run the test**

Run:

```powershell
npm test
```

Expected: 1 test passes, 0 failures.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json tests app/collection/slots.ts
git commit -m "test: add collection slot harness"
```

### Task 2: Add the cached collection schema

**Files:**
- Modify: `db/schema.ts`
- Create: `drizzle/0001_collaboration_release_cache.sql`
- Create: `drizzle/meta/0001_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Create: `tests/schema-contract.test.ts`
- Modify: `tests/all.test.ts`

**Interfaces:**
- Consumes: existing D1 `DB` binding and manual `releases` table.
- Produces: `releaseCatalog`, `releaseChannels`, `releaseSources`, `collectionSlots`, `releaseChanges`, `reviewItems`, and `savedReleases`.

- [ ] **Step 1: Add the failing schema-contract test**

Test that the following exports exist and expose the named columns:

```ts
releaseCatalog: id, canonicalKey, title, brand, category, releaseKind,
  releaseDate, releaseTime, status, confidence, firstSeenAt, updatedAt,
  lastVerifiedAt, changedAt
releaseChannels: id, releaseId, sourceKey, externalId, retailer,
  productUrl, sourceUrl, priceLabel, releaseDate, releaseTime, collectedAt
releaseSources: sourceKey, status, lastSuccessAt, lastFailureAt,
  consecutiveFailures, sourceCount, newCount, mergedCount, reviewCount, message
collectionSlots: slotKey, status, startedAt, completedAt
releaseChanges: id, releaseId, field, previousValue, nextValue, changedAt
reviewItems: id, sourceKey, externalId, reason, payloadJson, status,
  createdAt, resolvedAt, resolvedBy
savedReleases: userEmail, releaseId, createdAt
```

- [ ] **Step 2: Verify the test fails**

Run:

```powershell
npm test
```

Expected: FAIL because the new tables are not exported.

- [ ] **Step 3: Add Drizzle table definitions**

Use text IDs for collected releases and integer IDs for changes and reviews. Add unique indexes for:

```text
release_catalog.canonical_key
release_channels(source_key, external_id)
saved_releases(user_email, release_id)
```

Add foreign keys from channels, changes, and saved releases to `release_catalog.id`.

- [ ] **Step 4: Add the migration**

Create `drizzle/0001_collaboration_release_cache.sql` with `CREATE TABLE IF NOT EXISTS` and `CREATE UNIQUE INDEX IF NOT EXISTS` statements for all seven new tables. Add a journal entry with tag `0001_collaboration_release_cache`.

- [ ] **Step 5: Run schema and build verification**

Run:

```powershell
npm test
npm run build
```

Expected: tests pass and `dist/.openai/drizzle/0001_collaboration_release_cache.sql` exists.

- [ ] **Step 6: Commit**

```powershell
git add db/schema.ts drizzle tests
git commit -m "feat: add cached release collection schema"
```

### Task 3: Define normalized collection behavior

**Files:**
- Create: `app/collection/types.ts`
- Create: `app/collection/normalize.ts`
- Create: `app/collection/classify.ts`
- Create: `tests/normalize-release.test.ts`
- Create: `tests/classify-release.test.ts`
- Modify: `tests/all.test.ts`

**Interfaces:**
- Produces:

```ts
export type ReleaseCategory = "sneakers" | "fashion" | "lifestyle";
export type ReleaseKind = "general" | "collab" | "raffle" | "offline";

export type CollectedRelease = {
  sourceKey: string;
  externalId: string;
  title: string;
  brand: string | null;
  category: ReleaseCategory;
  releaseKind: ReleaseKind;
  releaseDate: string;
  releaseTime: string | null;
  priceLabel: string | null;
  styleCode: string | null;
  retailer: string;
  productUrl: string;
  sourceUrl: string;
  collectedAt: string;
};

export type ReviewReason =
  | "conflicting_schedule"
  | "possible_duplicate"
  | "missing_date"
  | "invalid_source_url";

export type AdapterReleaseInput = Omit<
  CollectedRelease,
  "category" | "releaseKind"
> & {
  categoryHint?: ReleaseCategory;
  releaseKindHint?: ReleaseKind;
  allowedDomains: string[];
};

export type Classification = {
  release: CollectedRelease | null;
  reviewReason: ReviewReason | null;
};

export function canonicalReleaseKey(release: CollectedRelease): string;
export function classifyRelease(input: AdapterReleaseInput): Classification;
```

- [ ] **Step 1: Write normalization tests**

Cover:

- style codes normalize case and punctuation;
- collaboration separators `x`, `×`, and `X` classify as `collab`;
- `RAFFLE`, `응모`, and `추첨` classify as `raffle`;
- a missing date is returned as `missing_date`, never an inferred date;
- product URLs must match the adapter's declared domains.

- [ ] **Step 2: Verify the tests fail**

Run:

```powershell
npm test
```

Expected: FAIL because normalization and classification modules do not exist.

- [ ] **Step 3: Implement pure normalization and classification**

Keep HTTP, database, and React imports out of these files. Use the style-code key when present; otherwise use normalized brand, title, and release date.

- [ ] **Step 4: Run the tests**

```powershell
npm test
```

Expected: all normalization and classification tests pass.

- [ ] **Step 5: Commit**

```powershell
git add app/collection tests
git commit -m "feat: normalize and classify collected releases"
```

### Task 4: Implement duplicate grouping and change detection

**Files:**
- Create: `app/collection/dedupe.ts`
- Create: `tests/dedupe-releases.test.ts`
- Modify: `tests/all.test.ts`

**Interfaces:**
- Consumes: `CollectedRelease[]`.
- Produces:

```ts
export type ReleaseGroup = {
  canonicalKey: string;
  release: CollectedRelease;
  channels: CollectedRelease[];
  reviewReason: ReviewReason | null;
};

export function groupCollectedReleases(
  releases: CollectedRelease[],
): ReleaseGroup[];

export type StoredRelease = {
  releaseDate: string;
  releaseTime: string | null;
  priceLabel: string | null;
  productUrl: string;
};

export function changedFields(
  previous: StoredRelease,
  next: CollectedRelease,
): Array<{
  field: "releaseDate" | "releaseTime" | "priceLabel" | "productUrl";
  previousValue: string | null;
  nextValue: string | null;
}>;
```

- [ ] **Step 1: Write failing duplicate and change tests**

Test:

- identical style code and date become one release with two channels;
- same normalized title, brand, and date become one release;
- same title on different dates stays separate;
- fuzzy title without style code creates `possible_duplicate`;
- changed date, time, price, and URL are recorded; unchanged fields are omitted.

- [ ] **Step 2: Run and observe failure**

```powershell
npm test
```

- [ ] **Step 3: Implement exact rules only**

Use token similarity only for review routing. Never automatically merge on fuzzy similarity.

- [ ] **Step 4: Run tests**

```powershell
npm test
```

- [ ] **Step 5: Commit**

```powershell
git add app/collection/dedupe.ts tests
git commit -m "feat: group retailer channels and detect changes"
```

### Task 5: Build the D1 repository and slot lease

**Files:**
- Create: `app/collection/repository.ts`
- Create: `tests/collection-repository.test.ts`
- Modify: `tests/all.test.ts`

**Interfaces:**
- Produces:

```ts
export interface CollectionRepository {
  claimSlot(slotKey: string, startedAt: string): Promise<boolean>;
  completeSlot(slotKey: string, completedAt: string): Promise<void>;
  failSlot(slotKey: string, completedAt: string): Promise<void>;
  listCachedReleases(): Promise<CachedRelease[]>;
  persistSourceResult(result: PersistSourceResult): Promise<void>;
  listSourceHealth(): Promise<SourceHealth[]>;
  listReviewItems(): Promise<ReviewItem[]>;
  resolveReview(input: ResolveReviewInput): Promise<void>;
}

export type CachedRelease = {
  id: string;
  canonicalKey: string;
  title: string;
  brand: string | null;
  category: ReleaseCategory;
  releaseKind: ReleaseKind;
  releaseDate: string;
  releaseTime: string | null;
  changedAt: string | null;
  lastVerifiedAt: string;
  channels: CachedReleaseChannel[];
};

export type CachedReleaseChannel = {
  sourceKey: string;
  retailer: string;
  productUrl: string;
  sourceUrl: string;
  priceLabel: string | null;
  releaseDate: string;
  releaseTime: string | null;
};

export type SourceHealth = {
  sourceKey: string;
  status: "connected" | "error" | "manual";
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  sourceCount: number;
  newCount: number;
  mergedCount: number;
  reviewCount: number;
  message: string;
};

export type PersistSourceResult = {
  sourceKey: string;
  status: SourceHealth["status"];
  groups: ReleaseGroup[];
  collectedAt: string;
  message: string;
  confirmedEmpty: boolean;
};

export type ReviewItem = {
  id: number;
  sourceKey: string;
  externalId: string;
  reason: ReviewReason;
  payloadJson: string;
  status: "pending" | "approved" | "ignored" | "merged";
};

export type ResolveReviewInput =
  | { id: number; action: "approve"; resolvedBy: string }
  | { id: number; action: "ignore"; resolvedBy: string }
  | { id: number; action: "merge"; releaseId: string; resolvedBy: string }
  | {
      id: number;
      action: "edit";
      title: string;
      releaseDate: string;
      releaseTime: string | null;
      resolvedBy: string;
    };

export function createCollectionRepository(): CollectionRepository;
```

- [ ] **Step 1: Write failing repository contract tests**

Use an in-memory fake implementing the same interface to test:

- only one caller can claim a slot;
- failed source persistence preserves previous cached releases;
- empty successful input does not delete previous data unless the adapter explicitly marks a confirmed empty schedule;
- change records are written before catalog updates.

- [ ] **Step 2: Verify failure**

```powershell
npm test
```

- [ ] **Step 3: Implement D1 queries**

Use `onConflictDoNothing()` for slot claims and source/external channel identity. Use D1 `batch` for catalog, channels, changes, source health, and reviews that belong to one source result.

- [ ] **Step 4: Run tests and build**

```powershell
npm test
npm run build
```

- [ ] **Step 5: Commit**

```powershell
git add app/collection/repository.ts tests
git commit -m "feat: persist cached release collection"
```

### Task 6: Isolate collection orchestration from HTTP requests

**Files:**
- Create: `app/collection/registry.ts`
- Create: `app/collection/existing-adapters.ts`
- Create: `app/collection/run.ts`
- Create: `tests/run-collection.test.ts`
- Modify: `tests/all.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ReleaseSourceAdapter {
  key: string;
  retailer: string;
  allowedDomains: string[];
  collect(now: Date): Promise<SourceCollectionResult>;
}

export type SourceCollectionResult = {
  sourceKey: string;
  status: "connected" | "error" | "manual";
  releases: AdapterReleaseInput[];
  message: string;
  confirmedEmpty: boolean;
};

export type CollectionSummary = {
  slotKey: string;
  sourcesRun: number;
  sourcesSucceeded: number;
  sourcesFailed: number;
  releasesCollected: number;
  reviewItemsCreated: number;
};

export async function runCollection(input: {
  repository: CollectionRepository;
  adapters: ReleaseSourceAdapter[];
  now: Date;
}): Promise<CollectionSummary>;

export async function ensureCurrentSlotCollected(now?: Date): Promise<void>;
```

- [ ] **Step 1: Write failing orchestration tests**

Test:

- two successful adapters both persist;
- one rejected adapter records failure while the other persists;
- concurrent calls for one slot run adapters once;
- a total failure keeps cached data;
- a source-specific manual run executes only the requested adapter.

- [ ] **Step 2: Verify failure**

```powershell
npm test
```

- [ ] **Step 3: Wrap existing fetchers**

Map each current `SourceFetchResult` into `SourceCollectionResult`. Preserve source messages and undated Nike entries. Do not change the source-specific parsers in this task.

- [ ] **Step 4: Implement orchestration**

Run adapters with `Promise.allSettled`, persist each result independently, and complete the slot after every adapter has settled.

- [ ] **Step 5: Run tests**

```powershell
npm test
```

- [ ] **Step 6: Commit**

```powershell
git add app/collection tests
git commit -m "refactor: isolate release collection orchestration"
```

### Task 7: Add Salomon, ASICS, and TUNE adapters

**Files:**
- Create: `app/salomon.ts`
- Create: `app/asics.ts`
- Create: `app/tune.ts`
- Create: `tests/fixtures/salomon-launch.html`
- Create: `tests/fixtures/salomon-raffle.html`
- Create: `tests/fixtures/asics-calendar.html`
- Create: `tests/fixtures/tune-products.json`
- Create: `tests/new-source-adapters.test.ts`
- Modify: `app/source-flags.ts`
- Modify: `app/collection/registry.ts`
- Modify: `tests/all.test.ts`

**Interfaces:**
- Each module exports `parse...` as a pure fixture-tested parser and `fetch...Releases()` as the network wrapper.

- [ ] **Step 1: Create minimal official-source fixtures**

Fixtures must represent:

- Salomon `8.05 오픈 예정`, title, product link, and member-only text;
- Salomon `7.30 응모 마감`, raffle title, and detail link;
- ASICS title, style code in parentheses, raffle marker, and product link;
- TUNE Shopify product JSON containing vendor, product type, tags, `published_at`, body style code, handle, variants, and images.

- [ ] **Step 2: Write failing parser tests**

Assert:

- Salomon launch rows resolve the year nearest `now` without moving a past December item into the wrong year;
- Salomon non-product running-session raffles are excluded;
- ASICS style codes such as `1203B186` are extracted;
- ASICS rows without a confirmed date become review candidates rather than guessed schedules;
- TUNE uses `https://tuneglobal.myshopify.com/products.json`;
- TUNE products enrich an existing style-code match; products without a schedule become undated review candidates;
- all product links use the public retailer domain.

- [ ] **Step 3: Verify failure**

```powershell
npm test
```

- [ ] **Step 4: Implement adapters**

Use:

```text
https://salomon.co.kr/collections/launch-calendar/products.json?limit=250
https://salomon.co.kr/collections/raffle-event
https://www.asics.co.kr/board/?id=spscalendar
https://tuneglobal.myshopify.com/products.json?limit=250
```

Use `fetchText`/`fetchJson` timeout helpers from `app/source-utils.ts`. Add `salomon`, `asics`, and `tune` source keys.

- [ ] **Step 5: Run tests and one live diagnostic**

```powershell
npm test
npm run build
```

Run each adapter once locally and print only counts, source status, and malformed-row counts. Do not save live response bodies.

- [ ] **Step 6: Commit**

```powershell
git add app tests
git commit -m "feat: collect Salomon ASICS and TUNE releases"
```

### Task 8: Make `/api/releases` cache-first

**Files:**
- Modify: `app/api/releases/route.ts`
- Create: `tests/releases-route-contract.test.ts`
- Modify: `tests/all.test.ts`

**Interfaces:**
- `GET /api/releases` returns cached releases, channels, source health, review count, and Nike undated items.
- `POST /api/releases` keeps the existing authenticated manual-registration behavior.

- [ ] **Step 1: Add a failing source-level route contract test**

Assert that `GET` calls `ensureCurrentSlotCollected()` and `listCachedReleases()` but does not import or call individual source fetchers.

- [ ] **Step 2: Verify failure**

```powershell
npm test
```

- [ ] **Step 3: Replace per-request fan-out**

Move the current fetcher list, deduplication, and source assembly out of the route. `GET` performs:

```ts
await ensureCurrentSlotCollected();
const payload = await readReleaseApiPayload();
return Response.json(payload, {
  headers: { "Cache-Control": "private, max-age=60" },
});
```

If slot collection fails, return cached data with source-health errors. Return `503` only when no cached data exists and every source failed.

- [ ] **Step 4: Verify**

```powershell
npm test
npm run build
```

Start local preview, request `/api/releases` twice, and verify the second request does not produce new external-source log entries for the same slot.

- [ ] **Step 5: Commit**

```powershell
git add app/api/releases/route.ts app/collection tests
git commit -m "feat: serve releases from slot-gated cache"
```

### Task 9: Add collaboration discovery UI

**Files:**
- Create: `app/release-filters.tsx`
- Create: `app/release-badges.tsx`
- Modify: `app/release-board.tsx`
- Modify: `app/globals.css`
- Create: `tests/release-view-model.test.ts`
- Modify: `tests/all.test.ts`

**Interfaces:**
- Filters: `all`, `sneakers`, `fashion`, `lifestyle`, `collab`, `raffle`.
- Badges: `COLLAB`, `RAFFLE`, `SEOUL ONLY`, `일정 변경`.

- [ ] **Step 1: Write failing view-model tests**

Test category filtering, release-kind filtering, changed-item badges, featured collaboration ordering, and multi-retailer channel counts.

- [ ] **Step 2: Verify failure**

```powershell
npm test
```

- [ ] **Step 3: Extract filter and badge components**

Keep `release-board.tsx` responsible for page state and composition. Put label and filtering rules in the new focused files.

- [ ] **Step 4: Add the user-facing sections**

Add:

- top filter row;
- `주목할 협업 발매` section on the home route;
- badges on cards;
- one card with expandable retailer channels;
- official source and last verified time.

Maintain keyboard-focus styles, 44px touch targets, and no horizontal overflow at 375px.

- [ ] **Step 5: Verify**

```powershell
npm test
npm run build
```

Perform browser checks for `/` and `/calendar` at desktop and mobile widths.

- [ ] **Step 6: Commit**

```powershell
git add app tests
git commit -m "feat: highlight collaboration releases"
```

### Task 10: Add saved releases

**Files:**
- Create: `app/api/saved-releases/route.ts`
- Create: `app/saved-release-button.tsx`
- Modify: `app/release-board.tsx`
- Create: `tests/saved-releases.test.ts`
- Modify: `tests/all.test.ts`

**Interfaces:**
- `GET /api/saved-releases` returns the current user's release IDs.
- `POST /api/saved-releases` body: `{ releaseId: string }`.
- `DELETE /api/saved-releases?releaseId=<id>` removes only the current user's row.

- [ ] **Step 1: Write failing ownership tests**

Test anonymous `401`, per-email isolation, duplicate save idempotence, and delete ownership.

- [ ] **Step 2: Verify failure**

```powershell
npm test
```

- [ ] **Step 3: Implement authenticated API**

Use `getChatGPTUser()` server-side. Never accept an email from request parameters or JSON.

- [ ] **Step 4: Implement UI**

Add a bookmark button to release cards and a `내 관심 발매` filter visible to signed-in users.

- [ ] **Step 5: Verify**

```powershell
npm test
npm run build
```

- [ ] **Step 6: Commit**

```powershell
git add app tests
git commit -m "feat: save releases per signed-in user"
```

### Task 11: Add exception-only administration

**Files:**
- Create: `app/admin-auth.ts`
- Create: `app/api/admin/collect/route.ts`
- Create: `app/api/admin/reviews/route.ts`
- Create: `app/api/admin/reviews/[id]/route.ts`
- Create: `app/admin/page.tsx`
- Create: `app/admin/admin-dashboard.tsx`
- Modify: `app/globals.css`
- Create: `tests/admin-review.test.ts`
- Modify: `tests/all.test.ts`

**Interfaces:**
- `requireAdmin()` checks SIWC user email against `ADMIN_EMAILS`.
- `POST /api/admin/collect` body: `{ sourceKey: string }`.
- `GET /api/admin/reviews` returns pending items and source health.
- `PATCH /api/admin/reviews/:id` body is one of:

```ts
{ action: "approve" }
{ action: "ignore" }
{ action: "merge"; releaseId: string }
{ action: "edit"; releaseDate: string; releaseTime: string | null; title: string }
```

- [ ] **Step 1: Write failing authorization and transition tests**

Test non-admin `403`, valid admin access, invalid source keys, allowed status transitions, merge target existence, and immutable resolved items.

- [ ] **Step 2: Verify failure**

```powershell
npm test
```

- [ ] **Step 3: Implement admin authorization**

Read `ADMIN_EMAILS` as a comma-separated environment value, normalize case, and reject missing configuration in production.

- [ ] **Step 4: Implement APIs**

Manual collection runs one registry adapter only. Review actions use D1 batches so catalog/channel writes and review resolution succeed together.

- [ ] **Step 5: Implement dashboard**

Show:

- pending review count and reason;
- old and candidate values;
- approve, edit, ignore, and merge controls;
- source last success/failure;
- source count, new count, merged count, and review count;
- warning after three consecutive failures or 24 hours without success;
- one-source refresh button.

- [ ] **Step 6: Verify**

```powershell
npm test
npm run build
```

Set production `ADMIN_EMAILS` from the existing owner-only Sites access policy through Sites environment variables, then deploy a saved version.

- [ ] **Step 7: Commit**

```powershell
git add app tests
git commit -m "feat: add exception-only release administration"
```

### Task 12: Measure second-wave sources without enabling them

**Files:**
- Create: `scripts/probe-candidate-sources.mjs`
- Create: `docs/source-probes/2026-07-31-kith-eql-onthespot.md`
- Modify: `package.json`

**Interfaces:**
- `npm run probe:sources` prints status, content type, candidate count, malformed count, duplicate estimate, and request count for Kith Seoul, EQL, and On The Spot.

- [ ] **Step 1: Add the probe script**

The script performs read-only requests with timeouts and does not write D1. It exits non-zero only when the script itself fails; source failures are reported as data.

- [ ] **Step 2: Run the probe**

```powershell
npm run probe:sources
```

- [ ] **Step 3: Record activation decisions**

Activate no source in this task. The report must use these thresholds:

```text
official release/date link exists
at least one useful candidate in the sampled period
malformed rows <= 10%
estimated duplicates <= 70%
requests per run <= 5
three consecutive probe runs succeed
```

- [ ] **Step 4: Commit**

```powershell
git add scripts package.json docs/source-probes
git commit -m "docs: measure second-wave release sources"
```

### Task 13: Final verification, review, and deployment

**Files:**
- Create: `docs/superpowers/reviews/2026-07-31-collaboration-release-upgrade-review.md`
- Create: `docs/superpowers/reviews/2026-07-31-claude-handoff.md`
- Modify only when verification identifies a tested defect.

**Interfaces:**
- Produces a production deployment and an independent verification package.

- [ ] **Step 1: Run complete local verification**

```powershell
npm test
npm run build
git diff --check
git status --short
```

Expected: all tests pass, build succeeds, no diff errors, and only intentional review documents are uncommitted.

- [ ] **Step 2: Run local HTTP checks**

Verify:

```text
GET / -> 200
GET /calendar -> 200
GET /api/releases -> 200 with cached releases, channels, and source health
second GET in the same slot -> no external collection
anonymous saved/admin APIs -> 401 or 403
```

- [ ] **Step 3: Use Superpowers code review**

Invoke `superpowers:requesting-code-review`. Review the implementation against the approved design and this plan. Record findings by severity, affected file, evidence, and disposition in the review document. Fix every blocking and high-severity finding with a failing test first.

- [ ] **Step 4: Commit and deploy**

Commit the exact verified tree, push the Sites source branch, package the matching `dist`, save one Sites version, deploy privately, and poll until `succeeded`.

- [ ] **Step 5: Verify production**

Confirm:

- `/` and `/calendar` render;
- filters and badges are present;
- the API reads cached data;
- owner can open `/admin`;
- a non-admin cannot access admin APIs;
- source health shows Salomon, ASICS, and TUNE;
- no new worker errors appear during checks.

- [ ] **Step 6: Prepare Claude verification handoff**

The handoff document must contain:

```text
approved design path
implementation plan path
production URL
deployed commit SHA and Sites version number
changed-file summary by subsystem
database migration list
exact local verification commands and outputs
exact production checks and observed results
known limitations: lazy five-slot refresh, SNS deferred, no alerts, no resale pricing
questions for Claude: data-loss risk, auth bypass risk, duplicate false positives,
  parser brittleness, race conditions, D1 migration safety, responsive regressions
```

- [ ] **Step 7: Run one fresh completion gate**

Run `npm test` and `npm run build` again after every review fix. Re-check deployment status and the production API before reporting completion.
