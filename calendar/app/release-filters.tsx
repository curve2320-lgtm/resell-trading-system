import React from "react";

export type ReleaseFilter =
  | "all"
  | "sneakers"
  | "fashion"
  | "lifestyle"
  | "collab"
  | "raffle"
  | "saved";

export type ReleaseScheduleMode = "all" | "general" | "entry" | "overseas";

export type FilterableRelease = {
  id: number | string;
  title: string;
  category?: "선착순" | "응모" | "정보" | "루머" | "수강";
  catalogCategory?: "sneakers" | "fashion" | "lifestyle";
  releaseKind?: "general" | "collab" | "raffle" | "offline";
  releaseDate: string;
  releaseTime: string | null;
  isFeatured?: boolean;
  channels?: readonly unknown[];
  marketScope?: "korea" | "overseas";
  region?: string | null;
  shippingMethod?: string | null;
  sourceName?: string;
};

export const releaseFilterOptions: readonly {
  value: ReleaseFilter;
  label: string;
}[] = [
  { value: "all", label: "전체" },
  { value: "sneakers", label: "스니커즈" },
  { value: "fashion", label: "패션" },
  { value: "lifestyle", label: "라이프스타일" },
  { value: "collab", label: "협업" },
  { value: "raffle", label: "응모" },
];

export function filterReleases<T extends FilterableRelease>(
  releases: readonly T[],
  filter: ReleaseFilter,
  savedReleaseIds?: ReadonlySet<string>,
): T[] {
  if (filter === "all") return [...releases];
  if (filter === "saved") {
    if (!savedReleaseIds) return [];
    return releases.filter((release) =>
      savedReleaseIds.has(String(release.id)),
    );
  }
  if (filter === "collab" || filter === "raffle") {
    return releases.filter((release) => release.releaseKind === filter);
  }
  return releases.filter(
    (release) => release.catalogCategory === filter,
  );
}

export function isEntryRelease(release: FilterableRelease): boolean {
  return release.category === "응모";
}

export function isOverseasRelease(release: FilterableRelease): boolean {
  if (release.marketScope) return release.marketScope === "overseas";
  const region = release.region
    ?.normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, "");
  if (
    region &&
    ["한국", "대한민국", "kr", "kor", "korea", "southkorea"].includes(region)
  ) {
    return false;
  }
  if (release.sourceName !== "SHOEPRIZE") return false;
  if (region) return true;
  return /배대지|직배|해외배송|international/i.test(
    release.shippingMethod ?? "",
  );
}

export function filterReleasesByMarketScope<T extends FilterableRelease>(
  releases: readonly T[],
  overseasOnly: boolean,
): T[] {
  return overseasOnly
    ? releases.filter(isOverseasRelease)
    : [...releases];
}

export function calendarDayCountLabel(
  count: number,
  overseasOnly: boolean,
): string | null {
  return count > 0 || overseasOnly ? `${count}건` : null;
}

export function scheduleModeFor(
  release: FilterableRelease,
): ReleaseScheduleMode {
  if (isOverseasRelease(release)) return "overseas";
  return isEntryRelease(release) ? "entry" : "general";
}

export function releasesForScheduleMode<T extends FilterableRelease>(
  releases: readonly T[],
  mode: ReleaseScheduleMode,
): T[] {
  if (mode === "all") return [...releases];
  return releases.filter((release) => scheduleModeFor(release) === mode);
}

export function effectiveScheduleMode(
  filter: ReleaseFilter,
  requestedMode: ReleaseScheduleMode,
): ReleaseScheduleMode {
  return filter === "raffle" ? "entry" : requestedMode;
}

export function selectedDayScheduleView<T extends FilterableRelease>(
  releases: readonly T[],
  activeFilter: ReleaseFilter,
  requestedMode: ReleaseScheduleMode,
  overseasOnly: boolean,
): {
  showScheduleTabs: boolean;
  effectiveMode: ReleaseScheduleMode;
  visibleReleases: T[];
} {
  if (overseasOnly) {
    return {
      showScheduleTabs: false,
      effectiveMode: "overseas",
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

export function selectedDayEmptyCopy(
  overseasOnly: boolean,
  activeFilter: ReleaseFilter,
  query: string,
): string {
  return overseasOnly || activeFilter !== "all" || query.trim()
    ? "선택한 필터 조건에 맞는 일정이 없습니다."
    : "등록된 일정이 없습니다.";
}

export function releaseScheduleView<T extends FilterableRelease>(
  releases: readonly T[],
  filter: ReleaseFilter,
  requestedMode: ReleaseScheduleMode,
): {
  effectiveMode: ReleaseScheduleMode;
  count: number;
  visibleReleases: T[];
} {
  const filtered = filterReleases(releases, filter);
  const effectiveMode = effectiveScheduleMode(filter, requestedMode);
  return {
    effectiveMode,
    count: filtered.length,
    visibleReleases: releasesForScheduleMode(filtered, effectiveMode),
  };
}

export function featuredCollaborationReleases<T extends FilterableRelease>(
  releases: readonly T[],
  todayIso: string,
): T[] {
  return releases
    .filter(
      (release) =>
        release.releaseKind === "collab" &&
        release.releaseDate >= todayIso,
    )
    .sort((left, right) => {
      const featuredOrder =
        Number(Boolean(right.isFeatured)) -
        Number(Boolean(left.isFeatured));
      if (featuredOrder !== 0) return featuredOrder;
      const dateOrder = left.releaseDate.localeCompare(right.releaseDate);
      if (dateOrder !== 0) return dateOrder;
      const timeOrder = (left.releaseTime ?? "99:99").localeCompare(
        right.releaseTime ?? "99:99",
      );
      if (timeOrder !== 0) return timeOrder;
      const titleOrder = left.title.localeCompare(right.title, "ko");
      if (titleOrder !== 0) return titleOrder;
      return String(left.id).localeCompare(String(right.id));
    });
}

export function releaseChannelCount(release: FilterableRelease): number {
  return release.channels?.length ?? 0;
}

export function ReleaseFilters({
  value,
  onChange,
  showSaved = false,
  savedLoading = false,
  showOverseas = false,
  overseasOnly = false,
  onOverseasChange,
}: {
  value: ReleaseFilter;
  onChange: (filter: ReleaseFilter) => void;
  showSaved?: boolean;
  savedLoading?: boolean;
  showOverseas?: boolean;
  overseasOnly?: boolean;
  onOverseasChange?: (value: boolean) => void;
}) {
  const options = showSaved
    ? [
        ...releaseFilterOptions,
        { value: "saved" as const, label: "내 관심 발매" },
      ]
    : releaseFilterOptions;

  return (
    <div className="release-filters" role="group" aria-label="발매 필터">
      {options.map((option) => (
        <button
          type="button"
          className={value === option.value ? "is-active" : ""}
          aria-pressed={value === option.value}
          aria-busy={
            option.value === "saved" ? savedLoading : undefined
          }
          disabled={option.value === "saved" && savedLoading}
          key={option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
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
    </div>
  );
}
