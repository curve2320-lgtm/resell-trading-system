import assert from "node:assert/strict";
import test from "node:test";
import {
  runCollection,
  runSourceCollection,
} from "../app/collection/run.ts";
import {
  createExistingAdapter,
  type ExistingSourceFetchResult,
} from "../app/collection/existing-adapters.ts";
import type {
  CachedRelease,
  CollectionRepository,
  PersistSourceOutcome,
  PersistSourceResult,
  ResolveReviewInput,
  ReviewItem,
  SlotClaimOutcome,
  SourceHealth,
} from "../app/collection/repository.ts";
import type {
  ReleaseSourceAdapter,
  SourceCollectionResult,
} from "../app/collection/registry.ts";
import type { AdapterReleaseInput } from "../app/collection/types.ts";

const now = new Date("2026-07-31T01:00:00.000Z");
const expectedSlotKey = "2026-07-31@09:30";

function adapterRelease(
  sourceKey: string,
  overrides: Partial<AdapterReleaseInput> = {},
): AdapterReleaseInput {
  return {
    sourceKey,
    externalId: `${sourceKey}-release`,
    title: `${sourceKey} release`,
    brand: "Example",
    releaseDate: "2026-08-01",
    releaseTime: "10:00",
    priceLabel: null,
    styleCode: `${sourceKey}-100`,
    retailer: `${sourceKey} store`,
    productUrl: `https://${sourceKey}.example/products/release`,
    sourceUrl: `https://${sourceKey}.example/calendar`,
    collectedAt: now.toISOString(),
    allowedDomains: [`${sourceKey}.example`],
    ...overrides,
  };
}

function collectionResult(
  sourceKey: string,
  overrides: Partial<SourceCollectionResult> = {},
): SourceCollectionResult {
  return {
    sourceKey,
    status: "connected",
    releases: [adapterRelease(sourceKey)],
    message: `${sourceKey} connected`,
    confirmedEmpty: false,
    ...overrides,
  };
}

function adapter(
  key: string,
  collect: ReleaseSourceAdapter["collect"] = async () => collectionResult(key),
): ReleaseSourceAdapter {
  return {
    key,
    retailer: `${key} store`,
    allowedDomains: [`${key}.example`],
    collect,
  };
}

class RecordingRepository implements CollectionRepository {
  readonly claimedSlots = new Set<string>();
  readonly claimTokens = new Map<string, string>();
  readonly claimCalls: Array<{
    slotKey: string;
    startedAt: string;
    claimToken: string;
    staleBefore: string;
  }> = [];
  readonly persisted: PersistSourceResult[] = [];
  readonly terminal: Array<{ status: "completed" | "failed"; slotKey: string }> =
    [];
  readonly terminalAttempts: Array<{
    status: "completed" | "failed";
    claimToken: string;
  }> = [];
  readonly terminalTokens: string[] = [];
  readonly cached: CachedRelease[] = [];
  claimOutcome?: SlotClaimOutcome;
  rejectPersistenceFor = new Set<string>();
  reviewItemsCreatedBySource = new Map<string, number>();

  async claimSlot(
    slotKey: string,
    startedAt: string,
    claimToken: string,
    staleBefore: string,
  ): Promise<SlotClaimOutcome> {
    this.claimCalls.push({ slotKey, startedAt, claimToken, staleBefore });
    if (this.claimOutcome) {
      if (this.claimOutcome.state === "claimed") {
        this.claimedSlots.add(slotKey);
        this.claimTokens.set(slotKey, this.claimOutcome.claimToken);
      }
      return this.claimOutcome;
    }
    if (this.claimedSlots.has(slotKey)) return { state: "in_progress" };
    this.claimedSlots.add(slotKey);
    this.claimTokens.set(slotKey, claimToken);
    return { state: "claimed", claimToken, reclaimed: false };
  }

  async completeSlot(
    slotKey: string,
    claimToken: string,
    _completedAt: string,
  ): Promise<boolean> {
    this.terminalAttempts.push({ status: "completed", claimToken });
    if (this.claimTokens.get(slotKey) !== claimToken) return false;
    this.terminal.push({ status: "completed", slotKey });
    this.terminalTokens.push(claimToken);
    this.claimTokens.delete(slotKey);
    return true;
  }

  async failSlot(
    slotKey: string,
    claimToken: string,
    _completedAt: string,
  ): Promise<boolean> {
    this.terminalAttempts.push({ status: "failed", claimToken });
    if (this.claimTokens.get(slotKey) !== claimToken) return false;
    this.terminal.push({ status: "failed", slotKey });
    this.terminalTokens.push(claimToken);
    this.claimTokens.delete(slotKey);
    return true;
  }

  replaceClaimOwner(slotKey: string, claimToken: string): void {
    this.claimTokens.set(slotKey, claimToken);
  }

  async listCachedReleases(): Promise<CachedRelease[]> {
    return this.cached;
  }

  async persistSourceResult(
    result: PersistSourceResult,
  ): Promise<PersistSourceOutcome> {
    if (this.rejectPersistenceFor.has(result.sourceKey)) {
      throw new Error(`persist ${result.sourceKey} failed`);
    }
    this.persisted.push(result);
    return {
      reviewItemsCreated:
        this.reviewItemsCreatedBySource.get(result.sourceKey) ??
        result.groups.filter(({ reviewReason }) => reviewReason !== null).length,
    };
  }

  async listSourceHealth(): Promise<SourceHealth[]> {
    return [];
  }

  async listReviewItems(): Promise<ReviewItem[]> {
    return [];
  }

  async countPendingReviewItems(): Promise<number> {
    return 0;
  }

  async listPendingNikeMissingDateReviews(): Promise<ReviewItem[]> {
    return [];
  }

  async resolveReview(_input: ResolveReviewInput): Promise<void> {}
}

test("non-claimed slot outcomes skip adapters and preserve typed state", async () => {
  const cases: Array<{
    claim: SlotClaimOutcome;
    expectedState: "current" | "in_progress" | "failed";
  }> = [
    { claim: { state: "in_progress" }, expectedState: "in_progress" },
    { claim: { state: "completed" }, expectedState: "current" },
    { claim: { state: "failed" }, expectedState: "failed" },
  ];

  for (const fixture of cases) {
    const repository = new RecordingRepository();
    repository.claimOutcome = fixture.claim;
    let adapterCalls = 0;

    const result = await runCollection({
      repository,
      adapters: [
        adapter("alpha", async () => {
          adapterCalls += 1;
          return collectionResult("alpha");
        }),
      ],
      now,
      randomUUID: () => "candidate-owner",
    });

    assert.equal(result.state, fixture.expectedState);
    assert.deepEqual(result.summary, {
      slotKey: expectedSlotKey,
      sourcesRun: 0,
      sourcesSucceeded: 0,
      sourcesFailed: 0,
      releasesCollected: 0,
      reviewItemsCreated: 0,
    });
    assert.equal(adapterCalls, 0);
    assert.equal(repository.persisted.length, 0);
    assert.equal(repository.terminal.length, 0);
  }
});

test("a scheduled claim uses an injected UUID and an exact fifteen-minute cutoff", async () => {
  const repository = new RecordingRepository();

  const result = await runCollection({
    repository,
    adapters: [adapter("alpha")],
    now,
    randomUUID: () => "scheduled-owner",
  });

  assert.equal(result.state, "current");
  assert.deepEqual(repository.claimCalls, [
    {
      slotKey: expectedSlotKey,
      startedAt: "2026-07-31T01:00:00.000Z",
      claimToken: "scheduled-owner",
      staleBefore: "2026-07-31T00:45:00.000Z",
    },
  ]);
  assert.deepEqual(repository.terminalTokens, ["scheduled-owner"]);
});

test("a scheduled claim can generate its default UUID token", async () => {
  const repository = new RecordingRepository();

  const result = await runCollection({
    repository,
    adapters: [adapter("alpha")],
    now,
  });

  assert.equal(result.state, "current");
  assert.match(
    repository.claimCalls[0]?.claimToken ?? "",
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.deepEqual(repository.terminalTokens, [
    repository.claimCalls[0]?.claimToken,
  ]);
});

test("a reclaimed owner completes with the repository-issued token", async () => {
  const repository = new RecordingRepository();
  repository.claimOutcome = {
    state: "claimed",
    claimToken: "reclaimed-owner",
    reclaimed: true,
  };

  const result = await runCollection({
    repository,
    adapters: [adapter("alpha")],
    now,
    randomUUID: () => "candidate-owner",
  });

  assert.equal(result.state, "current");
  assert.deepEqual(repository.terminalTokens, ["reclaimed-owner"]);
});

test("a collection that loses ownership before completion reports in progress", async () => {
  const repository = new RecordingRepository();
  const result = await runCollection({
    repository,
    adapters: [
      adapter("alpha", async () => {
        repository.replaceClaimOwner(expectedSlotKey, "new-owner");
        return collectionResult("alpha");
      }),
    ],
    now,
    randomUUID: () => "old-owner",
  });

  assert.equal(result.state, "in_progress");
  assert.equal(result.summary.sourcesSucceeded, 1);
  assert.deepEqual(repository.terminalAttempts, [
    { status: "completed", claimToken: "old-owner" },
  ]);
  assert.deepEqual(repository.terminal, []);
});

test("a collection that loses ownership before failure reports in progress", async () => {
  const repository = new RecordingRepository();
  const result = await runCollection({
    repository,
    adapters: [
      adapter("alpha", async () => {
        repository.replaceClaimOwner(expectedSlotKey, "new-owner");
        throw new Error("old owner failed");
      }),
    ],
    now,
    randomUUID: () => "old-owner",
  });

  assert.equal(result.state, "in_progress");
  assert.equal(result.summary.sourcesFailed, 1);
  assert.deepEqual(repository.terminalAttempts, [
    { status: "failed", claimToken: "old-owner" },
  ]);
  assert.deepEqual(repository.terminal, []);
});

test("two successful adapters both persist before the slot completes", async () => {
  const repository = new RecordingRepository();

  const { summary } = await runCollection({
    repository,
    adapters: [adapter("alpha"), adapter("beta")],
    now,
  });

  assert.deepEqual(
    repository.persisted.map(({ sourceKey }) => sourceKey).sort(),
    ["alpha", "beta"],
  );
  assert.deepEqual(repository.terminal, [
    { status: "completed", slotKey: expectedSlotKey },
  ]);
  assert.deepEqual(summary, {
    slotKey: expectedSlotKey,
    sourcesRun: 2,
    sourcesSucceeded: 2,
    sourcesFailed: 0,
    releasesCollected: 2,
    reviewItemsCreated: 0,
  });
});

test("cross-source schedule conflicts enter review before persistence", async () => {
  const repository = new RecordingRepository();
  const sharedRelease = {
    title: "Shared official release",
    brand: "Example",
    styleCode: "SHARED-100",
  };

  const { summary } = await runCollection({
    repository,
    adapters: [
      adapter("alpha", async () =>
        collectionResult("alpha", {
          releases: [
            adapterRelease("alpha", {
              ...sharedRelease,
              releaseDate: "2026-08-01",
            }),
          ],
        }),
      ),
      adapter("beta", async () =>
        collectionResult("beta", {
          releases: [
            adapterRelease("beta", {
              ...sharedRelease,
              releaseDate: "2026-08-02",
            }),
          ],
        }),
      ),
    ],
    now,
  });

  assert.deepEqual(
    repository.persisted.flatMap(({ sourceKey, groups }) =>
      groups.map(({ canonicalKey, release, channels, reviewReason }) => ({
        sourceKey,
        externalId: release.externalId,
        canonicalKey,
        channelIdentities: channels.map((channel) =>
          `${channel.sourceKey}:${channel.externalId}`
        ),
        reviewReason,
      })),
    ),
    [
      {
        sourceKey: "alpha",
        externalId: "alpha-release",
        canonicalKey: "style:shared100",
        channelIdentities: ["alpha:alpha-release"],
        reviewReason: "conflicting_schedule",
      },
      {
        sourceKey: "beta",
        externalId: "beta-release",
        canonicalKey: "style:shared100",
        channelIdentities: ["beta:beta-release"],
        reviewReason: "conflicting_schedule",
      },
    ],
  );
  assert.equal(summary.reviewItemsCreated, 2);
});

test("cross-source conflicts use raw classified rows before local grouping", async () => {
  const repository = new RecordingRepository();
  const { summary } = await runCollection({
    repository,
    adapters: [
      adapter("alpha", async () =>
        collectionResult("alpha", {
          releases: [
            adapterRelease("alpha", {
              externalId: "alpha-exact",
              title: "Shared Release",
              brand: "Example",
              styleCode: null,
              releaseTime: "10:00",
            }),
            adapterRelease("alpha", {
              externalId: "alpha-fuzzy",
              title: "Shared Release Premium",
              brand: "Example",
              styleCode: null,
              releaseTime: "10:00",
            }),
          ],
        }),
      ),
      adapter("beta", async () =>
        collectionResult("beta", {
          releases: [
            adapterRelease("beta", {
              externalId: "beta-exact",
              title: "Shared Release",
              brand: "Example",
              styleCode: null,
              releaseTime: "11:00",
            }),
          ],
        }),
      ),
    ],
    now,
  });

  assert.deepEqual(
    repository.persisted
      .flatMap(({ sourceKey, groups }) =>
        groups.map(({ release, reviewReason }) => ({
          sourceKey,
          externalId: release.externalId,
          reviewReason,
        })),
      )
      .sort((left, right) =>
        `${left.sourceKey}:${left.externalId}`.localeCompare(
          `${right.sourceKey}:${right.externalId}`,
        )
      ),
    [
      {
        sourceKey: "alpha",
        externalId: "alpha-exact",
        reviewReason: "conflicting_schedule",
      },
      {
        sourceKey: "alpha",
        externalId: "alpha-fuzzy",
        reviewReason: "possible_duplicate",
      },
      {
        sourceKey: "beta",
        externalId: "beta-exact",
        reviewReason: "conflicting_schedule",
      },
    ],
  );
  assert.equal(summary.reviewItemsCreated, 3);
});

test("a rejected adapter records failure while another source persists", async () => {
  const repository = new RecordingRepository();

  const { summary } = await runCollection({
    repository,
    adapters: [
      adapter("good"),
      adapter("broken", async () => {
        throw new Error("upstream unavailable");
      }),
    ],
    now,
  });

  const failure = repository.persisted.find(
    ({ sourceKey }) => sourceKey === "broken",
  );
  assert.deepEqual(failure, {
    sourceKey: "broken",
    status: "error",
    groups: [],
    collectedAt: now.toISOString(),
    message: "upstream unavailable",
    confirmedEmpty: false,
  });
  assert.equal(
    repository.persisted.some(({ sourceKey }) => sourceKey === "good"),
    true,
  );
  assert.deepEqual(repository.terminal, [
    { status: "completed", slotKey: expectedSlotKey },
  ]);
  assert.equal(summary.sourcesSucceeded, 1);
  assert.equal(summary.sourcesFailed, 1);
});

test("a rejected object preserves its string message", async () => {
  const repository = new RecordingRepository();

  await runCollection({
    repository,
    adapters: [
      adapter("structured", async () =>
        Promise.reject({ message: "structured upstream failure", code: 503 }),
      ),
    ],
    now,
  });

  assert.equal(
    repository.persisted[0]?.message,
    "structured upstream failure",
  );
});

test("a fulfilled adapter preparation error is persisted without blocking terminal state", async () => {
  const repository = new RecordingRepository();
  const malformed = adapterRelease("malformed");
  Object.defineProperty(malformed, "releaseDate", {
    enumerable: true,
    get() {
      throw new Error("prepare failed");
    },
  });

  const { summary } = await runCollection({
    repository,
    adapters: [
      adapter("good"),
      adapter("malformed", async () =>
        collectionResult("malformed", { releases: [malformed] }),
      ),
    ],
    now,
  });

  assert.deepEqual(
    repository.persisted.map(({ sourceKey, status, message }) => ({
      sourceKey,
      status,
      message,
    })),
    [
      {
        sourceKey: "good",
        status: "connected",
        message: "good connected",
      },
      {
        sourceKey: "malformed",
        status: "error",
        message: "prepare failed",
      },
    ],
  );
  assert.deepEqual(repository.terminal, [
    { status: "completed", slotKey: expectedSlotKey },
  ]);
  assert.equal(summary.sourcesSucceeded, 1);
  assert.equal(summary.sourcesFailed, 1);
});

test("concurrent calls for the same slot run adapters only once", async () => {
  const repository = new RecordingRepository();
  let collectCalls = 0;
  let releaseCollection!: () => void;
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  const blocked = adapter("alpha", async () => {
    collectCalls += 1;
    signalStarted();
    await new Promise<void>((resolve) => {
      releaseCollection = resolve;
    });
    return collectionResult("alpha");
  });

  const first = runCollection({ repository, adapters: [blocked], now });
  await started;
  const second = runCollection({ repository, adapters: [blocked], now });
  releaseCollection();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(collectCalls, 1);
  assert.equal(firstResult.state, "current");
  assert.equal(firstResult.summary.sourcesRun, 1);
  assert.equal(secondResult.state, "in_progress");
  assert.equal(secondResult.summary.sourcesRun, 0);
  assert.equal(repository.persisted.length, 1);
});

test("a total adapter failure preserves cached data and fails the slot", async () => {
  const repository = new RecordingRepository();
  repository.cached.push({
    id: "cached",
    canonicalKey: "style:cached",
    title: "Cached release",
    brand: "Example",
    category: "sneakers",
    releaseKind: "general",
    releaseDate: "2026-08-01",
    releaseTime: null,
    changedAt: null,
    lastVerifiedAt: "2026-07-30T00:00:00.000Z",
    channels: [],
  });

  const result = await runCollection({
    repository,
    adapters: [
      adapter("alpha", async () => {
        throw new Error("alpha failed");
      }),
      adapter("beta", async () =>
        collectionResult("beta", {
          status: "error",
          releases: [],
          message: "beta failed",
        }),
      ),
    ],
    now,
  });

  assert.equal((await repository.listCachedReleases())[0]?.id, "cached");
  assert.equal(
    repository.persisted.every(({ status, groups }) => {
      return status === "error" && groups.length === 0;
    }),
    true,
  );
  assert.deepEqual(repository.terminal, [
    { status: "failed", slotKey: expectedSlotKey },
  ]);
  assert.equal(result.state, "failed");
  assert.equal(result.summary.sourcesSucceeded, 0);
  assert.equal(result.summary.sourcesFailed, 2);
});

test("source persistence failures do not prevent another source from persisting", async () => {
  const repository = new RecordingRepository();
  repository.rejectPersistenceFor.add("alpha");

  const { summary } = await runCollection({
    repository,
    adapters: [adapter("alpha"), adapter("beta")],
    now,
  });

  assert.deepEqual(
    repository.persisted.map(({ sourceKey }) => sourceKey),
    ["beta"],
  );
  assert.deepEqual(repository.terminal, [
    { status: "completed", slotKey: expectedSlotKey },
  ]);
  assert.equal(summary.sourcesSucceeded, 1);
  assert.equal(summary.sourcesFailed, 1);
});

test("total persistence failure settles every source, fails the slot, and surfaces the outage", async () => {
  const repository = new RecordingRepository();
  repository.rejectPersistenceFor.add("alpha");
  repository.rejectPersistenceFor.add("beta");

  await assert.rejects(
    runCollection({
      repository,
      adapters: [adapter("alpha"), adapter("beta")],
      now,
    }),
    /persist alpha failed/,
  );

  assert.equal(repository.persisted.length, 0);
  assert.deepEqual(repository.terminal, [
    { status: "failed", slotKey: expectedSlotKey },
  ]);
});

test("collection summary uses confirmed review insert outcomes", async () => {
  const repository = new RecordingRepository();
  repository.reviewItemsCreatedBySource.set("alpha", 0);
  const reviewCandidate = adapter("alpha", async () =>
    collectionResult("alpha", {
      releases: [adapterRelease("alpha", { releaseDate: "" })],
    }),
  );

  const { summary } = await runCollection({
    repository,
    adapters: [reviewCandidate],
    now,
  });

  assert.equal(repository.persisted[0]?.groups[0]?.reviewReason, "missing_date");
  assert.equal(summary.reviewItemsCreated, 0);
});

test("adapter key and domains override spoofed result declarations", async () => {
  const repository = new RecordingRepository();
  const authoritative = adapter("official", async () =>
    collectionResult("spoofed", {
      releases: [
        adapterRelease("spoofed", {
          productUrl: "https://official.example/products/release",
          sourceUrl: "https://official.example/calendar",
          allowedDomains: ["attacker.example"],
        }),
      ],
    }),
  );

  const { summary } = await runCollection({
    repository,
    adapters: [authoritative],
    now,
  });

  assert.equal(repository.persisted[0]?.sourceKey, "official");
  assert.equal(repository.persisted[0]?.groups[0]?.release.sourceKey, "official");
  assert.equal(repository.persisted[0]?.groups[0]?.reviewReason, null);
  assert.equal(summary.reviewItemsCreated, 0);
});

test("dated review candidates keep the stable style identity", async () => {
  const repository = new RecordingRepository();
  const authoritative = adapter("official", async () =>
    collectionResult("official", {
      releases: [
        adapterRelease("official", {
          productUrl: "https://attacker.example/products/release",
        }),
      ],
    }),
  );

  await runCollection({
    repository,
    adapters: [authoritative],
    now,
  });

  assert.equal(
    repository.persisted[0]?.groups[0]?.canonicalKey,
    "style:official100",
  );
  assert.equal(
    repository.persisted[0]?.groups[0]?.reviewReason,
    "invalid_source_url",
  );
});

test("a source-specific manual run executes only the requested adapter", async () => {
  const repository = new RecordingRepository();
  const calls = { alpha: 0, beta: 0 };
  const adapters = [
    adapter("alpha", async () => {
      calls.alpha += 1;
      return collectionResult("alpha");
    }),
    adapter("beta", async () => {
      calls.beta += 1;
      return collectionResult("beta");
    }),
  ];

  const summary = await runSourceCollection({
    repository,
    adapters,
    sourceKey: "beta",
    now,
    randomUUID: () => "manual-run",
  });

  assert.deepEqual(calls, { alpha: 0, beta: 1 });
  assert.equal(
    summary.slotKey,
    `manual:beta:${now.toISOString()}:manual-run`,
  );
  assert.deepEqual(
    repository.persisted.map(({ sourceKey }) => sourceKey),
    ["beta"],
  );
});

test("a manual run injects separate invocation and ownership tokens", async () => {
  const repository = new RecordingRepository();
  const tokens = ["manual-invocation", "manual-owner"];

  const summary = await runSourceCollection({
    repository,
    adapters: [adapter("beta")],
    sourceKey: "beta",
    now,
    randomUUID: () => {
      const token = tokens.shift();
      assert.ok(token);
      return token;
    },
  });

  assert.equal(
    summary.slotKey,
    `manual:beta:${now.toISOString()}:manual-invocation`,
  );
  assert.equal(repository.claimCalls[0]?.claimToken, "manual-owner");
  assert.deepEqual(repository.terminalTokens, ["manual-owner"]);
  assert.deepEqual(tokens, []);
});

test("concurrent same-time manual runs use unique claims and both execute", async () => {
  const repository = new RecordingRepository();
  let collectCalls = 0;
  const requested = adapter("beta", async () => {
    collectCalls += 1;
    return collectionResult("beta");
  });

  const [first, second] = await Promise.all([
    runSourceCollection({
      repository,
      adapters: [requested],
      sourceKey: "beta",
      now,
      randomUUID: () => "invocation-one",
    }),
    runSourceCollection({
      repository,
      adapters: [requested],
      sourceKey: "beta",
      now,
      randomUUID: () => "invocation-two",
    }),
  ]);

  assert.equal(collectCalls, 2);
  assert.deepEqual(
    [first.slotKey, second.slotKey].sort(),
    [
      `manual:beta:${now.toISOString()}:invocation-one`,
      `manual:beta:${now.toISOString()}:invocation-two`,
    ],
  );
});

test("an existing Nike adapter preserves undated entries as review items", async () => {
  const repository = new RecordingRepository();
  const sourceMessage = "Nike source message";
  const fetcher = async (): Promise<ExistingSourceFetchResult> => ({
    status: "connected",
    releases: [],
    undated: [
      {
        id: "nike-undated",
        title: "Nike date pending",
        sourceUrl: "https://www.nike.com/kr/launch/t/date-pending",
        note: "날짜 미정",
        brand: "NIKE",
        styleCode: "NIKE-100",
        productUrl: "https://www.nike.com/kr/launch/t/date-pending",
      },
    ],
    message: sourceMessage,
  });
  const nike = createExistingAdapter({
    key: "nike",
    retailer: "Nike SNKRS Korea",
    allowedDomains: ["nike.com"],
    fetcher,
  });

  const { summary } = await runCollection({
    repository,
    adapters: [nike],
    now,
  });

  assert.equal(repository.persisted[0]?.message, sourceMessage);
  assert.equal(repository.persisted[0]?.confirmedEmpty, false);
  assert.equal(repository.persisted[0]?.groups[0]?.release.releaseDate, "");
  assert.equal(
    repository.persisted[0]?.groups[0]?.reviewReason,
    "missing_date",
  );
  assert.equal(summary.reviewItemsCreated, 1);
});

test("an existing connected-empty fetch does not authorize cache deletion implicitly", async () => {
  const existing = createExistingAdapter({
    key: "existing",
    retailer: "Existing Store",
    allowedDomains: ["existing.example"],
    fetcher: async () => ({
      status: "connected",
      releases: [],
      message: "No rows parsed",
    }),
  });

  const result = await existing.collect(now);

  assert.equal(result.confirmedEmpty, false);
});

function existingReleaseFixture() {
  return {
    id: "existing:kept",
    externalId: "existing:kept",
    title: "Existing Kept Release",
    brand: "Existing",
    category: "sneakers" as const,
    releaseDate: "2026-08-01",
    releaseTime: null,
    channel: "Existing Store",
    sourceName: "Existing",
    sourceUrl: "https://existing.example/releases/kept",
    status: "scheduled",
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

test("an existing partial parse with malformed rows withholds stale-cache cleanup authority", async () => {
  const existing = createExistingAdapter({
    key: "existing",
    retailer: "Existing Store",
    allowedDomains: ["existing.example"],
    fetcher: async () => ({
      status: "connected",
      releases: [
        {
          id: "existing:kept",
          externalId: "existing:kept",
          title: "Existing Kept Release",
          brand: "Existing",
          category: "정보",
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
        },
      ],
      message: "One malformed row was omitted",
      malformedRows: 1,
    }),
  });

  const result = await existing.collect(now);

  assert.equal(result.authoritativeSnapshot, false);
  assert.equal(result.confirmedEmpty, false);
});

test("scheduled collection enriches an undated TUNE channel from another dated source", async () => {
  const repository = new RecordingRepository();
  const asics = createExistingAdapter({
    key: "asics",
    retailer: "ASICS Korea",
    allowedDomains: ["asics.co.kr"],
    fetcher: async () => ({
      status: "connected",
      releases: [
        {
          id: "asics:186",
          externalId: "asics:186",
          title: "GEL-KAYANO 14",
          brand: "ASICS",
          category: "응모",
          releaseDate: "2026-08-07",
          releaseTime: "10:00",
          channel: "ASICS Korea",
          sourceName: "ASICS",
          sourceUrl:
            "https://www.asics.co.kr/product/detail.html?product_no=186",
          status: "예정",
          confidence: 100,
          note: "ASICS 공식 일정",
          isFeatured: true,
          retailer: "ASICS Korea",
          releaseMethod: "응모",
          styleCode: "1203B186-100",
          productUrl:
            "https://www.asics.co.kr/product/detail.html?product_no=186",
        },
      ],
      message: "ASICS connected",
    }),
  });
  const tune = createExistingAdapter({
    key: "tune",
    retailer: "TUNE",
    allowedDomains: ["tune.kr"],
    fetcher: async () => ({
      status: "connected",
      releases: [],
      undated: [
        {
          id: "tune:810001",
          title: "ASICS GEL-KAYANO 14 Cream",
          sourceUrl:
            "https://tune.kr/products/asics-gel-kayano-14-cream",
          note: "날짜 미확정",
          brand: "ASICS",
          priceLabel: "189,000원",
          styleCode: "1203b186.100",
          productUrl:
            "https://tune.kr/products/asics-gel-kayano-14-cream",
        },
      ],
      message: "TUNE connected",
    }),
  });

  const { summary } = await runCollection({
    repository,
    adapters: [tune, asics],
    now,
  });

  const persistedTune = repository.persisted.find(
    ({ sourceKey }) => sourceKey === "tune",
  );
  assert.equal(persistedTune?.groups.length, 1);
  assert.equal(persistedTune?.groups[0]?.reviewReason, null);
  assert.equal(persistedTune?.groups[0]?.release.releaseDate, "2026-08-07");
  assert.equal(persistedTune?.groups[0]?.release.releaseTime, "10:00");
  assert.equal(persistedTune?.groups[0]?.channels.length, 1);
  assert.equal(persistedTune?.groups[0]?.channels[0]?.sourceKey, "tune");
  assert.equal(summary.reviewItemsCreated, 0);
});
