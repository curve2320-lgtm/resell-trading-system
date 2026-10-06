import { classifyRelease } from "./classify.ts";
import { collectWithLimit } from "./concurrency.ts";
import {
  groupCollectedReleases,
  type ReleaseGroup,
} from "./dedupe.ts";
import {
  createCollectionRepository,
  type CollectionRepository,
  type PersistSourceResult,
} from "./repository.ts";
import {
  enabledReleaseSourceAdapters,
  findReleaseSourceAdapter,
  type ReleaseSourceAdapter,
  type SourceCollectionResult,
} from "./registry.ts";
import { collectionSlotKey } from "./slots.ts";
import { enrichUndatedTuneResults } from "./tune-enrichment.ts";
import type {
  AdapterReleaseInput,
  CollectedRelease,
  ReviewReason,
} from "./types.ts";

export type CollectionSummary = {
  slotKey: string;
  sourcesRun: number;
  sourcesSucceeded: number;
  sourcesFailed: number;
  releasesCollected: number;
  reviewItemsCreated: number;
};

export type CollectionAttemptOutcome =
  | { state: "current"; summary: CollectionSummary }
  | { state: "in_progress"; summary: CollectionSummary }
  | { state: "failed"; summary: CollectionSummary };

type RunCollectionInput = {
  repository: CollectionRepository;
  adapters: ReleaseSourceAdapter[];
  now: Date;
  randomUUID?: () => string;
};

type RunSourceCollectionInput = RunCollectionInput & {
  sourceKey: string;
};

export const SOURCE_REFRESH_CLAIM_TTL_MS = 90_000;
export const SOURCE_REFRESH_ADAPTER_DEADLINE_MS = 20_000;
const seoulDayFormatter = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"});

export type ScheduledSourceCollectionInput = {
  repository: CollectionRepository;
  adapter: ReleaseSourceAdapter;
  now: Date;
  randomUUID?: () => string;
  adapterDeadlineMs?: number;
};

type PreparedSourceResult = {
  result: PersistSourceResult;
  releasesCollected: number;
  classifiedReleases: CollectedRelease[];
  classificationReviews: ReleaseGroup[];
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error) return error;
  if (typeof error === "object" && error !== null) {
    try {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message) return message;
    } catch {
      // Fall through when a rejection object exposes a throwing getter.
    }
  }
  return "Source collection failed.";
}

function collectedRelease(
  input: AdapterReleaseInput,
  adapter: ReleaseSourceAdapter,
): CollectedRelease {
  const {
    allowedDomains: _allowedDomains,
    categoryHint,
    releaseKindHint,
    ...release
  } = input;
  return {
    ...release,
    sourceKey: adapter.key,
    retailer: release.retailer || adapter.retailer,
    category: categoryHint ?? "sneakers",
    releaseKind: releaseKindHint ?? "general",
  };
}

function reviewGroup(
  release: CollectedRelease,
  reviewReason: ReviewReason,
): ReleaseGroup {
  const [group] = groupCollectedReleases([release]);
  return { ...group, reviewReason };
}

function prepareConnectedResult(
  adapter: ReleaseSourceAdapter,
  result: SourceCollectionResult,
  collectedAt: string,
): PreparedSourceResult {
  const accepted: CollectedRelease[] = [];
  const reviews: ReleaseGroup[] = [];

  for (const release of result.releases) {
    const normalized = {
      ...release,
      sourceKey: adapter.key,
      retailer: release.retailer || adapter.retailer,
      allowedDomains: adapter.allowedDomains,
      collectedAt,
    };
    const classification = classifyRelease(normalized);
    if (classification.release) {
      accepted.push(classification.release);
    } else if (classification.reviewReason) {
      reviews.push(
        reviewGroup(
          collectedRelease(normalized, adapter),
          classification.reviewReason,
        ),
      );
    }
  }

  const groups = [...groupCollectedReleases(accepted), ...reviews];
  return {
    result: {
      sourceKey: adapter.key,
      status: "connected",
      groups,
      collectedAt,
      message: result.message,
      confirmedEmpty: result.confirmedEmpty,
      authoritativeSnapshot: result.authoritativeSnapshot,
    },
    releasesCollected: result.releases.length,
    classifiedReleases: accepted,
    classificationReviews: reviews,
  };
}

function prepareSourceResult(
  adapter: ReleaseSourceAdapter,
  settled: PromiseSettledResult<SourceCollectionResult>,
  collectedAt: string,
): PreparedSourceResult {
  if (settled.status === "rejected") {
    return {
      result: {
        sourceKey: adapter.key,
        status: "error",
        groups: [],
        collectedAt,
        message: errorMessage(settled.reason),
        confirmedEmpty: false,
      },
      releasesCollected: 0,
      classifiedReleases: [],
      classificationReviews: [],
    };
  }

  if (settled.value.status === "connected") {
    return prepareConnectedResult(adapter, settled.value, collectedAt);
  }

  return {
    result: {
      sourceKey: adapter.key,
      status: settled.value.status,
      groups: [],
      collectedAt,
      message: settled.value.message,
      confirmedEmpty: false,
    },
    releasesCollected: 0,
    classifiedReleases: [],
    classificationReviews: [],
  };
}

function safelyPrepareSourceResult(
  adapter: ReleaseSourceAdapter,
  settled: PromiseSettledResult<SourceCollectionResult>,
  collectedAt: string,
): PreparedSourceResult {
  try {
    return prepareSourceResult(adapter, settled, collectedAt);
  } catch (error) {
    return prepareSourceResult(
      adapter,
      { status: "rejected", reason: error },
      collectedAt,
    );
  }
}

function reconcileCollectedGroups(
  prepared: PreparedSourceResult[],
): PreparedSourceResult[] {
  const acceptedChannels = prepared.flatMap((source) =>
    source.result.status === "connected"
      ? source.classifiedReleases
      : [],
  );
  const reconciledGroups = groupCollectedReleases(acceptedChannels);

  return prepared.map((source) => {
    if (source.result.status !== "connected") return source;
    const sourceGroups = reconciledGroups.flatMap((group) => {
      const channels = group.channels.filter(
        ({ sourceKey }) => sourceKey === source.result.sourceKey,
      );
      return channels.length > 0
        ? [{ ...group, release: channels[0], channels }]
        : [];
    });
    return {
      ...source,
      result: {
        ...source.result,
        groups: [...sourceGroups, ...source.classificationReviews],
      },
    };
  });
}

function emptySummary(slotKey: string): CollectionSummary {
  return {
    slotKey,
    sourcesRun: 0,
    sourcesSucceeded: 0,
    sourcesFailed: 0,
    releasesCollected: 0,
    reviewItemsCreated: 0,
  };
}

function randomUUID(source?: () => string): string {
  return source ? source() : crypto.randomUUID();
}

async function runClaimedCollection(
  input: RunCollectionInput,
  slotKey: string,
  options: { claimTtlMs?: number; adapterDeadlineMs?: number; retryFailedAfterMs?: number } = {},
): Promise<CollectionAttemptOutcome> {
  const locks: Array<{sourceKey:string;token:string}> = [];
  const scopedSources=[...new Set(input.adapters.filter(adapter=>adapter.collectionKey).map(({key})=>key))];
  try {
    if (input.repository.claimSourceRefreshLock) for (const sourceKey of scopedSources) {
      const token=randomUUID(input.randomUUID);
      const claimed=await input.repository.claimSourceRefreshLock(sourceKey,input.now.toISOString(),token,new Date(input.now.getTime()-(options.claimTtlMs ?? 15*60_000)).toISOString());
      if (!claimed) return {state:"in_progress",summary:emptySummary(slotKey)};
      locks.push({sourceKey,token});
    }
    return await runUnlockedClaimedCollection(input,slotKey,options);
  } finally {
    if (input.repository.releaseSourceRefreshLock) for (const {sourceKey,token} of locks.reverse()) await input.repository.releaseSourceRefreshLock(sourceKey,token);
  }
}

async function runUnlockedClaimedCollection(
  input: RunCollectionInput,
  slotKey: string,
  options: { claimTtlMs?: number; adapterDeadlineMs?: number; retryFailedAfterMs?: number },
): Promise<CollectionAttemptOutcome> {
  const collectedAt = input.now.toISOString();
  const claimToken = randomUUID(input.randomUUID);
  const staleBefore = new Date(
    input.now.getTime() - (options.claimTtlMs ?? 15 * 60_000),
  ).toISOString();
  const claim = await input.repository.claimSlot(
    slotKey,
    collectedAt,
    claimToken,
    staleBefore,
    options.retryFailedAfterMs === undefined ? undefined : new Date(input.now.getTime()-options.retryFailedAfterMs).toISOString(),
  );
  if (claim.state !== "claimed") {
    return {
      state: claim.state === "completed" ? "current" : claim.state,
      summary: emptySummary(slotKey),
    };
  }

  const collected = await collectWithLimit(input.adapters, (adapter) =>
    collectBeforeDeadline(adapter,input.now,options.adapterDeadlineMs), 8);
  const enriched = enrichUndatedTuneResults(input.adapters, collected);
  const prepared = reconcileCollectedGroups(
    enriched.map((result, index) =>
      safelyPrepareSourceResult(input.adapters[index], result, collectedAt),
    ),
  );
  const persisted = await Promise.allSettled(
    prepared.map(({ result }) =>
      Promise.resolve().then(() =>
        input.repository.persistSourceResult(result),
      ),
    ),
  );

  const summary = prepared.reduce<CollectionSummary>(
    (current, source, index) => {
      const persistence = persisted[index];
      if (persistence.status === "rejected" || source.result.status === "error") {
        current.sourcesFailed += 1;
      } else if (source.result.status === "connected") {
        current.sourcesSucceeded += 1;
        current.releasesCollected += source.releasesCollected;
        current.reviewItemsCreated += persistence.value.reviewItemsCreated;
      }
      return current;
    },
    {
      slotKey,
      sourcesRun: input.adapters.length,
      sourcesSucceeded: 0,
      sourcesFailed: 0,
      releasesCollected: 0,
      reviewItemsCreated: 0,
    },
  );

  const collectionFailed =
    summary.sourcesSucceeded === 0 && summary.sourcesFailed > 0;
  const terminalUpdated = collectionFailed
    ? await input.repository.failSlot(
      slotKey,
      claim.claimToken,
      collectedAt,
    )
    : await input.repository.completeSlot(
      slotKey,
      claim.claimToken,
      collectedAt,
    );
  if (!terminalUpdated) return { state: "in_progress", summary };

  const persistenceFailure = persisted.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (
    persistenceFailure &&
    persisted.every((result) => result.status === "rejected")
  ) {
    throw persistenceFailure.reason;
  }

  return { state: collectionFailed ? "failed" : "current", summary };
}

async function collectBeforeDeadline(
  adapter: ReleaseSourceAdapter,
  now: Date,
  deadlineMs?: number,
): Promise<SourceCollectionResult> {
  if (deadlineMs === undefined) return adapter.collect(now);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => adapter.collect(now)),
      new Promise<never>((_resolve,reject) => {
        timer=setTimeout(() => reject(new Error("Source collection timed out.")),deadlineMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function sourceRefreshSlotKey(sourceKey: string, now: Date, metadata: Pick<ReleaseSourceAdapter,"collectionKey"|"refreshInterval"> = {}): string {
  // Retry a corrected parser within the current slot without rerunning other sources.
  const revision = sourceKey === "shoeprize" ? "v4" : sourceKey === "sns" || sourceKey === "instagramPublic" || sourceKey === "museumShop" || sourceKey === "pokemonCard" ? "v3" : "v2";
  let period = collectionSlotKey(now);
  if (metadata.refreshInterval === "weekly") {
    const seoulDay = new Date(`${seoulDayFormatter.format(now)}T00:00:00Z`);
    seoulDay.setUTCDate(seoulDay.getUTCDate() - (seoulDay.getUTCDay() + 6) % 7);
    period = `week:${seoulDay.toISOString().slice(0,10)}`;
  }
  return `refresh:${revision}:${period}:${metadata.collectionKey ?? sourceKey}`;
}

export async function runScheduledSourceCollection(
  input: ScheduledSourceCollectionInput,
): Promise<CollectionAttemptOutcome> {
  return runClaimedCollection(
    {repository:input.repository,adapters:[input.adapter],now:input.now,randomUUID:input.randomUUID},
    sourceRefreshSlotKey(input.adapter.key,input.now,input.adapter),
    {claimTtlMs:SOURCE_REFRESH_CLAIM_TTL_MS,adapterDeadlineMs:input.adapterDeadlineMs ?? SOURCE_REFRESH_ADAPTER_DEADLINE_MS,retryFailedAfterMs:input.adapter.refreshInterval === "weekly" ? 5*60_000 : undefined},
  );
}

export async function runCollection(
  input: RunCollectionInput,
): Promise<CollectionAttemptOutcome> {
  return runClaimedCollection(input, collectionSlotKey(input.now));
}

export async function runSourceCollection(
  input: RunSourceCollectionInput,
): Promise<CollectionSummary> {
  const adapter = findReleaseSourceAdapter(input.sourceKey, input.adapters);
  if (!adapter) {
    throw new Error(`Unknown release source: ${input.sourceKey}`);
  }
  const invocationId = randomUUID(input.randomUUID);
  const slotKey =
    `manual:${adapter.key}:${input.now.toISOString()}:${invocationId}`;
  const outcome = await runClaimedCollection(
    {
      repository: input.repository,
      adapters: [adapter],
      now: input.now,
      randomUUID: input.randomUUID,
    },
    slotKey,
  );
  return outcome.summary;
}

export async function ensureCurrentSlotCollected(
  now = new Date(),
): Promise<CollectionAttemptOutcome> {
  return runCollection({
    repository: createCollectionRepository(),
    adapters: enabledReleaseSourceAdapters(),
    now,
  });
}

export async function collectSourceNow(
  sourceKey: string,
  now = new Date(),
): Promise<CollectionSummary> {
  const adapters = enabledReleaseSourceAdapters();
  return runSourceCollection({
    repository: createCollectionRepository(),
    adapters,
    sourceKey,
    now,
  });
}
