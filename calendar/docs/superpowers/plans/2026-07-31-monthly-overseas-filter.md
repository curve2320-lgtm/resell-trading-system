# Monthly Overseas Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an accessible monthly-calendar `해외` toggle that composes with category, collaboration, raffle, and saved-release filters without conflicting with selected-day schedule tabs.

**Architecture:** A pure market-scope helper composes after the existing primary filter. `ReleaseBoard` owns a calendar-only boolean toggle; while active, selected-day schedule tabs are hidden and the already-filtered overseas list is rendered directly so `응모 + 해외` remains functional.

**Tech Stack:** TypeScript 5.9, React 19, Node test runner, server-side React test rendering, Vinext 0.0.50

## Global Constraints

- Start only after the collection hardening plan is reviewed and privately deployed.
- Reuse `isOverseasRelease()`; do not add a source, parser, request, persistence field, or market inference rule.
- Show the toggle only on `view === "calendar"`; home daily tabs remain unchanged.
- The toggle composes with every existing primary filter and does not reset when the primary filter changes.
- Route remount resets the toggle, matching existing filter behavior.
- While active, hide selected-day schedule tabs and bypass schedule-mode filtering.
- Preserve owner-only deployment and existing public DTOs.

---

### Task 1: Add tested overseas classification and composition helpers

**Files:**
- Modify: `app/release-filters.tsx:1-125`
- Test: `tests/release-view-model.test.ts`
- Test: `tests/saved-releases.test.ts`

**Interfaces:**
- Consumes: existing `FilterableRelease`, `isOverseasRelease()`, `filterReleases()`, `effectiveScheduleMode()`, and `releasesForScheduleMode()`.
- Produces:

```ts
export function filterReleasesByMarketScope<T extends FilterableRelease>(
  releases: readonly T[],
  overseasOnly: boolean,
): T[];

export function selectedDayScheduleView<T extends FilterableRelease>(
  releases: readonly T[],
  activeFilter: ReleaseFilter,
  requestedMode: ReleaseScheduleMode,
  overseasOnly: boolean,
): {
  showScheduleTabs: boolean;
  effectiveMode: ReleaseScheduleMode;
  visibleReleases: T[];
};
```

- [ ] **Step 1: Write failing classifier tests**

Extend `FixtureRelease` with `marketScope`, `region`, `shippingMethod`, and `sourceName`. Test explicit overseas/domestic values, SHOEPRIZE non-Korean region, SHOEPRIZE international shipping fallback, non-SHOEPRIZE missing metadata, and explicit domestic override.

```ts
assert.equal(isOverseasRelease(fixture({ marketScope: "overseas" })), true);
assert.equal(isOverseasRelease(fixture({ marketScope: "korea", region: "US" })), false);
assert.equal(isOverseasRelease(fixture({ sourceName: "SHOEPRIZE", region: "US" })), true);
assert.equal(isOverseasRelease(fixture({ sourceName: "Nike", region: null })), false);
```

- [ ] **Step 2: Run and verify RED where coverage reveals fixture/type gaps**

Run: `node --import tsx --test tests/release-view-model.test.ts`

Expected: test/type failure until the fixture exposes market metadata; existing classifier behavior should then satisfy the assertions without production changes.

- [ ] **Step 3: Write failing composition-helper tests**

```ts
const primary = filterReleases(mixed, "collab");
assert.deepEqual(
  filterReleasesByMarketScope(primary, true).map(({ id }) => id),
  ["overseas-collab"],
);

assert.deepEqual(
  filterReleasesByMarketScope(filterReleases(mixed, "raffle"), true)
    .map(({ id }) => id),
  ["overseas-raffle"],
);
```

Also prove `overseasOnly=false` preserves order and all IDs, and saved results compose by passing `filterReleases(..., "saved", savedIds)` into the helper.

- [ ] **Step 4: Run and verify RED**

Run: `node --import tsx --test tests/release-view-model.test.ts tests/saved-releases.test.ts`

Expected: FAIL because `filterReleasesByMarketScope` does not exist.

- [ ] **Step 5: Implement the minimal market helper**

```ts
export function filterReleasesByMarketScope<T extends FilterableRelease>(
  releases: readonly T[],
  overseasOnly: boolean,
): T[] {
  return overseasOnly
    ? releases.filter(isOverseasRelease)
    : [...releases];
}
```

- [ ] **Step 6: Write failing selected-day interaction tests**

```ts
const overseasRaffle = fixture({
  id: "overseas-raffle",
  releaseKind: "raffle",
  category: "응모",
  marketScope: "overseas",
});

const overseasView = selectedDayScheduleView(
  [overseasRaffle],
  "raffle",
  "general",
  true,
);
assert.equal(overseasView.showScheduleTabs, false);
assert.deepEqual(overseasView.visibleReleases.map(({ id }) => id), ["overseas-raffle"]);

const normalView = selectedDayScheduleView(
  [overseasRaffle],
  "raffle",
  "general",
  false,
);
assert.equal(normalView.showScheduleTabs, true);
assert.equal(normalView.effectiveMode, "entry");
```

- [ ] **Step 7: Run and verify RED**

Run: `node --import tsx --test tests/release-view-model.test.ts`

Expected: FAIL because `selectedDayScheduleView` does not exist.

- [ ] **Step 8: Implement selected-day helper**

```ts
export function selectedDayScheduleView<T extends FilterableRelease>(
  releases: readonly T[],
  activeFilter: ReleaseFilter,
  requestedMode: ReleaseScheduleMode,
  overseasOnly: boolean,
) {
  if (overseasOnly) {
    return {
      showScheduleTabs: false,
      effectiveMode: "overseas" as const,
      visibleReleases: [...releases],
    };
  }
  const effectiveMode = effectiveScheduleMode(activeFilter, requestedMode);
  return {
    showScheduleTabs: true,
    effectiveMode,
    visibleReleases: releasesForScheduleMode(releases, effectiveMode),
  };
}
```

- [ ] **Step 9: Run focused tests and verify GREEN**

Run: `node --import tsx --test tests/release-view-model.test.ts tests/saved-releases.test.ts`

Expected: all pass.

- [ ] **Step 10: Commit Task 1**

```powershell
git add app/release-filters.tsx tests/release-view-model.test.ts tests/saved-releases.test.ts
git commit -m "feat: compose overseas release filters"
```

---

### Task 2: Add the calendar-only overseas control and selected-day behavior

**Files:**
- Modify: `app/release-filters.tsx:156-195`
- Modify: `app/release-board.tsx:20-35,1000-1160,1200-1220,1315-1340,1445-1575`
- Test: `tests/release-view-model.test.ts`
- Test: `tests/saved-releases.test.ts`

**Interfaces:**
- Consumes: `filterReleasesByMarketScope()` and `selectedDayScheduleView()` from Task 1.
- Produces optional `ReleaseFilters` props:

```ts
showOverseas?: boolean;
overseasOnly?: boolean;
onOverseasChange?: (value: boolean) => void;
```

- [ ] **Step 1: Write failing control-rendering tests**

Follow the existing optional saved-filter prop pattern:

```ts
const base = renderToStaticMarkup(createElement(ReleaseFilters, {
  value: "all",
  onChange: () => {},
}));
assert.doesNotMatch(base, />해외<\/button>/);

const monthly = renderToStaticMarkup(createElement(ReleaseFilters, {
  value: "collab",
  onChange: () => {},
  showOverseas: true,
  overseasOnly: true,
  onOverseasChange: () => {},
}));
assert.match(monthly, /<button[^>]+aria-pressed="true"[^>]*>해외<\/button>/);
```

- [ ] **Step 2: Run and verify RED**

Run: `node --import tsx --test tests/release-view-model.test.ts tests/saved-releases.test.ts`

Expected: FAIL because optional overseas props and button are absent.

- [ ] **Step 3: Implement the optional accessible control**

Extend props and append this button only when all monthly-control props are available:

```tsx
{showOverseas && onOverseasChange && (
  <button
    type="button"
    className={overseasOnly ? "is-active" : ""}
    aria-pressed={Boolean(overseasOnly)}
    onClick={() => onOverseasChange(!overseasOnly)}
  >
    해외
  </button>
)}
```

- [ ] **Step 4: Run control tests and verify GREEN**

Run: `node --import tsx --test tests/release-view-model.test.ts tests/saved-releases.test.ts`

Expected: tests pass and the base/home pattern renders no overseas button.

- [ ] **Step 5: Wire calendar state and filtering in `ReleaseBoard`**

Add state:

```ts
const [overseasOnly, setOverseasOnly] = useState(false);
```

Compose in the existing `filtered` memo before text search:

```ts
const primary = filterReleases(releases, activeFilter, savedReleaseIds);
return filterReleasesByMarketScope(primary, view === "calendar" && overseasOnly)
  .filter((release) => {
    if (!normalized) return true;
    return [
      release.title,
      release.brand,
      release.retailer,
      release.styleCode,
      release.releaseMethod,
      release.sourceName,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(normalized);
  });
```

Include `overseasOnly` and `view` in dependencies. Pass calendar-only props:

```tsx
<ReleaseFilters
  value={activeFilter}
  onChange={setActiveFilter}
  showSaved={savedUiAvailable}
  savedLoading={savedLoadState === "loading"}
  showOverseas={view === "calendar"}
  overseasOnly={overseasOnly}
  onOverseasChange={setOverseasOnly}
/>
```

- [ ] **Step 6: Replace selected-day mode derivation with the helper**

```ts
const selectedDayView = selectedDayScheduleView(
  selectedEvents,
  activeFilter,
  calendarScheduleMode,
  overseasOnly,
);
const effectiveCalendarScheduleMode = selectedDayView.effectiveMode;
const visibleSelectedEvents = selectedDayView.visibleReleases;
```

Render `ScheduleTypeTabs` only when `selectedDayView.showScheduleTabs`. Do not reset the overseas toggle in `focusReleaseDate`; route remount remains the only reset.

- [ ] **Step 7: Add filter-aware selected-day empty copy**

Replace the filtered zero-state branch with:

```tsx
{overseasOnly || activeFilter !== "all" || query.trim()
  ? "선택한 필터 조건에 맞는 일정이 없습니다."
  : "등록된 일정이 없습니다."}
```

Add a focused static helper or rendering assertion so this copy is tested without rendering router-dependent `ReleaseBoard` directly.

- [ ] **Step 8: Run focused tests and build**

Run:

```powershell
node --import tsx --test tests/release-view-model.test.ts tests/saved-releases.test.ts
npm run build
```

Expected: tests pass and all established routes build.

- [ ] **Step 9: Commit Task 2**

```powershell
git add app/release-filters.tsx app/release-board.tsx tests/release-view-model.test.ts tests/saved-releases.test.ts
git commit -m "feat: add monthly overseas filter"
```

---

### Task 3: Full review, production interaction check, and private deployment

**Files:**
- Modify: `docs/superpowers/reviews/2026-07-31-claude-handoff.md`
- Modify: `docs/superpowers/reviews/2026-07-31-collaboration-release-upgrade-review.md`
- Modify: `.superpowers/sdd/2026-07-31-collaboration-release-upgrade/progress.md` (ignored local ledger)

**Interfaces:**
- Consumes: Tasks 1-2 and the successfully deployed hardening plan.
- Produces: reviewed private deployment with monthly overseas composition evidence.

- [ ] **Step 1: Run complete verification**

Run:

```powershell
npm test
npm run build
git diff --check
git status --short
```

Expected: every test passes, all eight established routes build, and the worktree is clean after intentional commits.

- [ ] **Step 2: Request independent scoped review**

Reviewer checks classifier edge cases, filter composition, calendar-only rendering, `응모 + 해외`, hidden selected-day tabs, empty copy, route-reset behavior, saved-filter composition, accessibility, and no home regression. Fix all Critical/Important findings with TDD and request one focused re-review.

- [ ] **Step 3: Update local verification documents**

Record exact RED/GREEN evidence, test count, build result, reviewer verdict, files changed, and pending deployment fields. Commit:

```powershell
git add docs/superpowers/reviews
git commit -m "docs: record overseas filter verification"
```

- [ ] **Step 4: Deploy exact reviewed source privately**

Use `sites:sites-building` and `sites:sites-hosting`: push exact HEAD, package matching `dist` and migrations, save one version, deploy owner-only, and poll to `succeeded`.

- [ ] **Step 5: Verify production interaction**

In the signed-in production calendar:

1. Confirm `해외` appears in the monthly filter row and not as an extra home discovery button.
2. Toggle `해외` and confirm `aria-pressed=true`.
3. Combine with `스니커즈`, `협업`, and `응모`; verify date badges and selected-day cards derive from the same result.
4. Open a matching date and confirm schedule tabs are hidden while overseas mode is active.
5. Turn overseas mode off and confirm schedule tabs return.
6. Confirm filter-aware zero-result copy.
7. Recheck identity-less 401 boundaries and worker errors.

- [ ] **Step 6: Record production evidence and commit docs**

Fill URL, deployed SHA, Sites version, terminal status, interaction observations, access checks, and worker logs. Update the ignored SDD ledger locally and commit tracked docs:

```powershell
git add docs/superpowers/reviews
git commit -m "docs: record overseas filter deployment"
```
