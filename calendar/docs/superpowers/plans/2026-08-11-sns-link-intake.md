# SNS Link Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an owner-only, official-account SNS intake flow that stores only normalized release metadata and opens the original post in one click without scraping or rehosting SNS content.

**Architecture:** Treat SNS as a manual `announcement` source, not a retailer adapter. An owner submits an Instagram permalink and explicit release metadata; a pure normalizer validates the official-account allowlist and produces either a live announcement channel or an existing review payload. The public API exposes a separate announcement URL sanitizer, while retailer CTA validation remains separate; the SNS channel has lower schedule precedence than first-party and aggregator sources.

**Tech Stack:** TypeScript, Next.js/Vinext route handlers, React, Drizzle ORM, Cloudflare D1, Node test runner with `tsx`.

## Global Constraints

- v1 performs **zero outbound fetches** on the SNS intake or refresh path.
- Only owner/admin users may submit SNS posts.
- Only allowlisted official brand/retailer accounts may be submitted.
- Persist only normalized metadata and the original post URL; do not persist raw HTML, images, videos, full captions, comments, DMs, stories, or follower data.
- `instagram.com` is valid only for announcement/source URLs and must never be added to the retailer CTA allowlist.
- A missing or ambiguous release date is review-only and cannot become a live schedule.
- SNS is an `announcement` tier below `first_party` retail and `aggregator` sources.
- SNS never deletes, unpublishes, or blocks a higher-tier retailer channel because of a schedule disagreement.
- SNS does not count as a second retailer for multi-retailer confirmation.
- Reuse existing nullable D1 URL columns and review infrastructure; do not add a new SNS table in v1.
- Keep a feature flag that can disable new SNS intake without deleting existing release data.

---

## File map

Create these focused units:

- `app/sns-config.ts`: official-account allowlist and SNS feature configuration.
- `app/sns-links.ts`: Instagram permalink canonicalization and announcement URL validation.
- `app/collection/source-tier.ts`: source precedence and announcement-channel helpers.
- `app/collection/sns-intake.ts`: pure input validation and normalized publish/review results.
- `app/api/admin/sns/route.ts`: owner-only SNS intake endpoint.
- `tests/sns-links.test.ts`, `tests/sns-intake.test.ts`, `tests/admin-sns.test.ts`: focused behavior coverage.

Modify these existing units:

- `app/collection/types.ts`: allow SNS-only channels to have `productUrl: null`.
- `app/source-flags.ts`: add `snsIntakeEnabled()` for the manual source without registering SNS in the external adapter fanout.
- `app/release-links.ts`: keep retailer and announcement URL policies separate.
- `app/collection/dedupe.ts`: apply source tiers to schedule conflicts.
- `app/collection/repository.ts`: persist manual SNS releases/reviews and expose safe source URLs without converting them into retailer CTAs.
- `app/admin-api.ts`, `app/admin-dashboard-controller.ts`, `app/admin/admin-dashboard.tsx`, `app/admin/page.tsx`: owner-only intake UI and state refresh.
- `app/release-board.tsx` and related release view-model code: render `원 게시글 보기` separately from purchase/raffle CTAs.
- `tests/dedupe-releases.test.ts`, `tests/collection-repository.test.ts`, `tests/release-view-model.test.ts`, `tests/releases-route-contract.test.ts`, `tests/all.test.ts`: regression and test registration.

No database migration is expected. Existing `release_channels.product_url` and `source_url` are nullable; the plan changes TypeScript/API handling and keeps the existing schema.

---

### Task 1: Separate announcement links from retailer links

**Files:**
- Create: `app/sns-config.ts`
- Create: `app/sns-links.ts`
- Modify: `app/collection/types.ts`
- Modify: `app/source-flags.ts`
- Modify: `app/release-links.ts`
- Test: `tests/sns-links.test.ts`

**Interfaces:**
- `officialSnsAccounts: readonly SnsAccount[]`
- `canonicalizeInstagramPostUrl(value: string): string | null`
- `safeAnnouncementUrl(value: string | null | undefined): string | null`
- `isOfficialSnsHandle(handle: string): boolean`
- `snsIntakeEnabled(): boolean`
- `CollectedRelease.productUrl: string | null`

- [ ] **Step 1: Write failing URL-policy tests.**

```ts
test("canonicalizes an Instagram post permalink and strips query tracking", () => {
  assert.equal(
    canonicalizeInstagramPostUrl(
      "https://www.instagram.com/p/ABC123/?igsh=tracking",
    ),
    "https://www.instagram.com/p/ABC123/",
  );
});

test("rejects login redirects, non-post paths, and non-Instagram hosts", () => {
  assert.equal(safeAnnouncementUrl("https://instagram.com/accounts/login/"), null);
  assert.equal(safeAnnouncementUrl("https://instagram.com/explore/"), null);
  assert.equal(safeAnnouncementUrl("https://example.com/p/ABC123/"), null);
});

test("does not make Instagram a safe retailer CTA", () => {
  assert.equal(safeRetailerUrl("https://www.instagram.com/p/ABC123/"), null);
});
```

- [ ] **Step 2: Run the focused test to verify it fails.**

Run: `node --import tsx --test tests/sns-links.test.ts`

Expected: FAIL because the SNS URL helpers do not exist yet.

- [ ] **Step 3: Add the official-account configuration and URL helpers.**

Use a small typed allowlist, for example:

```ts
export type SnsAccount = {
  platform: "instagram";
  handle: string;
  label: string;
};

export const officialSnsAccounts = [
  // Production entries are added only after owner verification.
] as const satisfies readonly SnsAccount[];

export function safeAnnouncementUrl(
  value: string | null | undefined,
): string | null {
  return value ? canonicalizeInstagramPostUrl(value) : null;
}
```

Require HTTPS, no credentials, no custom port, exact `instagram.com`/`www.instagram.com` host, and `/p/<id>/` or `/reel/<id>/` path. Keep `safeRetailerUrl` unchanged for purchase URLs. Change `CollectedRelease.productUrl` and cached channel/API channel types to `string | null`; existing retailer adapters continue to provide non-null values.

Add `"sns"` to the source-key union for persisted channels, but do not add a network adapter for it and do not include it in `enabledReleaseSourceAdapters()`. Add `snsIntakeEnabled()` that returns false when `RELEASE_SNS_INTAKE=off`; this flag controls only manual SNS writes and public projection.

- [ ] **Step 4: Run focused tests and existing link/type tests.**

Run: `node --import tsx --test tests/sns-links.test.ts tests/release-view-model.test.ts`

Expected: PASS, with no existing retailer URL regression.

- [ ] **Step 5: Commit the link contract.**

```bash
git add app/sns-config.ts app/sns-links.ts app/collection/types.ts app/source-flags.ts app/release-links.ts tests/sns-links.test.ts
git commit -m "feat: add separate SNS announcement link policy"
```

### Task 2: Add announcement source precedence and dedupe rules

**Files:**
- Create: `app/collection/source-tier.ts`
- Modify: `app/collection/dedupe.ts`
- Modify: `app/collection/repository.ts`
- Test: `tests/dedupe-releases.test.ts`
- Test: `tests/collection-repository.test.ts`

**Interfaces:**
- `sourceTier(sourceKey: string): "first_party" | "aggregator" | "announcement"`
- `isAnnouncementSource(sourceKey: string): boolean`
- `hasMultiRetailerConfirmation(release: CachedRelease): boolean` excludes `sns`.

- [ ] **Step 1: Add failing precedence tests.**

```ts
test("SNS schedule disagreement cannot remove a first-party channel", () => {
  const result = groupCollectedReleases([
    nikeRelease({ styleCode: "ABC-123", releaseDate: "2026-08-15" }),
    snsRelease({ styleCode: "ABC-123", releaseDate: "2026-08-16" }),
  ]);

  assert.equal(result.acceptedGroups.some((group) =>
    group.releases.some((release) => release.sourceKey === "nike"),
  ), true);
  assert.equal(result.reviewGroups.some((group) =>
    group.reviewReason === "conflicting_schedule",
  ), false);
});

test("SNS does not count as a second retailer", () => {
  assert.equal(hasMultiRetailerConfirmation(cachedReleaseWithNikeAndSns()), false);
});
```

- [ ] **Step 2: Run the focused tests to verify they fail.**

Run: `node --import tsx --test tests/dedupe-releases.test.ts tests/collection-repository.test.ts`

Expected: FAIL because current conflict handling treats SNS as an equal source and counts it as a retailer.

- [ ] **Step 3: Implement source tiers and conflict filtering.**

Use the explicit order `first_party > aggregator > announcement`. When a schedule conflict contains an announcement source and a higher-tier source with the same canonical identity, retain the higher-tier release and create one `conflicting_schedule` review for the SNS candidate. Do not remove or block the accepted higher-tier channel.

Keep equal-tier conflicts on the existing `conflicting_schedule` path. Do not change first-party-vs-first-party behavior. Exclude `sourceKey === "sns"` from the distinct retailer set used by `hasMultiRetailerConfirmation`.

- [ ] **Step 4: Run the focused and existing dedupe suites.**

Run: `node --import tsx --test tests/dedupe-releases.test.ts tests/collection-repository.test.ts`

Expected: PASS, including all existing first-party conflict tests.

- [ ] **Step 5: Commit the precedence change.**

```bash
git add app/collection/source-tier.ts app/collection/dedupe.ts app/collection/repository.ts tests/dedupe-releases.test.ts tests/collection-repository.test.ts
git commit -m "feat: treat SNS as a lower-priority announcement source"
```

### Task 3: Build the pure SNS intake normalizer

**Files:**
- Create: `app/collection/sns-intake.ts`
- Test: `tests/sns-intake.test.ts`

**Interfaces:**

```ts
export type SnsIntakeInput = {
  postUrl: string;
  handle: string;
  title: string;
  brand: string;
  category: ReleaseCategory;
  releaseDate: string | null;
  releaseTime: string | null;
  kind: "drop" | "raffle" | "restock" | "announcement";
  styleCode: string | null;
};

export type SnsIntakeResult =
  | { kind: "publish"; release: CollectedRelease }
  | {
      kind: "review";
      sourceKey: "sns";
      externalId: string;
      reason: "missing_date";
      payload: SnsIntakeInput & { canonicalUrl: string };
    }
  | { kind: "reject"; reason: "invalid_url" | "unofficial_account" | "disabled" };

export function normalizeSnsIntake(
  input: SnsIntakeInput,
  collectedAt: string,
): SnsIntakeResult;
```

- [ ] **Step 1: Write failing normalization tests.**

```ts
test("normalizes an official dated post into an SNS announcement channel", () => {
  const result = normalizeSnsIntake({
    postUrl: "https://www.instagram.com/p/ABC123/?igsh=x",
    handle: "brand_official",
    title: "Brand Runner",
    brand: "Brand",
    category: "sneakers",
    releaseDate: "2026-08-20",
    releaseTime: null,
    kind: "raffle",
    styleCode: "BR-123",
  }, "2026-08-11T00:00:00.000Z");

  assert.equal(result.kind, "publish");
  if (result.kind === "publish") {
    assert.equal(result.release.sourceKey, "sns");
    assert.equal(result.release.productUrl, null);
    assert.equal(result.release.sourceUrl, "https://www.instagram.com/p/ABC123/");
    assert.equal(result.release.releaseKind, "raffle");
  }
});

test("routes missing dates to review without creating a live release", () => {
  const result = normalizeSnsIntake({
    postUrl: "https://www.instagram.com/p/ABC124/",
    handle: "brand_official",
    title: "Coming Soon Runner",
    brand: "Brand",
    category: "sneakers",
    releaseDate: null,
    releaseTime: null,
    kind: "announcement",
    styleCode: null,
  }, "2026-08-11T00:00:00.000Z");

  assert.equal(result.kind, "review");
  if (result.kind === "review") assert.equal(result.reason, "missing_date");
});
```

- [ ] **Step 2: Run the focused test to verify it fails.**

Run: `node --import tsx --test tests/sns-intake.test.ts`

Expected: FAIL because the normalizer does not exist.

- [ ] **Step 3: Implement normalization without network access.**

Validate the allowlisted handle and `safeAnnouncementUrl`, derive the shortcode as `externalId`, map kind to the existing `ReleaseKind`, set `productUrl: null`, and preserve only normalized fields. Reject any attempt to infer a date from title text such as “soon” or “this weekend”. Do not call `fetch`, `URL` metadata endpoints, oEmbed, or any browser automation.

- [ ] **Step 4: Run focused tests and verify the no-fetch invariant.**

Add a test that temporarily replaces `globalThis.fetch` with a function that throws, call `normalizeSnsIntake`, and assert the normalized result succeeds. Run:

```bash
node --import tsx --test tests/sns-intake.test.ts tests/sns-links.test.ts
```

Expected: PASS with zero outbound calls.

- [ ] **Step 5: Commit the normalizer.**

```bash
git add app/collection/sns-intake.ts tests/sns-intake.test.ts
git commit -m "feat: normalize official SNS announcement links"
```

### Task 4: Persist manual SNS entries and expose the admin API

**Files:**
- Modify: `app/collection/repository.ts`
- Create: `app/api/admin/sns/route.ts`
- Modify: `app/admin-api.ts`
- Test: `tests/admin-sns.test.ts`
- Test: `tests/collection-repository.test.ts`

**Interfaces:**

```ts
export type ManualSnsPersistOutcome =
  | { status: "published"; releaseId: string; externalId: string }
  | { status: "review"; reviewId: number; externalId: string };

export interface CollectionRepository {
  // existing methods...
  persistManualSnsRelease(
    result: Extract<SnsIntakeResult, { kind: "publish" }>,
    collectedAt: string,
  ): Promise<ManualSnsPersistOutcome>;
  createManualSnsReview(
    result: Extract<SnsIntakeResult, { kind: "review" }>,
    collectedAt: string,
  ): Promise<ManualSnsPersistOutcome>;
}
```

- [ ] **Step 1: Write failing repository and route tests.**

```ts
test("manual SNS persistence is idempotent by source and shortcode", async () => {
  const first = await repository.persistManualSnsRelease(publishedResult, collectedAt);
  const second = await repository.persistManualSnsRelease(publishedResult, collectedAt);
  assert.equal(first.status, "published");
  assert.equal(second.status, "published");
  assert.equal(await countChannels("sns", "ABC123"), 1);
});

test("admin SNS POST rejects a non-admin request", async () => {
  const response = await postSns({ admin: false, body: validInput });
  assert.equal(response.status, 401);
});

test("admin SNS POST returns review status for a missing date", async () => {
  const response = await postSns({ admin: true, body: { ...validInput, releaseDate: null } });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).status, "review");
});
```

- [ ] **Step 2: Run the focused tests to verify they fail.**

Run: `node --import tsx --test tests/admin-sns.test.ts tests/collection-repository.test.ts`

Expected: FAIL because the manual repository methods and route do not exist.

- [ ] **Step 3: Implement manual persistence using existing D1 channel/review tables.**

For a publish result, reuse the existing catalog/channel grouping and write plan so style-code/date matches can merge into an existing catalog. Set `release_sources.status` to `manual` for `sns`, but do not run the source collector or make SNS part of the external adapter fanout. For a review result, write exactly one pending `review_items` row with `sourceKey: "sns"`, `externalId` equal to the shortcode, `reason: "missing_date"`, and normalized JSON payload. Use the existing source/external uniqueness and pending-review guards to prevent duplicates.

Ensure a manual SNS write cannot delete or replace first-party channels and cannot mark the source as an authoritative snapshot.

- [ ] **Step 4: Add the owner-only route.**

Create `POST /api/admin/sns` with the existing `requireAdmin` guard. Parse JSON, validate required strings and length limits, pass the typed input to `normalizeSnsIntake`, return:

```ts
{ status: "published", releaseId, externalId }
```

with HTTP `201`, or:

```ts
{ status: "review", reviewId, externalId, reason: "missing_date" }
```

with HTTP `202`. Return HTTP `400` for invalid URL/account/field values, HTTP `401` for unauthenticated requests, and HTTP `409` only for a conflicting duplicate that cannot be safely reused.

- [ ] **Step 5: Run route, repository, and auth tests.**

Run: `node --import tsx --test tests/admin-sns.test.ts tests/collection-repository.test.ts tests/admin-review.test.ts`

Expected: PASS, including existing review operations.

- [ ] **Step 6: Commit manual persistence and API.**

```bash
git add app/collection/repository.ts app/api/admin/sns/route.ts app/admin-api.ts tests/admin-sns.test.ts tests/collection-repository.test.ts
git commit -m "feat: add owner-only SNS link intake API"
```

### Task 5: Add admin intake UI and public original-post rendering

**Files:**
- Modify: `app/admin/admin-dashboard.tsx`
- Modify: `app/admin-dashboard-controller.ts`
- Modify: `app/admin/page.tsx`
- Modify: `app/collection/repository.ts`
- Modify: `app/release-board.tsx`
- Modify: `app/release-page.tsx`
- Test: `tests/release-view-model.test.ts`
- Test: `tests/releases-route-contract.test.ts`

**Interfaces:**
- Controller method: `submitSns(input: SnsIntakeInput): Promise<ManualSnsPersistOutcome>`
- API channel projection: `productUrl` uses `safeRetailerUrl`; `sourceUrl` uses `safeAnnouncementUrl` for `sourceKey === "sns"`.

- [ ] **Step 1: Write failing public projection tests.**

```ts
test("SNS channel exposes its permalink as sourceUrl, never productUrl", async () => {
  const payload = await readFixturePayload("sns-only-release.json");
  const channel = payload.releases[0].channels.find((item) => item.sourceKey === "sns");
  assert.equal(channel?.productUrl, null);
  assert.equal(channel?.sourceUrl, "https://www.instagram.com/p/ABC123/");
});

test("SNS-only channel view model exposes an announcement action", () => {
  const view = channelLinkView({
    sourceKey: "sns",
    productUrl: null,
    sourceUrl: "https://www.instagram.com/p/ABC123/",
  });
  assert.deepEqual(view, {
    productUrl: null,
    sourceUrl: "https://www.instagram.com/p/ABC123/",
    sourceLabel: "원 게시글 보기",
  });
});
```

- [ ] **Step 2: Run focused projection tests to verify they fail.**

Run: `node --import tsx --test tests/release-view-model.test.ts tests/releases-route-contract.test.ts`

Expected: FAIL because the current read projection sanitizes `sourceUrl` as a retailer and the UI has no SNS-specific CTA.

- [ ] **Step 3: Split repository URL projection.**

At the API boundary, never use `releaseDestination` as a fallback from `productUrl` to `sourceUrl` for purchase actions. Project:

```ts
productUrl: safeRetailerUrl(channel.productUrl),
sourceUrl: channel.sourceKey === "sns"
  ? safeAnnouncementUrl(channel.sourceUrl)
  : safeRetailerUrl(channel.sourceUrl),
```

Keep the general source URL behavior for existing retail adapters. Export `channelLinkView()` from the link/view-model unit so the board can render the two button roles without falling back from a missing retailer CTA to an Instagram source URL.

- [ ] **Step 4: Add the admin form.**

Add an owner-only “SNS 게시물 등록” section with account dropdown, permalink, title, brand, category, date, time, kind, and optional style code. Submit through the controller to `POST /api/admin/sns`; show published/review/validation feedback without exposing raw caption or media. Use existing admin refresh and pending-action patterns.

- [ ] **Step 5: Add public SNS channel labels and buttons.**

For SNS channels, render the account label and `원 게시글 보기` with `target="_blank"` and `rel="noreferrer"`. If a retailer channel exists, retain the retailer purchase/raffle CTA as primary and show the SNS link as a secondary source action. Do not render image previews or caption HTML.

- [ ] **Step 6: Run UI/API contract tests.**

Run: `node --import tsx --test tests/release-view-model.test.ts tests/releases-route-contract.test.ts tests/admin-sns.test.ts`

Expected: PASS, with no Instagram URL exposed through any `productUrl` field.

- [ ] **Step 7: Commit UI and projection changes.**

```bash
git add app/admin/admin-dashboard.tsx app/admin-dashboard-controller.ts app/admin/page.tsx app/collection/repository.ts app/release-board.tsx app/release-page.tsx tests/release-view-model.test.ts tests/releases-route-contract.test.ts
git commit -m "feat: render SNS original-post links separately"
```

### Task 6: Finish feature flagging, test registration, and verification

**Files:**
- Modify: `app/source-flags.ts`
- Modify: `tests/all.test.ts`
- Modify: `docs/superpowers/specs/2026-08-11-sns-link-intake-design.md` only if implementation behavior requires a clarified sentence
- Test: all existing tests and new SNS tests

- [ ] **Step 1: Add the SNS flag regression test.**

```ts
test("RELEASE_SNS_INTAKE=off blocks new SNS submissions without affecting cached retail releases", async () => {
  process.env.RELEASE_SNS_INTAKE = "off";
  const response = await postSns({ admin: true, body: validInput });
  assert.equal(response.status, 403);
  assert.equal(await cachedRetailReleaseCount(), baselineRetailReleaseCount);
});
```

- [ ] **Step 2: Register focused tests in the project test entrypoint.**

Add `tests/sns-links.test.ts`, `tests/sns-intake.test.ts`, and `tests/admin-sns.test.ts` to the same explicit list used by `tests/all.test.ts`; do not rely on filesystem glob ordering.

- [ ] **Step 3: Run the full test suite.**

Run: `npm test`

Expected: PASS with the existing suite plus the SNS tests. If a failure is caused by a changed nullable `productUrl` type, update the affected fixture expectation rather than reintroducing a fake SNS retailer URL.

- [ ] **Step 4: Run the production build.**

Run: `npm run build`

Expected: PASS with the admin route, API types, and public board included in the production bundle.

- [ ] **Step 5: Run focused type checking and inspect the final diff.**

Run: `npx tsc --noEmit` and `git diff main...HEAD --stat`.

Expected: no new diagnostics in changed files; the diff contains no media assets, raw HTML persistence, credentials, or external fetch in the SNS path.

- [ ] **Step 6: Verify rollback behavior.**

Run the admin SNS POST once with the feature enabled and once with `RELEASE_SNS_INTAKE=off`. Confirm the disabled request is rejected, existing retail releases remain available, and no database rows are deleted.

- [ ] **Step 7: Commit verification notes.**

```bash
git add app/source-flags.ts tests/all.test.ts
git commit -m "test: verify SNS intake rollout and rollback"
```

## Completion checklist

- [ ] Official-account allowlist is populated only with owner-verified brand/retailer accounts.
- [ ] `instagram.com` is never accepted by `safeRetailerUrl` or emitted as `productUrl`.
- [ ] SNS permalink is emitted only as a safe announcement/source URL.
- [ ] Missing/ambiguous dates are review-only.
- [ ] SNS cannot unpublish or block a first-party/aggregator channel.
- [ ] SNS is excluded from multi-retailer confirmation.
- [ ] No SNS network fetch occurs in v1.
- [ ] No media, raw HTML, or full caption is persisted.
- [ ] Admin-only submission and feature flag rollback are tested.
- [ ] `npm test`, `npm run build`, and focused type checking pass.
