# Palace Signup Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or **superpowers:executing-plans** to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Palace Seoul's official store-entry signup schedules to the release calendar as separate Apgujeong and Hongdae raffle events.

**Architecture:** Use Palace's own public service API, not HTML scraping. Fetch the two official store endpoints, normalize each visible event into the existing `ExternalRelease` shape, and show the signup opening date/time as the calendar schedule while preserving the store visit date and reservation window in the note/label.

**Tech Stack:** TypeScript, existing source adapter interfaces, Node test runner with `tsx`, Next.js/Vinext.

## Global Constraints

- Use `palace` as the persisted source key.
- Fetch only `api.palaceskateboards.seoul.kr`'s public raffle-store endpoints for store IDs `1` and `7`.
- Use `palaceskateboards.seoul.kr` for the user-facing source and signup URLs.
- Do not submit entries, collect personal information, or call any POST endpoint.
- Only visible, active/future events become live calendar entries; expired events are skipped.
- Store names remain separate: `PALACE 압구정` and `PALACE 홍대` are distinct signup events.
- Keep the existing 30-minute cache and in-flight deduplication behavior.
- A failed or malformed endpoint must not produce an authoritative empty snapshot that deletes valid cached events.

---

## File map

Create:

- `app/palace.ts`: official API URLs, parser, cache, fetcher, and stale fallback.
- `tests/fixtures/palace-raffle-apgujeong.json`: stable API payload fixture.
- `tests/fixtures/palace-raffle-hongdae.json`: stable API payload fixture.

Modify:

- `app/collection/existing-adapters.ts`: register the Palace adapter.
- `app/source-flags.ts`: add `palace` to the source-key union.
- `app/release-links.ts`: allow the official Palace site hostname.
- `tests/new-source-adapters.test.ts`: parser, expiration, endpoint, registry, and URL tests.

No database migration or UI schema change is needed.

### Task 1: Parse official Palace signup events

**Files:**
- Create: `app/palace.ts`
- Create: `tests/fixtures/palace-raffle-apgujeong.json`
- Create: `tests/fixtures/palace-raffle-hongdae.json`
- Modify: `tests/new-source-adapters.test.ts`

**Interfaces:**

```ts
export type ParsedPalaceReleases = {
  releases: ExternalRelease[];
  undated: UndatedRelease[];
  malformedRows: number;
  structureValid: boolean;
};

export function parsePalaceReleases(
  storePayloads: ReadonlyArray<{ waitingStoreId: number; payload: unknown }>,
  now?: Date,
): ParsedPalaceReleases;

export async function fetchPalaceReleases(): Promise<PalaceFetchResult>;
```

- [ ] **Step 1: Write failing tests and fixtures.**

```ts
test("Palace parser creates one signup release per store event", () => {
  const parsed = parsePalaceReleases([
    { waitingStoreId: 1, payload: fixtureJson("palace-raffle-apgujeong.json") },
    { waitingStoreId: 7, payload: fixtureJson("palace-raffle-hongdae.json") },
  ], new Date("2026-08-12T04:30:00.000Z"));

  assert.deepEqual(
    parsed.releases.map(({ title, releaseDate, releaseTime, productUrl }) => ({
      title,
      releaseDate,
      releaseTime,
      productUrl,
    })),
    [
      {
        title: "PALACE 매장 입장 응모 · 압구정",
        releaseDate: "2026-08-12",
        releaseTime: "14:00",
        productUrl: "https://palaceskateboards.seoul.kr/waitingStore?waitingStoreId=1",
      },
      {
        title: "PALACE 매장 입장 응모 · 홍대",
        releaseDate: "2026-08-12",
        releaseTime: "14:00",
        productUrl: "https://palaceskateboards.seoul.kr/waitingStore?waitingStoreId=7",
      },
    ],
  );
  assert.equal(parsed.releases[0]?.note.includes("방문 2026-08-15"), true);
});

test("Palace parser skips invisible and expired events", () => {
  const parsed = parsePalaceReleases([
    { waitingStoreId: 1, payload: { code: "SUCCESS", payload: [
      { id: 1, visible: false, status: "READY", eventFrom: "2026-08-12T14:00:00", eventUntil: "2026-08-12T16:00:00", reservationDay: "2026-08-15", raffleStoreReservations: [{ reservationTime: "ALL DAY" }] },
      { id: 2, visible: true, status: "READY", eventFrom: "2026-08-10T14:00:00", eventUntil: "2026-08-10T16:00:00", reservationDay: "2026-08-11", raffleStoreReservations: [{ reservationTime: "ALL DAY" }] },
    ] } },
  ], new Date("2026-08-12T04:30:00.000Z"));
  assert.equal(parsed.releases.length, 0);
});
```

- [ ] **Step 2: Run the focused tests to verify the expected failure.**

Run: `node --import tsx --test tests/new-source-adapters.test.ts`

Expected: FAIL because `app/palace.ts` and fixtures do not exist.

- [ ] **Step 3: Implement the pure parser.**

Validate `code === "SUCCESS"` and an array payload. For each item, require a numeric ID, `visible === true`, `status === "READY"`, valid `eventFrom`, valid `eventUntil`, and a future `eventUntil`. Use the store mapping `{1: "압구정", 7: "홍대"}` and skip unknown store IDs with `malformedRows += 1`.

Map `eventFrom` to `releaseDate` and `releaseTime` in Asia/Seoul-compatible local fields, preserve `reservationDay` and all reservation times in the note, and use the official waiting-store page as both `productUrl` and `sourceUrl`. Set `category: "응모"`, `brand: "PALACE"`, `sourceName: "PALACE"`, `retailer: "PALACE 서울"`, `releaseMethod: "매장 입장 응모"`, `winnerMethod: "추첨"`, `mode: "offline"`, `marketScope: "korea"`, and `region: "대한민국"`.

Use `palace:<waitingStoreId>:<id>` as `externalId`. Do not create an undated candidate because an event without a valid signup opening timestamp is malformed and must not appear as a schedule.

- [ ] **Step 4: Run parser tests and refactor only after green.**

Run: `node --import tsx --test tests/new-source-adapters.test.ts`

Expected: PASS for Palace parser tests and existing adapter tests.

- [ ] **Step 5: Commit the parser.**

```bash
git add app/palace.ts tests/fixtures/palace-raffle-apgujeong.json tests/fixtures/palace-raffle-hongdae.json tests/new-source-adapters.test.ts
git commit -m "feat: parse Palace store signup events"
```

### Task 2: Register Palace and fetch both stores safely

**Files:**
- Modify: `app/collection/existing-adapters.ts`
- Modify: `app/source-flags.ts`
- Modify: `app/release-links.ts`
- Modify: `tests/new-source-adapters.test.ts`
- Modify: `tests/release-links.test.ts`

- [ ] **Step 1: Write failing registry and URL tests.**

```ts
test("registry exposes Palace Seoul with the official site domain", () => {
  const adapter = releaseSourceAdapters.find(({ key }) => key === "palace");
  assert.deepEqual(adapter?.allowedDomains, ["palaceskateboards.seoul.kr"]);
  assert.equal(adapter?.retailer, "PALACE 서울");
});

test("Palace signup URLs pass retailer validation", () => {
  assert.equal(
    safeRetailerUrl("https://palaceskateboards.seoul.kr/waitingStore?waitingStoreId=1"),
    "https://palaceskateboards.seoul.kr/waitingStore?waitingStoreId=1",
  );
  assert.equal(safeRetailerUrl("https://palace.example/waitingStore?waitingStoreId=1"), null);
});
```

- [ ] **Step 2: Run the focused tests to verify the expected failure.**

Run: `node --import tsx --test tests/new-source-adapters.test.ts tests/release-links.test.ts`

Expected: FAIL because the Palace registry key and hostname are absent.

- [ ] **Step 3: Implement the official API fetcher and registration.**

Fetch these two URLs in parallel:

```ts
const PALACE_ENDPOINTS = [
  { waitingStoreId: 1, url: "https://api.palaceskateboards.seoul.kr/v1/raffleStore/getRaffleStores?waitingStoreId=1" },
  { waitingStoreId: 7, url: "https://api.palaceskateboards.seoul.kr/v1/raffleStore/getRaffleStores?waitingStoreId=7" },
] as const;
```

Use `fetchSourceJson`, cache the successful combined result for 30 minutes, and return a stale cached result with `status: "error"` when either endpoint fails. Set `snapshotComplete` only when both endpoint payloads are valid and `malformedRows === 0`; do not confirm empty schedules because a temporarily empty event list is not proof that all signup events are gone.

Register:

```ts
createExistingAdapter({
  key: "palace",
  retailer: "PALACE 서울",
  allowedDomains: ["palaceskateboards.seoul.kr"],
  fetcher: fetchPalaceReleases,
}),
```

Add `"palace"` to `ReleaseSourceKey` and `"palaceskateboards.seoul.kr"` to `approvedRetailerHostnames`.

- [ ] **Step 4: Run focused and collection tests.**

Run: `node --import tsx --test tests/new-source-adapters.test.ts tests/release-links.test.ts tests/run-collection.test.ts`

Expected: PASS, including existing source behavior.

- [ ] **Step 5: Commit registration and fetching.**

```bash
git add app/collection/existing-adapters.ts app/source-flags.ts app/release-links.ts app/palace.ts tests/new-source-adapters.test.ts tests/release-links.test.ts
git commit -m "feat: register Palace Seoul signup source"
```

### Task 3: Full verification

- [ ] **Step 1: Run the complete test suite.**

Run: `npm test`

Expected: PASS with no changes to the D1 schema.

- [ ] **Step 2: Run type checking and production build.**

Run: `npx tsc --noEmit` and `npm run build`

Expected: both commands exit successfully.

- [ ] **Step 3: Inspect final diff.**

Run: `git diff --check; git status --short`

Confirm no POST signup call, no personal data, no unbounded endpoint fanout, and separate store events for Apgujeong and Hongdae.

## Completion checklist

- [ ] Apgujeong and Hongdae signup events are represented separately.
- [ ] Signup opening time is the calendar date/time.
- [ ] Store visit date and reservation window are visible in the note.
- [ ] Expired/invisible events are excluded.
- [ ] Palace URLs are restricted to the official domain.
- [ ] API failure cannot clear a valid cached schedule.
- [ ] Full tests, type check, and build pass.
