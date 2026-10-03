# North Face Official Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add The North Face Korea's official online store as a first-party release source without filling the calendar with ordinary already-selling new arrivals.

**Architecture:** Add a focused HTML parser for the official new-arrivals page and product pages. Only explicit future release dates become live calendar releases; products marked as upcoming without a trustworthy date become undated review candidates. Register the source through the existing adapter wrapper, cache and stale-fallback flow, and URL allowlist.

**Tech Stack:** TypeScript, existing source adapter interfaces, Node test runner with `tsx`, Next.js/Vinext, Cloudflare D1.

## Global Constraints

- Use `northFace` as the persisted source key to match the existing camel-case source keys.
- Use only `thenorthfacekorea.co.kr` and its subdomains for product/source URLs.
- Treat The North Face Korea as a `first_party` source.
- Do not publish ordinary in-stock or already-selling new-arrival products as future release dates.
- A product with an explicit valid release date may become a live release; `출시예정` without a date must remain an undated review candidate.
- Keep source requests inside the existing 30-minute cache and in-flight deduplication pattern.
- A malformed row or changed page structure must not produce an authoritative empty snapshot that deletes cached releases.
- Do not add a dependency or a database migration.

---

## File map

Create:

- `app/north-face.ts`: parser, fetcher, cache, stale fallback, and official URLs.
- `tests/fixtures/north-face-new.html`: stable fixture for the official new-arrivals markup.
- `tests/fixtures/north-face-upcoming.html`: stable fixture containing an upcoming product with and without an explicit date.

Modify:

- `app/collection/existing-adapters.ts`: register the adapter wrapper.
- `app/source-flags.ts`: add `northFace` to the source-key union.
- `app/release-links.ts`: allow the official North Face hostname.
- `tests/new-source-adapters.test.ts`: parser, registry, and source-fetch coverage.
- `tests/all.test.ts`: register the focused North Face test if the suite uses explicit imports.

No database or UI schema change is needed because the adapter produces the existing `ExternalRelease` and `UndatedRelease` shapes.

### Task 1: Build the North Face parser from fixtures

**Files:**
- Create: `app/north-face.ts`
- Create: `tests/fixtures/north-face-new.html`
- Create: `tests/fixtures/north-face-upcoming.html`
- Modify: `tests/new-source-adapters.test.ts`

**Interfaces:**

```ts
export type ParsedNorthFaceReleases = {
  releases: ExternalRelease[];
  undated: UndatedRelease[];
  malformedRows: number;
  structureValid: boolean;
};

export function parseNorthFaceReleases(
  newArrivalsHtml: string,
  upcomingProductPages: ReadonlyArray<{ url: string; html: string }> = [],
): ParsedNorthFaceReleases;

export async function fetchNorthFaceReleases(): Promise<NorthFaceFetchResult>;
```

- [ ] **Step 1: Add failing parser tests and minimal fixtures.**

Add tests with real markup-shaped fixtures for these behaviors:

```ts
test("North Face parser extracts official product links and style codes", () => {
  const parsed = parseNorthFaceReleases(fixture("north-face-new.html"));
  assert.equal(parsed.structureValid, true);
  assert.equal(parsed.releases.length, 0);
  assert.equal(parsed.undated.length, 2);
  assert.deepEqual(
    parsed.undated.map(({ styleCode, productUrl }) => ({ styleCode, productUrl })),
    [
      {
        styleCode: "NS97S22B",
        productUrl: "https://www.thenorthfacekorea.co.kr/product/NS97S22B",
      },
      {
        styleCode: "NJ3BS63J",
        productUrl: "https://www.thenorthfacekorea.co.kr/product/NJ3BS63J",
      },
    ],
  );
});

test("North Face parser publishes only an explicit future release date", () => {
  const parsed = parseNorthFaceReleases(
    fixture("north-face-new.html"),
    [
      {
        url: "https://www.thenorthfacekorea.co.kr/product/NS97S22B",
        html: fixture("north-face-upcoming.html"),
      },
    ],
  );
  assert.equal(parsed.releases.length, 1);
  assert.equal(parsed.releases[0]?.releaseDate, "2026-09-01");
  assert.equal(parsed.releases[0]?.styleCode, "NS97S22B");
});

test("North Face parser keeps an upcoming product without a date in review", () => {
  const parsed = parseNorthFaceReleases(
    fixture("north-face-new.html"),
    [
      {
        url: "https://www.thenorthfacekorea.co.kr/product/NJ3BS63J",
        html: fixture("north-face-upcoming.html").replace(
          "2026년 9월 1일 출시예정",
          "출시예정",
        ),
      },
    ],
  );
  assert.equal(parsed.releases.length, 0);
  assert.equal(parsed.undated.some(({ styleCode }) => styleCode === "NJ3BS63J"), true);
});
```

- [ ] **Step 2: Run the focused tests to verify the expected failure.**

Run: `node --import tsx --test tests/new-source-adapters.test.ts`

Expected: FAIL because `app/north-face.ts` and the fixtures do not exist yet.

- [ ] **Step 3: Implement the parser with explicit-date and review-only rules.**

Use the existing `htmlText`, `fetchSourceText`, `SOURCE_CACHE_TTL_MS`, and `SourceFetchResult` helpers. The parser must:

1. Validate the new-arrivals structure by requiring the official product-link marker and at least one `/product/<style-code>` link.
2. Extract each distinct product URL from `href="/product/<id>"`, preserving only the style-code-like path segment as `styleCode` and using `https://www.thenorthfacekorea.co.kr` as the canonical origin.
3. Read the product title from `.product-name`, `data-name`, or the product anchor text, and read a price from `data-price`/`.price` when present.
4. Treat the new-arrivals list as undated candidates by itself; it must never infer a release date from sort order, page position, manufacturing date, or ordinary “신상품” text.
5. For provided product pages, detect `출시예정`/`출시 알림` and parse only a full explicit date matching `20YY년 M월 D일` or `YYYY-MM-DD`. Reject invalid dates and ambiguous phrases such as `곧`, `이번 시즌`, or `예정` without a date.
6. Emit a live `ExternalRelease` with `category: "fashion"`-compatible mapping through the existing source shape, `brand: "THE NORTH FACE"`, `channel: "노스페이스 공식몰"`, `sourceName: "THE NORTH FACE"`, `retailer: "노스페이스 공식몰"`, `releaseMethod: "온라인 발매"`, `marketScope: "korea"`, and the canonical product URL.
7. Emit an `UndatedRelease` for an upcoming product with no explicit date, including `brand`, `styleCode`, `productUrl`, and a note that the official store lists it as upcoming but the date is unconfirmed.
8. Deduplicate by canonical product URL/style code and increment `malformedRows` for invalid product links or rows missing a title; do not turn a malformed row into a live release.

Use a small `NorthFaceFetchResult` type matching the existing `SourceFetchResult` plus `malformedRows`. Fetch the new-arrivals page first; only fetch a bounded, deduplicated set of product pages that are marked upcoming in the list (maximum 30 per refresh). If the new-arrivals page structure is invalid, return the stale cached result with `status: "error"` and never set `snapshotComplete`.

- [ ] **Step 4: Run parser tests and refactor only after green.**

Run: `node --import tsx --test tests/new-source-adapters.test.ts`

Expected: PASS for North Face parser tests and all existing source-adapter tests.

- [ ] **Step 5: Commit the parser.**

```bash
git add app/north-face.ts tests/fixtures/north-face-new.html tests/fixtures/north-face-upcoming.html tests/new-source-adapters.test.ts
git commit -m "feat: parse North Face official release candidates"
```

### Task 2: Register the source and protect official URLs

**Files:**
- Modify: `app/collection/existing-adapters.ts`
- Modify: `app/source-flags.ts`
- Modify: `app/release-links.ts`
- Modify: `tests/new-source-adapters.test.ts`
- Modify: `tests/release-links.test.ts`

**Interfaces:**

- Registry key: `northFace`
- Retailer label: `노스페이스 공식몰`
- Allowed hostname: `thenorthfacekorea.co.kr`
- Fetcher: `fetchNorthFaceReleases`

- [ ] **Step 1: Add failing registration and URL tests.**

```ts
test("registry exposes North Face Korea as a first-party source", () => {
  const adapter = releaseSourceAdapters.find(({ key }) => key === "northFace");
  assert.deepEqual(adapter?.allowedDomains, ["thenorthfacekorea.co.kr"]);
  assert.equal(adapter?.retailer, "노스페이스 공식몰");
});

test("North Face official product URLs pass retailer validation", () => {
  assert.equal(
    safeRetailerUrl("https://www.thenorthfacekorea.co.kr/product/NS97S22B"),
    "https://www.thenorthfacekorea.co.kr/product/NS97S22B",
  );
  assert.equal(safeRetailerUrl("https://thenorthface.example/product/NS97S22B"), null);
});
```

- [ ] **Step 2: Run the focused tests to verify the expected failure.**

Run: `node --import tsx --test tests/new-source-adapters.test.ts tests/release-links.test.ts`

Expected: FAIL because the registry key and URL allowlist entry do not exist.

- [ ] **Step 3: Register the adapter and allowlist.**

Import `fetchNorthFaceReleases` into `existing-adapters.ts` and append:

```ts
createExistingAdapter({
  key: "northFace",
  retailer: "노스페이스 공식몰",
  allowedDomains: ["thenorthfacekorea.co.kr"],
  fetcher: fetchNorthFaceReleases,
}),
```

Add `"northFace"` to `ReleaseSourceKey` and add `"thenorthfacekorea.co.kr"` to `approvedRetailerHostnames`. Do not add a separate adapter fanout or schema path.

- [ ] **Step 4: Run focused tests and confirm no existing source regression.**

Run: `node --import tsx --test tests/new-source-adapters.test.ts tests/release-links.test.ts tests/run-collection.test.ts`

Expected: PASS, including existing source registry and URL policy tests.

- [ ] **Step 5: Commit source registration.**

```bash
git add app/collection/existing-adapters.ts app/source-flags.ts app/release-links.ts tests/new-source-adapters.test.ts tests/release-links.test.ts
git commit -m "feat: register North Face Korea official source"
```

### Task 3: Integrate suite coverage and production verification

**Files:**
- Modify: `tests/all.test.ts`
- Modify: `docs/superpowers/specs/2026-07-31-collaboration-release-upgrade-design.md` only if the source list in the approved release-source scope needs updating.

- [ ] **Step 1: Add the explicit test import if required by the test runner.**

Keep North Face tests in `tests/new-source-adapters.test.ts`; add no duplicate test module. Confirm `tests/all.test.ts` already imports that module; only edit it if the import is absent.

- [ ] **Step 2: Run the complete test suite.**

Run: `npm test`

Expected: PASS with North Face parser, registry, URL, and existing collection tests.

- [ ] **Step 3: Run TypeScript and production build verification.**

Run: `npx tsc --noEmit` and `npm run build`

Expected: no new TypeScript diagnostics and a successful Vinext production build.

- [ ] **Step 4: Inspect the final diff and source behavior.**

Run: `git diff HEAD~2 --stat; git diff --check; git status --short`

Confirm there is no database migration, no dependency change, no unbounded product-page fanout, and no date inference from ordinary new-arrival ordering.

- [ ] **Step 5: Commit test registration or documentation only if changed.**

```bash
git add tests/all.test.ts docs/superpowers/specs/2026-07-31-collaboration-release-upgrade-design.md
git commit -m "test: verify North Face source integration"
```

Do not create an empty commit if neither file changed.

## Completion checklist

- [ ] North Face official source appears in the configured source registry.
- [ ] Explicit future dates become live first-party releases.
- [ ] Undated upcoming products become review candidates, not live calendar entries.
- [ ] Ordinary already-selling new arrivals do not create future dates.
- [ ] Product URLs are restricted to `thenorthfacekorea.co.kr`.
- [ ] Malformed structure uses stale fallback and cannot delete a valid cache.
- [ ] Requests are cached and bounded to at most 30 product pages per refresh.
- [ ] `npm test`, `npx tsc --noEmit`, and `npm run build` pass.
