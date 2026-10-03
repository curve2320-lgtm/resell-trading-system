import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as releaseBadgeModule from "../app/release-badges.tsx";
import * as releaseFilterModule from "../app/release-filters.tsx";
import {
  featuredCollaborationReleases,
  filterReleases,
  isOverseasRelease,
  releaseChannelCount,
} from "../app/release-filters.tsx";
import { releaseBadgeLabels } from "../app/release-badges.tsx";
import { releaseTimeLabel } from "../app/release-board.tsx";

type FixtureRelease = {
  id: string;
  title: string;
  category: "선착순" | "응모" | "정보";
  catalogCategory: "sneakers" | "fashion" | "lifestyle";
  releaseKind: "general" | "collab" | "raffle" | "offline";
  releaseDate: string;
  releaseTime: string | null;
  hasScheduleChange: boolean;
  isFeatured: boolean;
  marketScope: "korea" | "overseas" | undefined;
  region: string | null;
  shippingMethod: string | null;
  sourceName: string;
  channels: {
    sourceKey: string;
    retailer: string;
  }[];
};

function fixture(
  overrides: Partial<FixtureRelease> = {},
): FixtureRelease {
  return {
    id: "general-sneaker",
    title: "General Sneaker",
    category: "선착순",
    catalogCategory: "sneakers",
    releaseKind: "general",
    releaseDate: "2026-08-02",
    releaseTime: "10:00",
    hasScheduleChange: false,
    isFeatured: false,
    marketScope: undefined,
    region: null,
    shippingMethod: null,
    sourceName: "Nike",
    channels: [
      {
        sourceKey: "nike",
        retailer: "Nike SNKRS Korea",
      },
    ],
    ...overrides,
  };
}

const releases = [
  fixture(),
  fixture({
    id: "fashion-collab",
    title: "Fashion Collaboration",
    catalogCategory: "fashion",
    releaseKind: "collab",
  }),
  fixture({
    id: "lifestyle-raffle",
    title: "Lifestyle Raffle",
    catalogCategory: "lifestyle",
    releaseKind: "raffle",
  }),
];

test("category filters return only releases in the selected catalog category", () => {
  assert.deepEqual(
    filterReleases(releases, "fashion").map((release) => release.id),
    ["fashion-collab"],
  );
  assert.deepEqual(
    filterReleases(releases, "lifestyle").map((release) => release.id),
    ["lifestyle-raffle"],
  );
});

test("release-kind filters are independent of catalog category", () => {
  assert.deepEqual(
    filterReleases(releases, "collab").map((release) => release.id),
    ["fashion-collab"],
  );
  assert.deepEqual(
    filterReleases(releases, "raffle").map((release) => release.id),
    ["lifestyle-raffle"],
  );
  assert.deepEqual(
    filterReleases(releases, "all").map((release) => release.id),
    releases.map((release) => release.id),
  );
});

test("overseas classification honors explicit market metadata and SHOEPRIZE fallbacks", () => {
  assert.equal(
    isOverseasRelease(fixture({ marketScope: "overseas" })),
    true,
  );
  assert.equal(
    isOverseasRelease(
      fixture({ marketScope: "korea", region: "US" }),
    ),
    false,
  );
  assert.equal(
    isOverseasRelease(fixture({ sourceName: "SHOEPRIZE", region: "US" })),
    true,
  );
  assert.equal(
    isOverseasRelease(
      fixture({
        sourceName: "SHOEPRIZE",
        region: null,
        shippingMethod: "international",
      }),
    ),
    true,
  );
  assert.equal(
    isOverseasRelease(fixture({ sourceName: "Nike", region: null })),
    false,
  );
});

test("market scope filtering composes collab and raffle filters while preserving unscoped order", () => {
  const filterReleasesByMarketScope = (
    releaseFilterModule as {
      filterReleasesByMarketScope?: (
        releases: FixtureRelease[],
        overseasOnly: boolean,
      ) => FixtureRelease[];
    }
  ).filterReleasesByMarketScope;
  assert.equal(typeof filterReleasesByMarketScope, "function");

  const mixed = [
    fixture({ id: "domestic-collab", releaseKind: "collab" }),
    fixture({
      id: "overseas-collab",
      releaseKind: "collab",
      marketScope: "overseas",
    }),
    fixture({
      id: "overseas-raffle",
      category: "응모",
      releaseKind: "raffle",
      marketScope: "overseas",
    }),
    fixture({ id: "domestic-general" }),
  ];

  const primary = filterReleases(mixed, "collab");
  assert.deepEqual(
    filterReleasesByMarketScope!(primary, true).map(({ id }) => id),
    ["overseas-collab"],
  );
  assert.deepEqual(
    filterReleasesByMarketScope!(
      filterReleases(mixed, "raffle"),
      true,
    ).map(({ id }) => id),
    ["overseas-raffle"],
  );
  assert.deepEqual(
    filterReleasesByMarketScope!(mixed, false).map(({ id }) => id),
    mixed.map(({ id }) => id),
  );
});

test("market scope filtering composes every catalog category and all in source order", () => {
  const filterReleasesByMarketScope = (
    releaseFilterModule as {
      filterReleasesByMarketScope?: (
        releases: FixtureRelease[],
        overseasOnly: boolean,
      ) => FixtureRelease[];
    }
  ).filterReleasesByMarketScope;
  assert.equal(typeof filterReleasesByMarketScope, "function");

  const mixed = [
    fixture({
      id: "overseas-fashion-first",
      catalogCategory: "fashion",
      marketScope: "overseas",
    }),
    fixture({ id: "domestic-sneakers", marketScope: "korea" }),
    fixture({
      id: "overseas-sneakers-first",
      marketScope: "overseas",
    }),
    fixture({
      id: "overseas-lifestyle",
      catalogCategory: "lifestyle",
      marketScope: "overseas",
    }),
    fixture({
      id: "domestic-fashion",
      catalogCategory: "fashion",
      marketScope: "korea",
    }),
    fixture({
      id: "overseas-sneakers-second",
      marketScope: "overseas",
    }),
    fixture({
      id: "domestic-lifestyle",
      catalogCategory: "lifestyle",
      marketScope: "korea",
    }),
    fixture({
      id: "overseas-fashion-second",
      catalogCategory: "fashion",
      marketScope: "overseas",
    }),
  ];
  const cases: {
    filter: "all" | "sneakers" | "fashion" | "lifestyle";
    expectedIds: string[];
  }[] = [
    {
      filter: "sneakers",
      expectedIds: [
        "overseas-sneakers-first",
        "overseas-sneakers-second",
      ],
    },
    {
      filter: "fashion",
      expectedIds: [
        "overseas-fashion-first",
        "overseas-fashion-second",
      ],
    },
    {
      filter: "lifestyle",
      expectedIds: ["overseas-lifestyle"],
    },
    {
      filter: "all",
      expectedIds: [
        "overseas-fashion-first",
        "overseas-sneakers-first",
        "overseas-lifestyle",
        "overseas-sneakers-second",
        "overseas-fashion-second",
      ],
    },
  ];

  for (const { filter, expectedIds } of cases) {
    const primary = filterReleases(mixed, filter);
    assert.deepEqual(
      filterReleasesByMarketScope!(primary, true).map(({ id }) => id),
      expectedIds,
      filter,
    );
  }
});

test("calendar day count labels expose overseas zeroes without changing normal badges", () => {
  const calendarDayCountLabel = (
    releaseFilterModule as {
      calendarDayCountLabel?: (
        count: number,
        overseasOnly: boolean,
      ) => string | null;
    }
  ).calendarDayCountLabel;
  assert.equal(typeof calendarDayCountLabel, "function");

  assert.equal(calendarDayCountLabel!(0, false), null);
  assert.equal(calendarDayCountLabel!(0, true), "0건");
  assert.equal(calendarDayCountLabel!(3, false), "3건");
  assert.equal(calendarDayCountLabel!(3, true), "3건");
});

test("selected-day overseas view hides schedule tabs and bypasses raffle schedule mode", () => {
  const selectedDayScheduleView = (
    releaseFilterModule as {
      selectedDayScheduleView?: (
        releases: FixtureRelease[],
        activeFilter: string,
        requestedMode: string,
        overseasOnly: boolean,
      ) => {
        showScheduleTabs: boolean;
        effectiveMode: string;
        visibleReleases: FixtureRelease[];
      };
    }
  ).selectedDayScheduleView;
  assert.equal(typeof selectedDayScheduleView, "function");

  const overseasRaffle = fixture({
    id: "overseas-raffle",
    releaseKind: "raffle",
    category: "응모",
    marketScope: "overseas",
  });

  const overseasView = selectedDayScheduleView!(
    [overseasRaffle],
    "raffle",
    "general",
    true,
  );
  assert.equal(overseasView.showScheduleTabs, false);
  assert.equal(overseasView.effectiveMode, "overseas");
  assert.deepEqual(
    overseasView.visibleReleases.map(({ id }) => id),
    ["overseas-raffle"],
  );

  const normalView = selectedDayScheduleView!(
    [overseasRaffle],
    "raffle",
    "general",
    false,
  );
  assert.equal(normalView.showScheduleTabs, true);
  assert.equal(normalView.effectiveMode, "entry");
});

test("all schedule mode exposes general, raffle and overseas products in their source order", () => {
  const mixed = [
    ...Array.from({ length: 5 }, (_, index) => fixture({ id: `general-${index}` })),
    fixture({ id: "entry", category: "응모", releaseKind: "raffle" }),
    ...Array.from({ length: 3 }, (_, index) => fixture({ id: `overseas-${index}`, marketScope: "overseas" })),
  ];
  const view = releaseFilterModule.selectedDayScheduleView(mixed, "all", "all", false);
  assert.equal(view.effectiveMode, "all");
  assert.equal(view.showScheduleTabs, true);
  assert.deepEqual(view.visibleReleases.map(({ id }) => id), mixed.map(({ id }) => id));
  assert.equal(releaseFilterModule.releasesForScheduleMode(mixed, "general").length, 5);
  assert.equal(releaseFilterModule.releasesForScheduleMode(mixed, "entry").length, 1);
  assert.equal(releaseFilterModule.releasesForScheduleMode(mixed, "overseas").length, 3);
  assert.equal(mixed.length, 9);
});

test("an overseas-only date remains populated in the unscoped all schedule view", () => {
  const items = Array.from({ length: 18 }, (_, index) => fixture({ id: `overseas-${index}`, marketScope: "overseas" }));
  const view = releaseFilterModule.selectedDayScheduleView(items, "all", "all", false);
  assert.equal(view.visibleReleases.length, 18);
  assert.equal(view.effectiveMode, "all");
});

test("daily all schedule mode composes filters and retains the raffle override", () => {
  const items = [
    fixture({ id: "general", catalogCategory: "fashion" }),
    fixture({ id: "entry", category: "응모", releaseKind: "raffle" }),
    fixture({ id: "overseas", marketScope: "overseas" }),
  ];
  const all = releaseFilterModule.releaseScheduleView(items, "all", "all");
  assert.equal(all.count, 3);
  assert.deepEqual(all.visibleReleases.map(({ id }) => id), ["general", "entry", "overseas"]);
  const category = releaseFilterModule.releaseScheduleView(items, "sneakers", "all");
  assert.deepEqual(category.visibleReleases.map(({ id }) => id), ["entry", "overseas"]);
  const raffle = releaseFilterModule.releaseScheduleView(items, "raffle", "all");
  assert.equal(raffle.effectiveMode, "entry");
  assert.deepEqual(raffle.visibleReleases.map(({ id }) => id), ["entry"]);
});

test("selected-day empty copy distinguishes an empty date from active filters", () => {
  const selectedDayEmptyCopy = (
    releaseFilterModule as {
      selectedDayEmptyCopy?: (
        overseasOnly: boolean,
        activeFilter: string,
        query: string,
      ) => string;
    }
  ).selectedDayEmptyCopy;
  assert.equal(typeof selectedDayEmptyCopy, "function");

  assert.equal(
    selectedDayEmptyCopy!(false, "all", ""),
    "등록된 일정이 없습니다.",
  );
  assert.equal(
    selectedDayEmptyCopy!(false, "all", "   "),
    "등록된 일정이 없습니다.",
  );
  assert.equal(
    selectedDayEmptyCopy!(true, "all", ""),
    "선택한 필터 조건에 맞는 일정이 없습니다.",
  );
  assert.equal(
    selectedDayEmptyCopy!(false, "collab", ""),
    "선택한 필터 조건에 맞는 일정이 없습니다.",
  );
  assert.equal(
    selectedDayEmptyCopy!(false, "all", "Jordan"),
    "선택한 필터 조건에 맞는 일정이 없습니다.",
  );
});

test("raffle filter overrides a retained general mode with a non-empty entry panel", () => {
  const releaseScheduleView = (
    releaseFilterModule as {
      releaseScheduleView?: (
        releases: FixtureRelease[],
        filter: string,
        requestedMode: string,
      ) => {
        effectiveMode: string;
        count: number;
        visibleReleases: FixtureRelease[];
      };
    }
  ).releaseScheduleView;
  assert.equal(typeof releaseScheduleView, "function");

  const sameDay = [
    fixture({ id: "general", releaseKind: "general" }),
    fixture({
      id: "raffle",
      category: "응모",
      releaseKind: "raffle",
    }),
  ];

  const raffleState = releaseScheduleView!(
    sameDay,
    "raffle",
    "general",
  );
  assert.equal(raffleState.effectiveMode, "entry");
  assert.equal(raffleState.count, 1);
  assert.deepEqual(
    raffleState.visibleReleases.map((release) => release.id),
    ["raffle"],
  );

  const generalState = releaseScheduleView!(sameDay, "all", "general");
  assert.equal(generalState.effectiveMode, "general");
  assert.equal(generalState.count, 2);
  assert.deepEqual(
    generalState.visibleReleases.map((release) => release.id),
    ["general"],
  );
});

test("changed releases receive the schedule-change badge after their kind badge", () => {
  assert.deepEqual(
    releaseBadgeLabels(
      fixture({
        releaseKind: "collab",
        hasScheduleChange: true,
      }),
    ),
    ["COLLAB", "일정 변경"],
  );
  assert.deepEqual(
    releaseBadgeLabels(fixture({ releaseKind: "raffle" })),
    ["RAFFLE"],
  );
  assert.deepEqual(
    releaseBadgeLabels(fixture({ releaseKind: "offline" })),
    ["SEOUL ONLY"],
  );
});

test("featured collaborations exclude past releases and prioritize curated upcoming items", () => {
  const input = [
    fixture({
      id: "past-curated",
      title: "Past Curated",
      releaseKind: "collab",
      releaseDate: "2026-07-31",
      releaseTime: "09:00",
      isFeatured: true,
    }),
    fixture({
      id: "nearest-nonfeatured",
      title: "Nearest Nonfeatured",
      releaseKind: "collab",
      releaseDate: "2026-08-01",
    }),
    fixture({
      id: "later-curated",
      title: "Later Curated",
      releaseKind: "collab",
      releaseDate: "2026-08-03",
      releaseTime: "09:00",
      isFeatured: true,
    }),
    fixture({
      id: "beta-curated",
      title: "Beta",
      releaseKind: "collab",
      releaseDate: "2026-08-02",
      releaseTime: "11:00",
      isFeatured: true,
    }),
    fixture({
      id: "alpha-curated",
      title: "Alpha",
      releaseKind: "collab",
      releaseDate: "2026-08-02",
      releaseTime: "11:00",
      isFeatured: true,
    }),
    fixture({
      id: "general",
      title: "Not a collaboration",
      releaseKind: "general",
      releaseDate: "2026-08-01",
    }),
  ];

  assert.deepEqual(
    featuredCollaborationReleases(input, "2026-08-01").map(
      (release) => release.id,
    ),
    [
      "alpha-curated",
      "beta-curated",
      "later-curated",
      "nearest-nonfeatured",
    ],
  );
  assert.equal(input[0]?.id, "past-curated");
});

test("multi-retailer channel counts reflect every available release channel", () => {
  assert.equal(releaseChannelCount(fixture({ channels: [] })), 0);
  assert.equal(releaseChannelCount(fixture()), 1);
  assert.equal(
    releaseChannelCount(
      fixture({
        channels: [
          { sourceKey: "nike", retailer: "Nike SNKRS Korea" },
          { sourceKey: "tune", retailer: "TUNE" },
          { sourceKey: "kasina", retailer: "KASINA" },
        ],
      }),
    ),
    3,
  );
});

test("filter controls render semantic pressed buttons with Korean labels", () => {
  const ReleaseFilters = (
    releaseFilterModule as {
      ReleaseFilters?: ComponentType<{
        value: string;
        onChange: (value: string) => void;
        showOverseas?: boolean;
        overseasOnly?: boolean;
        onOverseasChange?: (value: boolean) => void;
      }>;
    }
  ).ReleaseFilters;
  assert.equal(typeof ReleaseFilters, "function");

  const baseMarkup = renderToStaticMarkup(
    createElement(ReleaseFilters!, {
      value: "collab",
      onChange: () => {},
    }),
  );

  assert.match(baseMarkup, /aria-label="발매 필터"/);
  assert.match(
    baseMarkup,
    /<button[^>]+type="button"[^>]+aria-pressed="true"[^>]*>협업<\/button>/,
  );
  for (const label of [
    "전체",
    "스니커즈",
    "패션",
    "라이프스타일",
    "협업",
    "응모",
  ]) {
    assert.match(baseMarkup, new RegExp(`>${label}</button>`));
  }
  assert.doesNotMatch(baseMarkup, />해외<\/button>/);

  const monthlyMarkup = renderToStaticMarkup(
    createElement(ReleaseFilters!, {
      value: "collab",
      onChange: () => {},
      showOverseas: true,
      overseasOnly: true,
      onOverseasChange: () => {},
    }),
  );

  assert.match(
    monthlyMarkup,
    /<button[^>]+type="button"[^>]+aria-pressed="true"[^>]*>해외<\/button>/,
  );
});

test("badge component renders the view-model labels as an accessible group", () => {
  const ReleaseBadges = (
    releaseBadgeModule as {
      ReleaseBadges?: ComponentType<{
        release: FixtureRelease;
      }>;
    }
  ).ReleaseBadges;
  assert.equal(typeof ReleaseBadges, "function");

  const markup = renderToStaticMarkup(
    createElement(ReleaseBadges!, {
      release: fixture({
        releaseKind: "collab",
        hasScheduleChange: true,
      }),
    }),
  );

  assert.match(markup, /aria-label="발매 특징"/);
  assert.match(markup, />COLLAB</);
  assert.match(markup, />일정 변경</);
});

test("raffle card 1888 shows its confirmed closing clock instead of the opening releaseTime", () => {
  assert.equal(releaseTimeLabel({category:"응모",releaseTime:"10:00",startAt:"2026-09-29T10:00:00+09:00",endAt:"2026-10-05T14:59:00+09:00"}), "마감 10/5 14:59");
  assert.equal(releaseTimeLabel({category:"응모",releaseTime:"10:00",endAt:"2026-10-05T05:59:00Z"}), "마감 10/5 14:59");
});

test("unknown endpoint clock times show their confirmed date without inventing midnight", () => {
  assert.equal(releaseTimeLabel({category:"응모",releaseTime:"10:00",endAt:"2026-10-05",endTimeUnknown:true}), "마감 10/5 시간 미정");
  assert.equal(releaseTimeLabel({category:"응모",releaseTime:"10:00",endAt:"2026-10-05T00:00:00+09:00",endTimeUnknown:true}), "마감 10/5 시간 미정");
  assert.equal(releaseTimeLabel({category:"선착순",releaseTime:null,startAt:"2026-09-29",startTimeUnknown:true}), "시작 9/29 시간 미정");
});

test("start-only cards use the actual opening time and invalid endpoints cannot fabricate a closing prefix", () => {
  assert.equal(releaseTimeLabel({category:"응모",releaseTime:"14:59",startAt:"2026-09-29T10:00:00+09:00"}), "시작 9/29 10:00");
  for (const endAt of [undefined,"invalid","2026-02-30T10:00:00+09:00","2026-10-05","2026-10-05T14:59:00"]) {
    assert.equal(releaseTimeLabel({category:"응모",releaseTime:"10:00",endAt}), "10:00");
  }
  assert.equal(releaseTimeLabel({category:"응모",releaseTime:null},"시간 미정"), "시간 미정");
});
