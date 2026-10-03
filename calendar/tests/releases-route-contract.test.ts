import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type {
  CachedRelease,
  CollectionRepository,
  ReleaseApiPayload,
  ReviewItem,
  SourceHealth,
} from "../app/collection/repository.ts";
import { readReleaseApiPayload } from "../app/collection/repository.ts";
import type {
  CollectionAttemptOutcome,
  CollectionSummary,
} from "../app/collection/run.ts";
import { featuredCollaborationReleases } from "../app/release-filters.tsx";

type PayloadRepository = CollectionRepository & {
  countPendingReviewItems(): Promise<number>;
  listPendingNikeMissingDateReviews(): Promise<ReviewItem[]>;
};

type ReleaseGetDependencies = {
  ensureCurrentSlotCollected(): Promise<CollectionAttemptOutcome>;
  readReleaseApiPayload(): Promise<ReleaseApiPayload>;
  configuredSourceKeys: readonly string[];
};

type ReleaseGetHandlerFactory = (
  dependencies: ReleaseGetDependencies,
) => () => Promise<Response>;

const releaseApiModule = await import(
  "../app/collection/release-api.ts"
).catch(() => ({}));
const routeSource = await readFile(
  new URL("../app/api/releases/route.ts", import.meta.url),
  "utf8",
);

function getHandlerFactory(): ReleaseGetHandlerFactory {
  const factory = (
    releaseApiModule as {
      createReleaseGetHandler?: ReleaseGetHandlerFactory;
    }
  ).createReleaseGetHandler;
  assert.equal(typeof factory, "function");
  return factory;
}

function fakeRepository(input: {
  releases?: CachedRelease[];
  sourceHealth?: SourceHealth[];
  pendingReviewCount?: number;
  nikeMissingDateReviews?: ReviewItem[];
}): PayloadRepository {
  return {
    async claimSlot() {
      throw new Error("not used");
    },
    async completeSlot() {
      throw new Error("not used");
    },
    async failSlot() {
      throw new Error("not used");
    },
    async listCachedReleases() {
      return input.releases ?? [];
    },
    async persistSourceResult() {
      throw new Error("not used");
    },
    async listSourceHealth() {
      return input.sourceHealth ?? [];
    },
    async listReviewItems() {
      throw new Error("GET payload must not materialize all review items");
    },
    async countPendingReviewItems() {
      return input.pendingReviewCount ?? 0;
    },
    async listPendingNikeMissingDateReviews() {
      return input.nikeMissingDateReviews ?? [];
    },
    async resolveReview() {
      throw new Error("not used");
    },
  };
}

const cachedRelease: CachedRelease = {
  id: "cached:style:nike-100",
  canonicalKey: "style:nike100",
  title: "Nike Cache Runner",
  brand: "NIKE",
  category: "sneakers",
  releaseKind: "collab",
  releaseDate: "2026-08-01",
  releaseTime: "10:00",
  changedAt: "2026-07-31T00:30:00.000Z",
  lastVerifiedAt: "2026-07-31T01:00:00.000Z",
  channels: [
    {
      sourceKey: "nike",
      retailer: "Nike SNKRS Korea",
      productUrl: "https://www.nike.com/kr/launch/t/cache-runner",
      sourceUrl: "https://www.nike.com/kr/launch/upcoming",
      priceLabel: "189,000원",
      releaseDate: "2026-08-01",
      releaseTime: "10:00",
    },
    {
      sourceKey: "tune",
      retailer: "TUNE",
      productUrl: "https://tune.kr/product/cache-runner",
      sourceUrl: "https://tune.kr",
      priceLabel: null,
      releaseDate: "2026-08-01",
      releaseTime: "11:00",
    },
  ],
};
const cachedApiRelease = {
  id: "cached-api-release",
} as ReleaseApiPayload["releases"][number];

const nikeUndatedRelease = {
  sourceKey: "nike",
  externalId: "nike-undated",
  title: "Nike Date Pending",
  brand: "NIKE",
  category: "sneakers",
  releaseKind: "general",
  releaseDate: "",
  releaseTime: null,
  priceLabel: "159,000원",
  styleCode: "NIKE-200",
  retailer: "Nike SNKRS Korea",
  productUrl: "https://www.nike.com/kr/launch/t/date-pending",
  sourceUrl: "https://www.nike.com/kr/launch/upcoming",
  collectedAt: "2026-07-31T01:00:00.000Z",
} as const;

function reviewItem(
  overrides: Partial<ReviewItem> = {},
): ReviewItem {
  return {
    id: 1,
    sourceKey: "nike",
    externalId: "nike-undated",
    reason: "missing_date",
    payloadJson: JSON.stringify({
      canonicalKey: "fallback:nike-date-pending",
      release: nikeUndatedRelease,
      channels: [nikeUndatedRelease],
      reviewReason: "missing_date",
    }),
    status: "pending",
    ...overrides,
  };
}

const asicsHealth: SourceHealth = {
  sourceKey: "asics",
  status: "error",
  lastSuccessAt: "2026-07-30T01:00:00.000Z",
  lastFailureAt: "2026-07-31T01:00:00.000Z",
  consecutiveFailures: 3,
  sourceCount: 9,
  newCount: 2,
  mergedCount: 3,
  reviewCount: 4,
  message: "ASICS unavailable",
};

function sourceDto(
  status: "connected" | "error" | "manual" | "unknown",
) {
  return {
    status,
    count: 0,
    message: status,
  };
}

function apiPayload(input: {
  releases?: ReleaseApiPayload["releases"];
  sources?: ReleaseApiPayload["sources"];
} = {}): ReleaseApiPayload {
  return {
    releases: input.releases ?? [],
    sources: input.sources ?? {
      database: sourceDto("connected"),
    },
    reviewCount: 0,
  };
}

const emptyCollectionSummary: CollectionSummary = {
  slotKey: "2026-07-31@09:30",
  sourcesRun: 0,
  sourcesSucceeded: 0,
  sourcesFailed: 0,
  releasesCollected: 0,
  reviewItemsCreated: 0,
};
const privateClaimToken = "0198e4a2-8d95-7a10-b123-456789abcdef";

function collectionAttempt(
  state: CollectionAttemptOutcome["state"],
): CollectionAttemptOutcome {
  return {
    state,
    summary: emptyCollectionSummary,
    claimToken: privateClaimToken,
  } as CollectionAttemptOutcome;
}

function assertNoInternalCollectionDetails(body: unknown): void {
  const serialized = JSON.stringify(body);
  for (const privateValue of [
    "claimToken",
    "slotKey",
    emptyCollectionSummary.slotKey,
    privateClaimToken,
  ]) {
    assert.equal(serialized.includes(privateValue), false, privateValue);
  }
}

async function responseBody(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

test("route delegates GET without individual source fetcher imports", () => {
  assert.match(routeSource, /releaseGetResponse/);
  assert.doesNotMatch(routeSource, /fetch[A-Z][A-Za-z]+Releases/);
});

test("payload projects explicit public DTOs and stable configured sources", async () => {
  const payload = await readReleaseApiPayload(
    fakeRepository({
      releases: [cachedRelease],
      sourceHealth: [asicsHealth],
      pendingReviewCount: 7,
      nikeMissingDateReviews: [
        reviewItem(),
        reviewItem({ id: 2, status: "approved" }),
        reviewItem({ id: 3, payloadJson: "{not-json" }),
        reviewItem({ id: 4, payloadJson: JSON.stringify({ release: null }) }),
      ],
    }),
    ["nike", "asics", "tune"],
  );

  assert.deepEqual(Object.keys(payload.sources), [
    "database",
    "nike",
    "asics",
    "tune",
  ]);
  assert.equal(payload.reviewCount, 7);
  assert.deepEqual(payload.sources.database, {
    status: "connected",
    count: 1,
    message: "Cached data",
  });
  assert.deepEqual(payload.sources.asics, {
    status: "error",
    count: 9,
    message: "ASICS unavailable",
    sourceUrl: "https://www.asics.co.kr/board/?id=spscalendar",
  });
  assert.deepEqual(payload.sources.tune, {
    status: "unknown",
    count: 0,
    message: "Collection has not run yet.",
    sourceUrl: "https://tune.kr",
  });
  assert.deepEqual(payload.sources.nike, {
    status: "unknown",
    count: 0,
    message: "Collection has not run yet.",
    sourceUrl: "https://www.nike.com/kr/launch/upcoming",
    undated: [
      {
        id: "nike-undated",
        title: "Nike Date Pending",
        sourceUrl: "https://www.nike.com/kr/launch/upcoming",
        note: "발매일 확인 필요",
        brand: "NIKE",
        priceLabel: "159,000원",
        styleCode: "NIKE-200",
        productUrl: "https://www.nike.com/kr/launch/t/date-pending",
      },
    ],
  });

  assert.deepEqual(payload.releases, [
    {
      id: "cached:style:nike-100",
      title: "Nike Cache Runner",
      brand: "NIKE",
      category: "선착순",
      catalogCategory: "sneakers",
      releaseKind: "collab",
      releaseDate: "2026-08-01",
      releaseTime: "10:00",
      hasScheduleChange: true,
      lastVerifiedLabel: "2026.07.31 10:00 KST",
      channels: cachedRelease.channels,
      channel: "Nike SNKRS Korea",
      sourceName: "nike",
      sourceUrl: "https://www.nike.com/kr/launch/upcoming",
      status: "예정",
      confidence: 100,
      note: "",
      isFeatured: true,
      retailer: "Nike SNKRS Korea",
      releaseMethod: null,
      priceLabel: "189,000원",
      productUrl: "https://www.nike.com/kr/launch/t/cache-runner",
    },
  ]);

  const releaseSerialized = JSON.stringify(payload.releases);
  for (const privateField of [
    "canonicalKey",
    "changedAt",
    "lastVerifiedAt",
  ]) {
    assert.equal(releaseSerialized.includes(`"${privateField}"`), false);
  }
  const sourcesSerialized = JSON.stringify(payload.sources);
  for (const privateField of [
    "lastSuccessAt",
    "lastFailureAt",
    "consecutiveFailures",
    "sourceCount",
    "newCount",
    "mergedCount",
    "reviewCount",
  ]) {
    assert.equal(sourcesSerialized.includes(`"${privateField}"`), false);
  }
});

test("cached multi-retailer confirmation drives reachable featured ordering", async () => {
  const singleChannel: CachedRelease = {
    ...cachedRelease,
    id: "cached:single-channel",
    title: "Nearest Single Channel",
    releaseDate: "2026-08-01",
    channels: [cachedRelease.channels[0]!],
  };
  const duplicateSourceListings: CachedRelease = {
    ...cachedRelease,
    id: "cached:duplicate-source",
    title: "Duplicate Source Listings",
    releaseDate: "2026-08-02",
    channels: [
      cachedRelease.channels[0]!,
      {
        ...cachedRelease.channels[0]!,
        productUrl: "https://www.nike.com/kr/launch/t/cache-runner-alt",
      },
    ],
  };
  const multiRetailer: CachedRelease = {
    ...cachedRelease,
    id: "cached:multi-retailer",
    title: "Later Multi Retailer",
    releaseDate: "2026-08-03",
  };

  const payload = await readReleaseApiPayload(
    fakeRepository({
      releases: [singleChannel, duplicateSourceListings, multiRetailer],
    }),
    ["nike", "tune"],
  );

  assert.deepEqual(
    payload.releases.map(({ id, isFeatured }) => ({ id, isFeatured })),
    [
      { id: "cached:single-channel", isFeatured: false },
      { id: "cached:duplicate-source", isFeatured: false },
      { id: "cached:multi-retailer", isFeatured: true },
    ],
  );
  assert.deepEqual(
    featuredCollaborationReleases(payload.releases, "2026-08-01").map(
      ({ id }) => id,
    ),
    [
      "cached:multi-retailer",
      "cached:single-channel",
      "cached:duplicate-source",
    ],
  );
});

test("payload nulls unsafe cached and pending-review retailer URLs", async () => {
  const unsafeCachedRelease: CachedRelease = {
    ...cachedRelease,
    id: "cached:unsafe-links",
    channels: [
      {
        ...cachedRelease.channels[0]!,
        productUrl: "javascript:alert(1)",
        sourceUrl: "https://nike.com.evil.test/launch",
      },
    ],
  };
  const unsafeUndated = {
    ...nikeUndatedRelease,
    productUrl: "data:text/html,unsafe",
    sourceUrl: "https://user:pass@www.nike.com/kr/launch",
  };
  const payload = await readReleaseApiPayload(
    fakeRepository({
      releases: [unsafeCachedRelease],
      nikeMissingDateReviews: [
        reviewItem({
          payloadJson: JSON.stringify({
            canonicalKey: "fallback:nike-date-pending",
            release: unsafeUndated,
            channels: [unsafeUndated],
            reviewReason: "missing_date",
          }),
        }),
      ],
    }),
    ["nike"],
  );

  assert.equal(payload.releases[0]?.productUrl, null);
  assert.equal(payload.releases[0]?.sourceUrl, null);
  assert.equal(payload.releases[0]?.channels[0]?.productUrl, null);
  assert.equal(payload.releases[0]?.channels[0]?.sourceUrl, null);
  assert.equal(payload.releases[0]?.retailer, "Nike SNKRS Korea");
  assert.equal(payload.sources.nike?.undated?.[0]?.productUrl, null);
  assert.equal(payload.sources.nike?.undated?.[0]?.sourceUrl, null);
});

test("GET reports an active slot as stale when cache exists", async () => {
  const response = await getHandlerFactory()({
    ensureCurrentSlotCollected: async () => collectionAttempt("in_progress"),
    readReleaseApiPayload: async () =>
      apiPayload({ releases: [cachedApiRelease] }),
    configuredSourceKeys: ["nike"],
  })();
  const body = await responseBody(response);

  assert.equal(response.status, 200);
  assert.deepEqual(body.collection, {
    status: "stale",
    message: "Release collection is currently in progress.",
  });
  assertNoInternalCollectionDetails(body);
});

test("GET reports an active slot as unavailable when cache is empty", async () => {
  const response = await getHandlerFactory()({
    ensureCurrentSlotCollected: async () => collectionAttempt("in_progress"),
    readReleaseApiPayload: async () => apiPayload(),
    configuredSourceKeys: ["nike"],
  })();
  const body = await responseBody(response);

  assert.equal(response.status, 503);
  assert.deepEqual(body.collection, {
    status: "failed",
    message: "Release collection is currently in progress.",
  });
  assertNoInternalCollectionDetails(body);
});

test("GET reports a failed slot as stale when cache exists", async () => {
  const response = await getHandlerFactory()({
    ensureCurrentSlotCollected: async () => collectionAttempt("failed"),
    readReleaseApiPayload: async () =>
      apiPayload({ releases: [cachedApiRelease] }),
    configuredSourceKeys: ["nike"],
  })();
  const body = await responseBody(response);

  assert.equal(response.status, 200);
  assert.deepEqual(body.collection, {
    status: "stale",
    message: "Release collection is temporarily unavailable.",
  });
  assertNoInternalCollectionDetails(body);
});

test("GET reports a failed slot as unavailable when cache is empty", async () => {
  const response = await getHandlerFactory()({
    ensureCurrentSlotCollected: async () => collectionAttempt("failed"),
    readReleaseApiPayload: async () => apiPayload(),
    configuredSourceKeys: ["nike"],
  })();
  const body = await responseBody(response);

  assert.equal(response.status, 503);
  assert.deepEqual(body.collection, {
    status: "failed",
    message: "Release collection is temporarily unavailable.",
  });
  assertNoInternalCollectionDetails(body);
});

test("GET returns stale cache with sanitized collection error context", async () => {
  const handler = getHandlerFactory()({
    ensureCurrentSlotCollected: async () => {
      throw new Error("secret D1 query and source URL");
    },
    readReleaseApiPayload: async () =>
      apiPayload({
        releases: [
          {
            id: "cached",
          } as ReleaseApiPayload["releases"][number],
        ],
      }),
    configuredSourceKeys: ["nike", "asics"],
  });

  const response = await handler();
  const body = await responseBody(response);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, max-age=60");
  assert.deepEqual(body.collection, {
    status: "stale",
    message: "Release collection is temporarily unavailable.",
  });
  assert.equal(JSON.stringify(body).includes("secret D1"), false);
});

test("GET retains a thrown timeout only as sanitized public context", async () => {
  const timeout = new Error("private upstream host timed out");
  timeout.name = "TimeoutError";
  const handler = getHandlerFactory()({
    ensureCurrentSlotCollected: async () => {
      throw timeout;
    },
    readReleaseApiPayload: async () =>
      apiPayload({
        releases: [
          {
            id: "cached",
          } as ReleaseApiPayload["releases"][number],
        ],
      }),
    configuredSourceKeys: ["nike"],
  });

  const response = await handler();
  const body = await responseBody(response);

  assert.equal(response.status, 200);
  assert.deepEqual(body.collection, {
    status: "stale",
    message: "Release collection timed out.",
  });
  assert.equal(JSON.stringify(body).includes("upstream host"), false);
});

test("GET returns 503 when collection throws before an empty cache has health", async () => {
  const handler = getHandlerFactory()({
    ensureCurrentSlotCollected: async () => {
      throw "private failure";
    },
    readReleaseApiPayload: async () => apiPayload(),
    configuredSourceKeys: ["nike", "asics"],
  });

  const response = await handler();
  const body = await responseBody(response);

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "private, max-age=60");
  assert.deepEqual(body.collection, {
    status: "failed",
    message: "Release collection is temporarily unavailable.",
  });
  assert.equal(JSON.stringify(body).includes("private failure"), false);
});

test("GET uses every authoritative configured source for 503 decisions", async () => {
  const cases: {
    name: string;
    configuredSourceKeys: string[];
    sources: ReleaseApiPayload["sources"];
    expected: number;
  }[] = [
    {
      name: "zero configured sources",
      configuredSourceKeys: [],
      sources: { database: sourceDto("connected") },
      expected: 200,
    },
    {
      name: "one error with another configured source missing",
      configuredSourceKeys: ["nike", "asics"],
      sources: {
        database: sourceDto("connected"),
        nike: sourceDto("error"),
      },
      expected: 200,
    },
    {
      name: "manual source",
      configuredSourceKeys: ["nike", "asics"],
      sources: {
        database: sourceDto("connected"),
        nike: sourceDto("error"),
        asics: sourceDto("manual"),
      },
      expected: 200,
    },
    {
      name: "mixed connected and error sources",
      configuredSourceKeys: ["nike", "asics"],
      sources: {
        database: sourceDto("connected"),
        nike: sourceDto("error"),
        asics: sourceDto("connected"),
      },
      expected: 200,
    },
    {
      name: "all configured sources errored",
      configuredSourceKeys: ["nike", "asics"],
      sources: {
        database: sourceDto("connected"),
        nike: sourceDto("error"),
        asics: sourceDto("error"),
      },
      expected: 503,
    },
  ];

  for (const fixture of cases) {
    const handler = getHandlerFactory()({
      ensureCurrentSlotCollected: async () => collectionAttempt("current"),
      readReleaseApiPayload: async () =>
        apiPayload({ sources: fixture.sources }),
      configuredSourceKeys: fixture.configuredSourceKeys,
    });

    const response = await handler();
    assert.equal(response.status, fixture.expected, fixture.name);
    assert.equal(
      response.headers.get("Cache-Control"),
      "private, max-age=60",
      fixture.name,
    );
  }
});

test("GET marks a successful current read explicitly", async () => {
  const handler = getHandlerFactory()({
    ensureCurrentSlotCollected: async () => collectionAttempt("current"),
    readReleaseApiPayload: async () => apiPayload(),
    configuredSourceKeys: ["nike"],
  });

  const response = await handler();
  const body = await responseBody(response);

  assert.equal(response.status, 200);
  assert.deepEqual(body.collection, {
    status: "current",
    message: null,
  });
  assertNoInternalCollectionDetails(body);
});

test("unexpected cache read failures return sanitized no-store 500", async () => {
  const handler = getHandlerFactory()({
    ensureCurrentSlotCollected: async () => collectionAttempt("current"),
    readReleaseApiPayload: async () => {
      throw new Error("select secret from release_catalog");
    },
    configuredSourceKeys: ["nike"],
  });

  const response = await handler();
  const body = await responseBody(response);

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(body, {
    error: "Release cache is temporarily unavailable.",
  });
});
