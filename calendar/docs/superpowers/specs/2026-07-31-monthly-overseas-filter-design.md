# Monthly Overseas Filter Design

Date: 2026-07-31

## Goal

Add an independent `해외` filter toggle to the monthly calendar so users can combine overseas scope with the existing category and release-type filters.

## Scope

- Show the new toggle only in the monthly calendar discovery controls.
- Keep the home view unchanged because its daily schedule panels already provide `선착순 · 일반`, `응모`, and `해외` tabs.
- Reuse the existing `isOverseasRelease()` classification. Do not add a new source, parser, or market inference rule.
- Preserve all existing category, collaboration, raffle, saved-release, search, date, and schedule-mode behavior.

## Interaction

- `해외` is an independent pressed/unpressed toggle in the existing filter row.
- When unpressed, filtering behaves exactly as it does now.
- When pressed, the result of the active primary filter is further restricted to releases classified as overseas.
- Supported combinations include `스니커즈 + 해외`, `패션 + 해외`, `라이프스타일 + 해외`, `협업 + 해외`, `응모 + 해외`, and `내 관심 발매 + 해외`.
- The toggle remains visible when the result is empty; the calendar displays the normal zero-result state.
- Changing the primary filter does not reset the overseas toggle.
- Navigating between the home and monthly routes remounts the board and resets the toggle, matching the existing primary-filter behavior.
- While the overseas toggle is active, the selected-day schedule-mode tabs are hidden and the panel renders every overseas release that matches the primary filter. This avoids a redundant second `해외` control and keeps `응모 + 해외` functional.
- Turning the toggle off restores the selected-day schedule-mode tabs and the previously established default behavior.

## Components and data flow

1. `ReleaseBoard` owns a boolean monthly overseas-filter state, initialized to `false` on each route mount.
2. `ReleaseFilters` receives the state and a change callback only when `view === "calendar"`.
3. The component renders an accessible `해외` button whose `aria-pressed` value follows the boolean state.
4. A small exported helper composes market scope with a release list: it returns the input unchanged when the toggle is off and applies `isOverseasRelease()` when it is on.
5. The board filtering pipeline applies the existing primary filter, then the market-scope helper, then the existing text search.
6. Calendar grouping, date badges, and selected-day counts consume that same filtered result.
7. When the toggle is off, the selected-day panel continues through `effectiveScheduleMode()` and `releasesForScheduleMode()`.
8. When the toggle is on, the selected-day panel bypasses schedule-mode filtering, hides `ScheduleTypeTabs`, and renders the filtered selected-day releases directly. This explicitly supports overseas raffles.

## Error and empty-state behavior

- No new network request or persistence is introduced.
- Missing or ambiguous market metadata follows the existing conservative classifier and is not treated as overseas.
- Calendar dates with zero overseas matches display a zero badge as they do for other filters.
- An open selected-day panel with no matches uses filter-aware copy: `선택한 필터 조건에 맞는 일정이 없습니다.` It must not imply that the date has no releases in every scope.

## Tests

- Classifier tests cover explicit overseas scope, explicit domestic scope, SHOEPRIZE region/shipping fallbacks, and conservative missing metadata.
- A market-scope helper test proves that overseas scope composes with category, collaboration, raffle, and saved-release results.
- A control-rendering test proves that the monthly overseas button exposes the correct accessible pressed state.
- Control tests follow the existing optional-prop rendering pattern: the overseas button is rendered only when the monthly props are supplied, so no router-dependent static `ReleaseBoard` render is required.
- Selected-day helper tests prove that overseas mode bypasses schedule-mode filtering and that turning it off restores the existing effective-mode behavior.
- Empty-state copy receives a focused rendering assertion.
- The full test suite and production build must pass before deployment.

## Deployment

Publish the tested change as a new private Sites version, then verify the monthly calendar button and at least one combined-filter interaction in production. Preserve owner-only access and inspect worker error logs after verification.
