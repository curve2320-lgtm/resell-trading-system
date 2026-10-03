import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  collectionSlots,
  releases,
  releaseCatalog,
  releaseChanges,
  releaseChannels,
  releaseSources,
  reviewItems,
} from "../../db/schema.ts";
import {
  changedFields,
  groupCollectedReleases,
  releasesHaveConflictingSchedule,
  type ReleaseGroup,
} from "./dedupe.ts";
import {
  legacyReleaseToCollected,
  type LegacyReleaseRow,
} from "./legacy.ts";
import { sourceTierRank } from "./source-tier.ts";
import type {
  CollectedRelease,
  ReleaseCategory,
  ReleaseKind,
  ReviewReason,
} from "./types.ts";
import { safeAnnouncementUrl, isInstagramSource } from "../sns-links.ts";
import { safeRetailerUrl } from "../release-links.ts";
import { expandedSourceCatalog, expandedSourceRegion } from "../expanded-sources.ts";

export type SlotClaimOutcome =
  | { state: "claimed"; claimToken: string; reclaimed: boolean }
  | { state: "in_progress" }
  | { state: "completed" }
  | { state: "failed" };

export type CollectionSlotSnapshot = {
  slotKey: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
};

export interface CollectionRepository {
  claimSourceRefreshLock?(sourceKey: string, startedAt: string, claimToken: string, staleBefore: string): Promise<boolean>;
  releaseSourceRefreshLock?(sourceKey: string, claimToken: string): Promise<void>;
  listCollectionSlots?(slotKeys: readonly string[]): Promise<CollectionSlotSnapshot[]>;
  claimSlot(
    slotKey: string,
    startedAt: string,
    claimToken: string,
    staleBefore: string,
    retryFailedBefore?: string,
  ): Promise<SlotClaimOutcome>;
  completeSlot(
    slotKey: string,
    claimToken: string,
    completedAt: string,
  ): Promise<boolean>;
  failSlot(
    slotKey: string,
    claimToken: string,
    completedAt: string,
  ): Promise<boolean>;
  listCachedReleases(): Promise<CachedRelease[]>;
  persistSourceResult(result: PersistSourceResult): Promise<PersistSourceOutcome>;
  listSourceHealth(): Promise<SourceHealth[]>;
  listReviewItems(): Promise<ReviewItem[]>;
  countPendingReviewItems(): Promise<number>;
  listPendingNikeMissingDateReviews(): Promise<ReviewItem[]>;
  listPendingUndatedReviews?: () => Promise<ReviewItem[]>;
  persistManualSnsRelease?: (
    result: Extract<import("./sns-intake.ts").SnsIntakeResult, { kind: "publish" }>,
    collectedAt: string,
  ) => Promise<ManualSnsPersistOutcome>;
  createManualSnsReview?: (
    result: Extract<import("./sns-intake.ts").SnsIntakeResult, { kind: "review" }>,
    collectedAt: string,
  ) => Promise<ManualSnsPersistOutcome>;
  resolveReview(input: ResolveReviewInput): Promise<void>;
}

export type ManualSnsPersistOutcome =
  | { status: "published"; releaseId: string; externalId: string }
  | { status: "review"; reviewId: number; externalId: string };

export type CachedRelease = {
  id: string;
  canonicalKey: string;
  title: string;
  brand: string | null;
  category: ReleaseCategory;
  releaseKind: ReleaseKind;
  releaseDate: string;
  releaseTime: string | null;
  changedAt: string | null;
  lastVerifiedAt: string;
  channels: CachedReleaseChannel[];
};

export type CachedReleaseChannel = {
  sourceKey: string;
  externalId?: string;
  retailer: string;
  productUrl: string | null;
  sourceUrl: string | null;
  priceLabel: string | null;
  releaseDate: string;
  releaseTime: string | null;
  styleCode?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  announcementAt?: string | null;
  startTimeUnknown?: boolean;
  endTimeUnknown?: boolean;
  region?: string | null;
  marketScope?: "korea" | "overseas";
  note?: string;
  releaseMethod?: string | null;
  shippingMethod?: string | null;
};

const CHANNEL_DETAIL_KEYS = ["styleCode","startAt","endAt","announcementAt","startTimeUnknown","endTimeUnknown","region","marketScope","note","releaseMethod","shippingMethod"] as const;
function channelDetailsJson(release: CollectedRelease): string {
  return JSON.stringify(Object.fromEntries(CHANNEL_DETAIL_KEYS.filter((key)=>release[key] !== undefined).map((key)=>[key,release[key]])));
}
function parseChannelDetails(value: string | null | undefined): Partial<CachedReleaseChannel> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const record=parsed as Record<string,unknown>;
    return Object.fromEntries(CHANNEL_DETAIL_KEYS.flatMap<[string,string | boolean | null]>((key)=> {
      const item=record[key];
      if (key==="marketScope") return item==="korea" || item==="overseas" ? [[key,item]]:[];
      if (key==="startTimeUnknown" || key==="endTimeUnknown") return typeof item==="boolean" ? [[key,item]]:[];
      return item===null || typeof item==="string" ? [[key,item]]:[];
    })) as Partial<CachedReleaseChannel>;
  } catch {return {};}
}

export type SourceHealth = {
  sourceKey: string;
  status: "connected" | "error" | "manual";
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  sourceCount: number;
  newCount: number;
  mergedCount: number;
  reviewCount: number;
  message: string;
};

export type PersistSourceResult = {
  sourceKey: string;
  status: SourceHealth["status"];
  groups: ReleaseGroup[];
  collectedAt: string;
  message: string;
  confirmedEmpty: boolean;
  authoritativeSnapshot?: boolean;
};

export type PersistSourceOutcome = {
  reviewItemsCreated: number;
};

export type ReviewItem = {
  id: number;
  sourceKey: string;
  externalId: string;
  reason: ReviewReason;
  payloadJson: string;
  status: "pending" | "approved" | "ignored" | "merged";
};

export type ReleaseApiUndatedItem = {
  id: string;
  title: string;
  sourceUrl: string | null;
  note: string;
  brand: string | null;
  priceLabel: string | null;
  styleCode: string | null;
  productUrl: string | null;
};

export type ReleaseApiChannel = CachedReleaseChannel;

export type ReleaseApiSourceHealth = {
  status: SourceHealth["status"] | "unknown";
  count: number;
  message: string;
  sourceUrl?: string;
  undated?: ReleaseApiUndatedItem[];
};

export type ReleaseApiRelease = {
  id: string;
  title: string;
  brand: string;
  category: "선착순" | "응모" | "정보";
  catalogCategory: CachedRelease["category"];
  releaseKind: ReleaseKind;
  releaseDate: string;
  releaseTime: string | null;
  hasScheduleChange: boolean;
  lastVerifiedLabel: string | null;
  channels: ReleaseApiChannel[];
  channel: string;
  sourceName: string;
  sourceUrl: string | null;
  status: string;
  confidence: number;
  note: string;
  isFeatured: boolean;
  retailer: string | null;
  releaseMethod: string | null;
  priceLabel: string | null;
  productUrl: string | null;
  region?: string;
  marketScope?: "korea" | "overseas";
  styleCode?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  announcementAt?: string | null;
  startTimeUnknown?: boolean;
  endTimeUnknown?: boolean;
  shippingMethod?: string | null;
};

export type ReleaseApiPayload = {
  releases: ReleaseApiRelease[];
  sources: Record<string, ReleaseApiSourceHealth>;
  reviewCount: number;
};

export type ResolveReviewInput =
  | { id: number; action: "approve"; resolvedBy: string }
  | { id: number; action: "ignore"; resolvedBy: string }
  | { id: number; action: "merge"; releaseId: string; resolvedBy: string }
  | {
      id: number;
      action: "edit";
      title: string;
      releaseDate: string;
      releaseTime: string | null;
      resolvedBy: string;
    };

export type ReviewResolutionErrorCode =
  | "not_pending"
  | "merge_target_not_found"
  | "invalid_payload";

export class ReviewResolutionError extends Error {
  constructor(public readonly code: ReviewResolutionErrorCode) {
    const message =
      code === "not_pending"
        ? "Review item is not pending."
        : code === "merge_target_not_found"
          ? "Merge target was not found."
          : "Review item payload is invalid.";
    super(message);
    this.name = "ReviewResolutionError";
  }
}

type CollectionDb = ReturnType<
  (typeof import("../../db/index.ts"))["getDb"]
>;
type CollectionDbProvider = () => Promise<CollectionDb>;
type D1BatchQuery = BatchItem<"sqlite">;

type ExistingCatalog = {
  id: string;
  canonicalKey: string;
  title: string;
  brand: string | null;
  releaseDate: string | null;
  releaseTime: string | null;
  lastVerifiedAt: string | null;
};

type ExistingChannel = {
  releaseId: string;
  sourceKey: string;
  externalId: string;
  releaseDate: string | null;
  releaseTime: string | null;
  priceLabel: string | null;
  productUrl: string | null;
  collectedAt: string;
};

type GroupWritePlan = {
  queries: D1BatchQuery[];
  newCount: number;
  mergedCount: number;
  collisionReviewGroups: ReleaseGroup[];
};

type ReviewWrite = {
  sourceKey: string;
  externalId: string;
  group: ReleaseGroup;
};

type CachedConflictPlan = {
  acceptedGroups: ReleaseGroup[];
  reviewWrites: ReviewWrite[];
};

const D1_MAX_BOUND_PARAMETERS = 100;

function chunksOf<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function catalogId(canonicalKey: string): string {
  return `cached:${canonicalKey}`;
}

function channelId(sourceKey: string, externalId: string): string {
  return `${sourceKey}:${externalId}`;
}

function channelIdentity(sourceKey: string, externalId: string): string {
  return JSON.stringify([sourceKey, externalId]);
}

function isReleaseCategory(value: string | null): value is ReleaseCategory {
  return value === "sneakers" || value === "fashion" || value === "lifestyle";
}

function isReleaseKind(value: string | null): value is ReleaseKind {
  return (
    value === "general" ||
    value === "collab" ||
    value === "raffle" ||
    value === "offline"
  );
}

function isReviewReason(value: string): value is ReviewReason {
  return (
    value === "conflicting_schedule" ||
    value === "possible_duplicate" ||
    value === "missing_date" ||
    value === "invalid_source_url"
  );
}

function isReviewStatus(value: string): value is ReviewItem["status"] {
  return (
    value === "pending" ||
    value === "approved" ||
    value === "ignored" ||
    value === "merged"
  );
}

function isSourceStatus(value: string): value is SourceHealth["status"] {
  return value === "connected" || value === "error" || value === "manual";
}

function sourceChannels(
  group: ReleaseGroup,
  sourceKey: string,
): CollectedRelease[] {
  return group.channels.filter((channel) => channel.sourceKey === sourceKey);
}

function reviewWriteIdentity(sourceKey: string, externalId: string): string {
  return channelIdentity(sourceKey, externalId);
}

function sourceScopedReviewWrite(
  canonicalKey: string,
  channels: CollectedRelease[],
): ReviewWrite {
  const release = channels[0];
  return {
    sourceKey: release.sourceKey,
    externalId: release.externalId,
    group: {
      canonicalKey,
      release,
      channels,
      reviewReason: "conflicting_schedule",
    },
  };
}

function uniqueReviewWrites(writes: ReviewWrite[]): ReviewWrite[] {
  const unique = new Map<string, ReviewWrite>();
  for (const write of writes) {
    unique.set(
      reviewWriteIdentity(write.sourceKey, write.externalId),
      write,
    );
  }
  return [...unique.values()].sort((left, right) =>
    reviewWriteIdentity(left.sourceKey, left.externalId).localeCompare(
      reviewWriteIdentity(right.sourceKey, right.externalId),
    )
  );
}

function reviewPayload(group: ReleaseGroup): string {
  return JSON.stringify(group);
}

function parseReviewPayload(payloadJson: string): ReleaseGroup {
  let value: Partial<ReleaseGroup>;
  try {
    value = JSON.parse(payloadJson) as Partial<ReleaseGroup>;
  } catch {
    throw new ReviewResolutionError("invalid_payload");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    typeof value.canonicalKey !== "string" ||
    typeof value.release !== "object" ||
    value.release === null ||
    !Array.isArray(value.channels)
  ) {
    throw new ReviewResolutionError("invalid_payload");
  }
  return value as ReleaseGroup;
}

const SOURCE_URLS: Record<string, string> = {
  shoeprize: "https://www.shoeprize.com/today",
  nike: "https://www.nike.com/kr/launch/upcoming",
  adidas: "https://www.adidas.co.kr/release-dates",
  grandstage: "https://grandstage.a-rt.com/display/calendar",
  newBalance: "https://m.nbkorea.com/launchingCalendar/list.action",
  musinsa: "https://www.musinsa.com/events/raffle",
  soldout: "https://svc.soldout.co.kr/trade/raffle/list",
  worksout: "https://www.worksout.co.kr/app-download",
  kasina: "https://www.kasina.co.kr/launches",
  kream: "https://kream.co.kr/brands/KREAM%20DRAW",
  converse: "https://www.converse.co.kr/limited/launch.html",
  fila: "https://www.fila.co.kr/product/new.asp",
  northFace: "https://www.thenorthfacekorea.co.kr/category/n/new?sort=ACTIVE_DATE_DESC",
  palace: "https://palaceskateboards.seoul.kr/",
  salomon: "https://salomon.co.kr/collections/launch-calendar",
  asics: "https://www.asics.co.kr/board/?id=spscalendar",
  tune: "https://tune.kr",
  sns: "https://www.instagram.com/",
  instagramPublic: "https://store.linefriends.com/",
  ...Object.fromEntries(expandedSourceCatalog.map(({ key, url }) => [key, url])),
};

function legacyCategory(
  release: CachedRelease,
): ReleaseApiRelease["category"] {
  if (release.releaseKind === "raffle") return "응모";
  const method = release.channels[0]?.releaseMethod?.trim() ?? "";
  if (/^(?:선착순|first[- ]come(?:[- ]first[- ]served)?)$/i.test(method)) return "선착순";
  return release.category === "sneakers" ? "선착순" : "정보";
}

function publicVerificationLabel(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute} KST`;
}

function hasMultiRetailerConfirmation(release: CachedRelease): boolean {
  const listings = new Set(
    release.channels.map(
      ({ sourceKey, retailer }) =>
        isInstagramSource(sourceKey)
          ? null
          : `${sourceKey.trim().toLowerCase()}\0${retailer.trim().toLowerCase()}`,
    ),
  );
  listings.delete(null);
  return listings.size >= 2;
}

function releaseApiRelease(release: CachedRelease): ReleaseApiRelease {
  const channel = release.channels[0];
  const region = channel ? expandedSourceRegion(channel.sourceKey) : null;
  return {
    id: release.id,
    title: release.title,
    brand: release.brand ?? "",
    ...(region ? { region, marketScope: region === "한국" ? "korea" as const : "overseas" as const } : {}),
    ...Object.fromEntries(CHANNEL_DETAIL_KEYS.filter((key)=>channel?.[key] !== undefined).map((key)=>[key,channel![key]])),
    category: legacyCategory(release),
    catalogCategory: release.category,
    releaseKind: release.releaseKind,
    releaseDate: release.releaseDate,
    releaseTime: release.releaseTime,
    hasScheduleChange: release.changedAt !== null,
    lastVerifiedLabel: publicVerificationLabel(release.lastVerifiedAt),
    channels: release.channels.map((item) => ({
      ...Object.fromEntries(CHANNEL_DETAIL_KEYS.filter((key)=>item[key] !== undefined).map((key)=>[key,item[key]])),
      sourceKey: item.sourceKey,
      ...(item.externalId !== undefined ? {externalId:item.externalId} : {}),
      retailer: item.retailer,
      productUrl: safeRetailerUrl(item.productUrl),
      sourceUrl:
        isInstagramSource(item.sourceKey)
          ? safeAnnouncementUrl(item.sourceUrl)
          : safeRetailerUrl(item.sourceUrl),
      priceLabel: item.priceLabel,
      releaseDate: item.releaseDate,
      releaseTime: item.releaseTime,
    })),
    channel: channel?.retailer ?? "",
    sourceName: channel?.sourceKey ?? "",
    sourceUrl:
      isInstagramSource(channel?.sourceKey)
        ? safeAnnouncementUrl(channel.sourceUrl)
        : safeRetailerUrl(channel?.sourceUrl),
    status: "예정",
    confidence: 100,
    note: channel?.note ?? "",
    isFeatured:
      release.releaseKind === "collab" &&
      hasMultiRetailerConfirmation(release),
    retailer: channel?.retailer || null,
    releaseMethod: channel?.releaseMethod ?? (release.releaseKind === "raffle" ? "raffle" : null),
    priceLabel: channel?.priceLabel ?? null,
    productUrl: safeRetailerUrl(channel?.productUrl),
  };
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function pendingUndatedItem(review: ReviewItem): ReleaseApiUndatedItem | null {
  if (
    review.status !== "pending" ||
    review.reason !== "missing_date"
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(review.payloadJson) as unknown;
    if (typeof payload !== "object" || payload === null) return null;
    const release = (payload as { release?: unknown }).release;
    if (typeof release !== "object" || release === null) return null;
    const candidate = release as Record<string, unknown>;
    if (
      candidate.sourceKey !== review.sourceKey ||
      typeof candidate.externalId !== "string" ||
      candidate.externalId !== review.externalId ||
      typeof candidate.title !== "string" ||
      !candidate.title.trim() ||
      (typeof candidate.releaseDate === "string" && candidate.releaseDate.trim() !== "") ||
      !isNullableString(candidate.sourceUrl) ||
      !isNullableString(candidate.productUrl) ||
      !isNullableString(candidate.brand) ||
      !isNullableString(candidate.priceLabel) ||
      !isNullableString(candidate.styleCode)
    ) {
      return null;
    }
    return {
      id: candidate.externalId,
      title: candidate.title,
      sourceUrl: isInstagramSource(review.sourceKey)
        ? safeAnnouncementUrl(candidate.sourceUrl)
        : safeRetailerUrl(candidate.sourceUrl),
      note: "발매일 확인 필요",
      brand: candidate.brand,
      priceLabel: candidate.priceLabel,
      styleCode: candidate.styleCode,
      productUrl: safeRetailerUrl(candidate.productUrl),
    };
  } catch {
    return null;
  }
}

export async function readReleaseApiPayload(
  repository: CollectionRepository = createCollectionRepository(),
  configuredSourceKeys: readonly string[] = [],
): Promise<ReleaseApiPayload> {
  const [
    cachedReleases,
    sourceHealth,
    pendingReviewCount,
    pendingUndatedReviews,
  ] = await Promise.all([
    repository.listCachedReleases(),
    repository.listSourceHealth(),
    repository.countPendingReviewItems(),
    repository.listPendingUndatedReviews
      ? repository.listPendingUndatedReviews()
      : repository.listPendingNikeMissingDateReviews(),
  ]);
  const undatedBySource = new Map<string, ReleaseApiUndatedItem[]>();
  for (const review of pendingUndatedReviews.slice(0, 200)) {
    const item = pendingUndatedItem(review);
    if (!item) continue;
    const items = undatedBySource.get(review.sourceKey) ?? [];
    if (!items.some(({ id }) => id === item.id)) items.push(item);
    undatedBySource.set(review.sourceKey, items);
  }
  const healthBySource = new Map(
    sourceHealth.map((health) => [health.sourceKey, health]),
  );
  const sources: Record<string, ReleaseApiSourceHealth> = {
    database: {
      status: "connected",
      count: cachedReleases.length,
      message: "Cached data",
    },
  };

  const publicSourceKeys = [
    ...new Set([...configuredSourceKeys, "nike", ...undatedBySource.keys()]),
  ];
  for (const sourceKey of publicSourceKeys) {
    const health = healthBySource.get(sourceKey);
    sources[sourceKey] = {
      status: health?.status ?? "unknown",
      count: sourceKey === "sibna" ? new Set(cachedReleases.flatMap(({channels})=>channels.filter(channel=>channel.sourceKey === sourceKey).map(channel=>channel.externalId ?? channel.sourceUrl))).size : health?.sourceCount ?? 0,
      message: health?.message ?? "Collection has not run yet.",
      sourceUrl: SOURCE_URLS[sourceKey],
      ...(sourceKey === "nike" || undatedBySource.has(sourceKey)
        ? { undated: undatedBySource.get(sourceKey) ?? [] }
        : {}),
    };
  }

  return {
    releases: cachedReleases.map(releaseApiRelease),
    sources,
    reviewCount: pendingReviewCount,
  };
}

async function runBatch(
  db: CollectionDb,
  queries: D1BatchQuery[],
): Promise<unknown[]> {
  if (queries.length === 0) return [];
  return db.batch(
    queries as [D1BatchQuery, ...D1BatchQuery[]],
  );
}

async function backfillLegacyReleases(db: CollectionDb): Promise<void> {
  let rows: LegacyReleaseRow[];
  try {
    rows = await db.select().from(releases).all();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : "";
    if (message.includes("no such table") || cause.includes("no such table")) {
      return;
    }
    throw error;
  }
  if (rows.length === 0) return;
  const collectedAt = new Date().toISOString();
  const queries: D1BatchQuery[] = [];

  for (const row of rows) {
    const release = legacyReleaseToCollected(row, collectedAt);
    const releaseId = `legacy:${row.id}`;
    queries.push(
      db
        .insert(releaseCatalog)
        .values({
          id: releaseId,
          canonicalKey: releaseId,
          title: release.title,
          brand: release.brand,
          category: release.category,
          releaseKind: release.releaseKind,
          releaseDate: release.releaseDate,
          releaseTime: release.releaseTime,
          status: "published",
          confidence: 100,
          firstSeenAt: collectedAt,
          updatedAt: collectedAt,
          lastVerifiedAt: collectedAt,
          changedAt: null,
        })
        .onConflictDoNothing({ target: releaseCatalog.id }),
    );
    queries.push(
      db
        .insert(releaseChannels)
        .values({
          id: channelId(release.sourceKey, release.externalId),
          releaseId,
          sourceKey: release.sourceKey,
          externalId: release.externalId,
          retailer: release.retailer,
          productUrl: safeRetailerUrl(release.productUrl),
          sourceUrl: safeRetailerUrl(release.sourceUrl),
          priceLabel: release.priceLabel,
          releaseDate: release.releaseDate,
          releaseTime: release.releaseTime,
          collectedAt,
          detailsJson: channelDetailsJson(release),
        })
        .onConflictDoUpdate({
          target: [releaseChannels.sourceKey, releaseChannels.externalId],
          set: {detailsJson:channelDetailsJson(release)},
          setWhere: isNull(releaseChannels.detailsJson),
        }),
    );
  }

  for (const chunk of chunksOf(queries, 80)) {
    await runBatch(db, chunk);
  }
}

const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

function claimCutoff(now = Date.now()): string {
  return new Date(now - CLAIM_TIMEOUT_MS).toISOString();
}

function sourceClaimGuard(sourceKey: string, token: string): SQL {
  return sql`exists (
    select 1 from ${releaseSources}
    where ${releaseSources.sourceKey} = ${sourceKey}
      and ${releaseSources.resultClaimToken} = ${token}
  )`;
}

async function claimSourceResult(
  db: CollectionDb,
  result: PersistSourceResult,
): Promise<string | null> {
  const token = `source-claim:${crypto.randomUUID()}`;
  const claimedAt = new Date().toISOString();
  const claimed = await db
    .insert(releaseSources)
    .values({
      sourceKey: result.sourceKey,
      status: "manual",
      lastSuccessAt: null,
      lastFailureAt: null,
      consecutiveFailures: 0,
      sourceCount: 0,
      newCount: 0,
      mergedCount: 0,
      reviewCount: 0,
      message: "Collection result pending.",
      resultRevisionAt: result.collectedAt,
      resultClaimToken: token,
      resultClaimedAt: claimedAt,
    })
    .onConflictDoUpdate({
      target: releaseSources.sourceKey,
      set: {
        resultRevisionAt: result.collectedAt,
        resultClaimToken: token,
        resultClaimedAt: claimedAt,
      },
      where: or(
        isNull(releaseSources.resultRevisionAt),
        lt(releaseSources.resultRevisionAt, result.collectedAt),
        and(
          eq(releaseSources.resultRevisionAt, result.collectedAt),
          lt(releaseSources.resultClaimedAt, claimCutoff()),
        ),
      ),
    })
    .returning({ token: releaseSources.resultClaimToken })
    .get();

  return claimed?.token === token ? token : null;
}

function reviewClaimGuard(id: number, token: string): SQL {
  return sql`exists (
    select 1 from ${reviewItems}
    where ${reviewItems.id} = ${id}
      and ${reviewItems.status} = ${"pending"}
      and ${reviewItems.claimToken} = ${token}
  )`;
}

function noNewerPendingReviewGuard(
  sourceKey: string,
  externalId: string,
  collectedAt: string,
): SQL {
  return sql`not exists (
    select 1 from ${reviewItems}
    where ${reviewItems.sourceKey} = ${sourceKey}
      and ${reviewItems.externalId} = ${externalId}
      and ${reviewItems.status} = ${"pending"}
      and ${reviewItems.createdAt} > ${collectedAt}
  )`;
}

async function claimReviewItem(
  db: CollectionDb,
  id: number,
): Promise<typeof reviewItems.$inferSelect> {
  const token = `review-claim:${crypto.randomUUID()}`;
  const claimedAt = new Date().toISOString();
  const item = await db
    .update(reviewItems)
    .set({ claimToken: token, claimedAt })
    .where(
      and(
        eq(reviewItems.id, id),
        eq(reviewItems.status, "pending"),
        or(
          isNull(reviewItems.claimToken),
          isNull(reviewItems.claimedAt),
          lt(reviewItems.claimedAt, claimCutoff()),
        ),
      ),
    )
    .returning()
    .get();

  if (!item || item.claimToken !== token) {
    throw new ReviewResolutionError("not_pending");
  }
  return item;
}

function batchResultHasRows(result: unknown): boolean {
  if (Array.isArray(result)) return result.length > 0;
  if (
    typeof result === "object" &&
    result !== null &&
    "results" in result &&
    Array.isArray(result.results)
  ) {
    return result.results.length > 0;
  }
  return false;
}

function styleCodeFromCanonicalKey(canonicalKey: string): string | null {
  return canonicalKey.startsWith("style:")
    ? canonicalKey.slice("style:".length).split(/:market:|:seller:/)[0]
    : null;
}

async function planCachedScheduleConflicts(
  db: CollectionDb,
  groups: ReleaseGroup[],
  sourceKey: string,
): Promise<CachedConflictPlan> {
  const incomingByIdentity = new Map<
    string,
    { canonicalKey: string; channels: CollectedRelease[] }
  >();
  for (const group of groups) {
    for (const channel of sourceChannels(group, sourceKey)) {
      const identity = channelIdentity(channel.sourceKey, channel.externalId);
      const incoming = incomingByIdentity.get(identity) ?? {
        canonicalKey: group.canonicalKey,
        channels: [],
      };
      incoming.channels.push(channel);
      incomingByIdentity.set(identity, incoming);
    }
  }
  const canonicalKeys = [
    ...new Set(
      [...incomingByIdentity.values()].map(({ canonicalKey }) => canonicalKey),
    ),
  ];
  if (canonicalKeys.length === 0) {
    return { acceptedGroups: groups, reviewWrites: [] };
  }

  const cachedPeers: Array<{
    canonicalKey: string;
    release: CollectedRelease;
  }> = [];
  for (const canonicalKeyChunk of chunksOf(
    canonicalKeys,
    D1_MAX_BOUND_PARAMETERS,
  )) {
    const rows = await db
      .select({
        canonicalKey: releaseCatalog.canonicalKey,
        title: releaseCatalog.title,
        brand: releaseCatalog.brand,
        category: releaseCatalog.category,
        releaseKind: releaseCatalog.releaseKind,
        catalogReleaseDate: releaseCatalog.releaseDate,
        channelSourceKey: releaseChannels.sourceKey,
        channelExternalId: releaseChannels.externalId,
        channelRetailer: releaseChannels.retailer,
        channelProductUrl: releaseChannels.productUrl,
        channelSourceUrl: releaseChannels.sourceUrl,
        channelPriceLabel: releaseChannels.priceLabel,
        channelReleaseDate: releaseChannels.releaseDate,
        channelReleaseTime: releaseChannels.releaseTime,
        channelCollectedAt: releaseChannels.collectedAt,
        channelDetailsJson: releaseChannels.detailsJson,
      })
      .from(releaseCatalog)
      .innerJoin(
        releaseChannels,
        eq(releaseCatalog.id, releaseChannels.releaseId),
      )
      .where(inArray(releaseCatalog.canonicalKey, canonicalKeyChunk));
    for (const row of rows) {
      const releaseDate = row.channelReleaseDate ?? row.catalogReleaseDate;
      if (
        !releaseDate ||
        !isReleaseCategory(row.category) ||
        !isReleaseKind(row.releaseKind)
      ) {
        continue;
      }
      cachedPeers.push({
        canonicalKey: row.canonicalKey,
        release: {
          ...parseChannelDetails(row.channelDetailsJson),
          sourceKey: row.channelSourceKey,
          externalId: row.channelExternalId,
          title: row.title,
          brand: row.brand,
          category: row.category,
          releaseKind: row.releaseKind,
          releaseDate,
          releaseTime: row.channelReleaseTime,
          priceLabel: row.channelPriceLabel,
          styleCode: styleCodeFromCanonicalKey(row.canonicalKey),
          retailer: row.channelRetailer ?? "",
          productUrl: row.channelProductUrl ?? "",
          sourceUrl: row.channelSourceUrl ?? "",
          collectedAt: row.channelCollectedAt,
        },
      });
    }
  }

  const blockedIncomingIdentities = new Set<string>();
  const conflictWrites: ReviewWrite[] = [];
  for (const [identity, incoming] of incomingByIdentity) {
    for (const peer of cachedPeers) {
      if (
        peer.canonicalKey !== incoming.canonicalKey ||
        !incoming.channels.some((channel) =>
          releasesHaveConflictingSchedule(channel, peer.release)
        )
      ) {
        continue;
      }
      const incomingRank = sourceTierRank(incoming.channels[0].sourceKey);
      const peerRank = sourceTierRank(peer.release.sourceKey);
      if (incomingRank > peerRank) continue;
      blockedIncomingIdentities.add(identity);
      conflictWrites.push(
        sourceScopedReviewWrite(incoming.canonicalKey, incoming.channels),
        ...(incomingRank === peerRank
          ? [sourceScopedReviewWrite(peer.canonicalKey, [peer.release])]
          : []),
      );
    }
  }

  const acceptedGroups = groups.flatMap((group) => {
    const channels = sourceChannels(group, sourceKey).filter(
      (channel) =>
        !blockedIncomingIdentities.has(
          channelIdentity(channel.sourceKey, channel.externalId),
        ),
    );
    return channels.length > 0
      ? [{ ...group, release: channels[0], channels }]
      : [];
  });
  return {
    acceptedGroups,
    reviewWrites: uniqueReviewWrites(conflictWrites),
  };
}

async function planGroupWrites(
  db: CollectionDb,
  groups: ReleaseGroup[],
  sourceKey: string,
  collectedAt: string,
  writeGuard: SQL,
  writeGuardParameterCount: number,
  clearStaleChannels: boolean,
  retainedExternalIds?: string[],
  writeRevisionAt?: string,
): Promise<GroupWritePlan> {
  const revisionAt = writeRevisionAt ?? collectedAt;
  const canonicalKeys = [...new Set(groups.map(({ canonicalKey }) => canonicalKey))];
  const incomingChannels = groups.flatMap((group) =>
    sourceChannels(group, sourceKey),
  );
  const externalIds = [
    ...new Set(incomingChannels.map(({ externalId }) => externalId)),
  ];
  const staleRetentionIds = retainedExternalIds ?? externalIds;

  const existingChannels: ExistingChannel[] = await db
    .select({
      releaseId: releaseChannels.releaseId,
      sourceKey: releaseChannels.sourceKey,
      externalId: releaseChannels.externalId,
      releaseDate: releaseChannels.releaseDate,
      releaseTime: releaseChannels.releaseTime,
      priceLabel: releaseChannels.priceLabel,
      productUrl: releaseChannels.productUrl,
      collectedAt: releaseChannels.collectedAt,
    })
    .from(releaseChannels)
    .where(eq(releaseChannels.sourceKey, sourceKey));
  const incomingExternalIdSet = new Set(externalIds);
  const identityCatalogIds = [
    ...new Set(
      existingChannels
        .filter(({ externalId }) => incomingExternalIdSet.has(externalId))
        .map(({ releaseId }) => releaseId),
    ),
  ];
  const existingCatalogById = new Map<string, ExistingCatalog>();
  const addCatalogRows = (rows: ExistingCatalog[]) => {
    for (const row of rows) existingCatalogById.set(row.id, row);
  };

  for (const canonicalKeyChunk of chunksOf(
    canonicalKeys,
    D1_MAX_BOUND_PARAMETERS,
  )) {
    addCatalogRows(
      await db
          .select({
            id: releaseCatalog.id,
            canonicalKey: releaseCatalog.canonicalKey,
            title: releaseCatalog.title,
            brand: releaseCatalog.brand,
            releaseDate: releaseCatalog.releaseDate,
            releaseTime: releaseCatalog.releaseTime,
            lastVerifiedAt: releaseCatalog.lastVerifiedAt,
          })
          .from(releaseCatalog)
          .where(
            inArray(releaseCatalog.canonicalKey, canonicalKeyChunk),
          ),
    );
  }
  for (const idChunk of chunksOf(
    identityCatalogIds,
    D1_MAX_BOUND_PARAMETERS,
  )) {
    addCatalogRows(
      await db
        .select({
          id: releaseCatalog.id,
          canonicalKey: releaseCatalog.canonicalKey,
          title: releaseCatalog.title,
          brand: releaseCatalog.brand,
          releaseDate: releaseCatalog.releaseDate,
          releaseTime: releaseCatalog.releaseTime,
          lastVerifiedAt: releaseCatalog.lastVerifiedAt,
        })
        .from(releaseCatalog)
        .where(inArray(releaseCatalog.id, idChunk)),
    );
  }

  const catalogByKey = new Map(
    [...existingCatalogById.values()].map((release) => [
      release.canonicalKey,
      release,
    ]),
  );
  const channelByIdentity = new Map(
    existingChannels.map((channel) => [
      channelIdentity(channel.sourceKey, channel.externalId),
      channel,
    ]),
  );
  const releaseIdByKey = new Map<string, string>();
  const effectiveCanonicalKeyByKey = new Map<string, string>();
  const previousCatalogByKey = new Map<string, ExistingCatalog>();
  const writableGroups: ReleaseGroup[] = [];
  const collisionReviewGroups: ReleaseGroup[] = [];
  for (const group of groups) {
    const identityReleaseIds = [
      ...new Set(
        sourceChannels(group, sourceKey)
          .map((channel) =>
            channelByIdentity.get(
              channelIdentity(channel.sourceKey, channel.externalId),
            ),
          )
          .filter((channel): channel is ExistingChannel => Boolean(channel))
          .map(({ releaseId }) => releaseId),
      ),
    ].sort();
    const canonicalCatalog = catalogByKey.get(group.canonicalKey);
    const releaseId =
      identityReleaseIds.find((id) => id === canonicalCatalog?.id) ??
      identityReleaseIds[0] ??
      canonicalCatalog?.id ??
      catalogId(group.canonicalKey);
    const previousCatalog = existingCatalogById.get(releaseId);
    const canonicalCollision =
      canonicalCatalog && canonicalCatalog.id !== releaseId;

    if (canonicalCollision) {
      collisionReviewGroups.push({
        ...group,
        reviewReason: "possible_duplicate",
      });
      continue;
    }

    releaseIdByKey.set(group.canonicalKey, releaseId);
    effectiveCanonicalKeyByKey.set(
      group.canonicalKey,
      canonicalCollision && previousCatalog
        ? previousCatalog.canonicalKey
        : group.canonicalKey,
    );
    if (previousCatalog) {
      previousCatalogByKey.set(group.canonicalKey, previousCatalog);
    }
    writableGroups.push(group);
  }
  const queries: D1BatchQuery[] = [];

  if (clearStaleChannels) {
    const retained = new Set(staleRetentionIds);
    const staleExternalIds = existingChannels
      .map(({ externalId }) => externalId)
      .filter((externalId) => !retained.has(externalId));
    for (const staleChunk of chunksOf(
      staleExternalIds,
      D1_MAX_BOUND_PARAMETERS - 1 - writeGuardParameterCount,
    )) {
      queries.push(
        db
          .delete(releaseChannels)
          .where(
            and(
              eq(releaseChannels.sourceKey, sourceKey),
              inArray(releaseChannels.externalId, staleChunk),
              writeGuard,
            ),
          ),
      );
    }
  }

  const changeRows = writableGroups.flatMap((group) => {
    const releaseId = releaseIdByKey.get(group.canonicalKey)!;
    const previousCatalog = previousCatalogByKey.get(group.canonicalKey);
    const catalogChanges =
      previousCatalog === undefined ||
      (previousCatalog.lastVerifiedAt !== null &&
        previousCatalog.lastVerifiedAt > revisionAt)
        ? []
        : [
            ...(previousCatalog.title === group.release.title
              ? []
              : [
                  {
                    releaseId,
                    field: "title",
                    previousValue: previousCatalog.title,
                    nextValue: group.release.title,
                    changedAt: collectedAt,
                  },
                ]),
            ...(previousCatalog.brand === group.release.brand
              ? []
              : [
                  {
                    releaseId,
                    field: "brand",
                    previousValue: previousCatalog.brand,
                    nextValue: group.release.brand,
                    changedAt: collectedAt,
                  },
                ]),
          ];
    const channelChanges = sourceChannels(group, sourceKey).flatMap((channel) => {
      const previousChannel = channelByIdentity.get(
        channelIdentity(channel.sourceKey, channel.externalId),
      );
      if (
        !previousCatalog ||
        !previousChannel ||
        previousChannel.collectedAt > revisionAt
      ) {
        return [];
      }

      return changedFields(
        {
          releaseDate:
            previousChannel.releaseDate ?? previousCatalog.releaseDate ?? "",
          releaseTime: previousChannel.releaseTime,
          priceLabel: previousChannel.priceLabel,
          productUrl: previousChannel.productUrl ?? "",
        },
        channel,
      ).map((change) => ({
        releaseId,
        field: change.field,
        previousValue: change.previousValue,
        nextValue: change.nextValue,
        changedAt: collectedAt,
      }));
    });
    return [...catalogChanges, ...channelChanges];
  });

  const changeRowParameterCount =
    5 + writeGuardParameterCount;
  for (const changeChunk of chunksOf(
    changeRows,
    Math.floor(D1_MAX_BOUND_PARAMETERS / changeRowParameterCount),
  )) {
    queries.push(
      db.insert(releaseChanges).select(
        sql.join(
          changeChunk.map(
            (change) =>
              sql`select
                ${sql.raw("null")},
                ${change.releaseId},
                ${change.field},
                ${change.previousValue},
                ${change.nextValue},
                ${change.changedAt}
              where ${writeGuard}`,
          ),
          sql` union all `,
        ),
      ),
    );
  }

  const changedReleaseIds = new Set(changeRows.map(({ releaseId }) => releaseId));

  for (const group of writableGroups) {
    const releaseId = releaseIdByKey.get(group.canonicalKey)!;
    const previousCatalog = previousCatalogByKey.get(group.canonicalKey);
    const effectiveCanonicalKey =
      effectiveCanonicalKeyByKey.get(group.canonicalKey)!;
    const release = group.release;
    if (!previousCatalog) {
      queries.push(
        db
          .insert(releaseCatalog)
          .select(
            sql`select
              ${releaseId},
              ${effectiveCanonicalKey},
              ${release.title},
              ${release.brand},
              ${release.category},
              ${release.releaseKind},
              ${release.releaseDate},
              ${release.releaseTime},
              ${"published"},
              ${100},
              ${collectedAt},
              ${collectedAt},
              ${revisionAt},
              ${null}
            where ${writeGuard}`,
          )
          .onConflictDoNothing({ target: releaseCatalog.canonicalKey }),
      );
    }

    queries.push(
      db
        .update(releaseCatalog)
        .set({
          canonicalKey: effectiveCanonicalKey,
          title: release.title,
          brand: release.brand,
          category: release.category,
          releaseKind: release.releaseKind,
          releaseDate: release.releaseDate,
          releaseTime: release.releaseTime,
          status: "published",
          confidence: 100,
          updatedAt: collectedAt,
          lastVerifiedAt: revisionAt,
          ...(changedReleaseIds.has(releaseId)
            ? { changedAt: collectedAt }
            : {}),
        })
        .where(
          and(
            eq(releaseCatalog.id, releaseId),
            or(
              isNull(releaseCatalog.lastVerifiedAt),
              lte(releaseCatalog.lastVerifiedAt, revisionAt),
            ),
            writeGuard,
          ),
        ),
    );

    for (const channel of sourceChannels(group, sourceKey)) {
      queries.push(
        db
          .insert(releaseChannels)
          .select(
            sql`select
              ${channelId(channel.sourceKey, channel.externalId)},
              ${releaseId},
              ${channel.sourceKey},
              ${channel.externalId},
              ${channel.retailer},
              ${channel.productUrl},
              ${channel.sourceUrl},
              ${channel.priceLabel},
              ${channel.releaseDate},
              ${channel.releaseTime},
              ${revisionAt},
              ${channelDetailsJson(channel)}
            where ${writeGuard}`,
          )
          .onConflictDoNothing({
            target: [
              releaseChannels.sourceKey,
              releaseChannels.externalId,
            ],
          }),
      );
      queries.push(
        db
          .update(releaseChannels)
          .set({
            releaseId,
            retailer: channel.retailer,
            productUrl: channel.productUrl,
            sourceUrl: channel.sourceUrl,
            priceLabel: channel.priceLabel,
            releaseDate: channel.releaseDate,
            releaseTime: channel.releaseTime,
            collectedAt: revisionAt,
            detailsJson: channelDetailsJson(channel),
          })
          .where(
            and(
              eq(releaseChannels.sourceKey, channel.sourceKey),
              eq(releaseChannels.externalId, channel.externalId),
              lte(releaseChannels.collectedAt, revisionAt),
              writeGuard,
            ),
          ),
      );
    }
  }

  return {
    queries,
    newCount: writableGroups.filter(
      ({ canonicalKey }) => !previousCatalogByKey.has(canonicalKey),
    ).length,
    mergedCount: writableGroups.filter(({ canonicalKey }) =>
      previousCatalogByKey.has(canonicalKey),
    ).length,
    collisionReviewGroups,
  };
}

function sourceHealthQuery(
  db: CollectionDb,
  result: PersistSourceResult,
  counts: {
    sourceCount: number;
    newCount: number;
    mergedCount: number;
    reviewCount: number;
  },
  token: string,
): D1BatchQuery {
  const claimWhere = and(
    eq(releaseSources.sourceKey, result.sourceKey),
    eq(releaseSources.resultClaimToken, token),
  );
  if (result.status === "error") {
    return db
      .update(releaseSources)
      .set({
        status: result.status,
        lastFailureAt: result.collectedAt,
        consecutiveFailures: sql`${releaseSources.consecutiveFailures} + 1`,
        message: result.message,
        resultClaimToken: null,
        resultClaimedAt: null,
      })
      .where(claimWhere)
      .returning({ sourceKey: releaseSources.sourceKey });
  }

  if (result.status === "manual") {
    return db
      .update(releaseSources)
      .set({
        status: result.status,
        message: result.message,
        resultClaimToken: null,
        resultClaimedAt: null,
      })
      .where(claimWhere)
      .returning({ sourceKey: releaseSources.sourceKey });
  }

  return db
    .update(releaseSources)
    .set({
      status: result.status,
      lastSuccessAt: result.collectedAt,
      consecutiveFailures: 0,
      ...counts,
      message: result.message,
      resultClaimToken: null,
      resultClaimedAt: null,
    })
    .where(claimWhere)
    .returning({ sourceKey: releaseSources.sourceKey });
}

function returnedRowCount(batchResult: unknown): number {
  return Array.isArray(batchResult) ? batchResult.length : 0;
}

function currentSlotOutcome(
  slot: { status: string } | undefined,
): SlotClaimOutcome {
  if (slot?.status === "completed") return { state: "completed" };
  if (slot?.status === "failed") return { state: "failed" };
  return { state: "in_progress" };
}

function createRepository(provider: CollectionDbProvider): CollectionRepository {
  return {
    async claimSourceRefreshLock(sourceKey,startedAt,claimToken,staleBefore) {
      const db=await provider();
      const slotKey=`source-lock:${sourceKey}`;
      const row=await db.insert(collectionSlots).values({slotKey,status:"running",startedAt,completedAt:null,claimToken})
        .onConflictDoUpdate({target:collectionSlots.slotKey,set:{status:"running",startedAt,completedAt:null,claimToken},where:lte(collectionSlots.startedAt,staleBefore)})
        .returning({claimToken:collectionSlots.claimToken}).get();
      return row?.claimToken === claimToken;
    },
    async releaseSourceRefreshLock(sourceKey,claimToken) {
      const db=await provider();
      await db.delete(collectionSlots).where(and(eq(collectionSlots.slotKey,`source-lock:${sourceKey}`),eq(collectionSlots.claimToken,claimToken)));
    },
    async listCollectionSlots(slotKeys) {
      if (slotKeys.length === 0) return [];
      const db = await provider();
      const result: CollectionSlotSnapshot[] = [];
      for (const keys of chunksOf([...new Set(slotKeys)], D1_MAX_BOUND_PARAMETERS)) {
        const rows = await db.select({slotKey:collectionSlots.slotKey,status:collectionSlots.status,startedAt:collectionSlots.startedAt})
          .from(collectionSlots).where(inArray(collectionSlots.slotKey,keys)).orderBy(asc(collectionSlots.slotKey));
        for (const row of rows) {
          if (row.status === "running" || row.status === "completed" || row.status === "failed") result.push({...row,status:row.status});
        }
      }
      return result;
    },
    async claimSlot(slotKey, startedAt, claimToken, staleBefore, retryFailedBefore) {
      const db = await provider();
      const claimed = await db
        .insert(collectionSlots)
        .values({
          slotKey,
          status: "running",
          startedAt,
          completedAt: null,
          claimToken,
        })
        .onConflictDoNothing({ target: collectionSlots.slotKey })
        .returning({ slotKey: collectionSlots.slotKey })
        .get();
      if (claimed) {
        return { state: "claimed", claimToken, reclaimed: false };
      }

      const existing = await db
        .select({
          status: collectionSlots.status,
          startedAt: collectionSlots.startedAt,
          claimToken: collectionSlots.claimToken,
        })
        .from(collectionSlots)
        .where(eq(collectionSlots.slotKey, slotKey))
        .get();
      const retryFailed=existing?.status === "failed" && retryFailedBefore !== undefined && existing.startedAt <= retryFailedBefore;
      if (!existing || (existing.status !== "running" && !retryFailed)) {
        return currentSlotOutcome(existing);
      }
      if (!retryFailed && existing.startedAt > staleBefore) {
        return { state: "in_progress" };
      }

      const reclaimed = await db
        .update(collectionSlots)
        .set({ startedAt, completedAt: null, claimToken, status:"running" })
        .where(
          and(
            eq(collectionSlots.slotKey, slotKey),
            eq(collectionSlots.status, retryFailed ? "failed" : "running"),
            eq(collectionSlots.startedAt, existing.startedAt),
            existing.claimToken === null
              ? isNull(collectionSlots.claimToken)
              : eq(collectionSlots.claimToken, existing.claimToken),
            lte(collectionSlots.startedAt, retryFailed ? retryFailedBefore! : staleBefore),
          ),
        )
        .returning({ slotKey: collectionSlots.slotKey })
        .get();
      if (reclaimed) {
        return { state: "claimed", claimToken, reclaimed: true };
      }

      const current = await db
        .select({
          status: collectionSlots.status,
          startedAt: collectionSlots.startedAt,
          claimToken: collectionSlots.claimToken,
        })
        .from(collectionSlots)
        .where(eq(collectionSlots.slotKey, slotKey))
        .get();
      return currentSlotOutcome(current);
    },

    async completeSlot(slotKey, claimToken, completedAt) {
      const db = await provider();
      const completed = await db
        .update(collectionSlots)
        .set({ status: "completed", completedAt })
        .where(
          and(
            eq(collectionSlots.slotKey, slotKey),
            eq(collectionSlots.status, "running"),
            eq(collectionSlots.claimToken, claimToken),
          ),
        )
        .returning({ slotKey: collectionSlots.slotKey })
        .get();
      return Boolean(completed);
    },

    async failSlot(slotKey, claimToken, completedAt) {
      const db = await provider();
      const failed = await db
        .update(collectionSlots)
        .set({ status: "failed", completedAt })
        .where(
          and(
            eq(collectionSlots.slotKey, slotKey),
            eq(collectionSlots.status, "running"),
            eq(collectionSlots.claimToken, claimToken),
          ),
        )
        .returning({ slotKey: collectionSlots.slotKey })
        .get();
      return Boolean(failed);
    },

    async listCachedReleases() {
      const db = await provider();
      await backfillLegacyReleases(db);
      const rows = await db
        .select({
          id: releaseCatalog.id,
          canonicalKey: releaseCatalog.canonicalKey,
          title: releaseCatalog.title,
          brand: releaseCatalog.brand,
          category: releaseCatalog.category,
          releaseKind: releaseCatalog.releaseKind,
          releaseDate: releaseCatalog.releaseDate,
          releaseTime: releaseCatalog.releaseTime,
          changedAt: releaseCatalog.changedAt,
          lastVerifiedAt: releaseCatalog.lastVerifiedAt,
          updatedAt: releaseCatalog.updatedAt,
          channelSourceKey: releaseChannels.sourceKey,
          channelExternalId: releaseChannels.externalId,
          channelRetailer: releaseChannels.retailer,
          channelProductUrl: releaseChannels.productUrl,
          channelSourceUrl: releaseChannels.sourceUrl,
          channelPriceLabel: releaseChannels.priceLabel,
          channelReleaseDate: releaseChannels.releaseDate,
          channelReleaseTime: releaseChannels.releaseTime,
          channelDetailsJson: releaseChannels.detailsJson,
        })
        .from(releaseCatalog)
        .innerJoin(
          releaseChannels,
          eq(releaseCatalog.id, releaseChannels.releaseId),
        )
        .orderBy(
          asc(releaseCatalog.releaseDate),
          asc(releaseCatalog.releaseTime),
          asc(releaseCatalog.title),
          asc(releaseChannels.sourceKey),
          asc(releaseChannels.externalId),
        );

      const releases = new Map<string, CachedRelease>();
      for (const row of rows) {
        if (
          !isReleaseCategory(row.category) ||
          !isReleaseKind(row.releaseKind) ||
          !row.releaseDate
        ) {
          continue;
        }
        const cached =
          releases.get(row.id) ??
          ({
            id: row.id,
            canonicalKey: row.canonicalKey,
            title: row.title,
            brand: row.brand,
            category: row.category,
            releaseKind: row.releaseKind,
            releaseDate: row.channelReleaseDate ?? row.releaseDate,
            releaseTime: row.channelReleaseTime,
            changedAt: row.changedAt,
            lastVerifiedAt: row.lastVerifiedAt ?? row.updatedAt,
            channels: [],
          } satisfies CachedRelease);
        cached.channels.push({
          ...parseChannelDetails(row.channelDetailsJson),
          sourceKey: row.channelSourceKey,
          ...(row.channelExternalId !== undefined ? {externalId:row.channelExternalId} : {}),
          retailer: row.channelRetailer ?? "",
          productUrl: row.channelProductUrl ?? "",
          sourceUrl: row.channelSourceUrl ?? "",
          priceLabel: row.channelPriceLabel,
          releaseDate: row.channelReleaseDate ?? row.releaseDate,
          releaseTime: row.channelReleaseTime,
        });
        releases.set(row.id, cached);
      }
      return [...releases.values()];
    },

    async persistSourceResult(result) {
      const db = await provider();
      const token = await claimSourceResult(db, result);
      if (!token) return { reviewItemsCreated: 0 };
      const writeGuard = sourceClaimGuard(result.sourceKey, token);

      if (result.status !== "connected") {
        await runBatch(
          db,
          [
            sourceHealthQuery(db, result, {
              sourceCount: 0,
              newCount: 0,
              mergedCount: 0,
              reviewCount: 0,
            }, token),
          ],
        );
        return { reviewItemsCreated: 0 };
      }

      if (result.groups.length === 0) {
        const queries: D1BatchQuery[] = [];
        if (
          result.confirmedEmpty &&
          result.authoritativeSnapshot === true
        ) {
          queries.push(
            db
              .delete(releaseChannels)
              .where(
                and(
                  eq(releaseChannels.sourceKey, result.sourceKey),
                  writeGuard,
                ),
              ),
          );
        }
        queries.push(
          sourceHealthQuery(db, result, {
            sourceCount: 0,
            newCount: 0,
            mergedCount: 0,
            reviewCount: 0,
          }, token),
        );
        await runBatch(db, queries);
        return { reviewItemsCreated: 0 };
      }

      const classifiedAcceptedGroups = result.groups.filter(
        ({ reviewReason }) => reviewReason === null,
      );
      const reviewGroups = result.groups.filter(
        ({ reviewReason }) => reviewReason !== null,
      );
      const cachedConflictPlan = await planCachedScheduleConflicts(
        db,
        classifiedAcceptedGroups,
        result.sourceKey,
      );
      const acceptedGroups = cachedConflictPlan.acceptedGroups;
      const writePlan = await planGroupWrites(
        db,
        acceptedGroups,
        result.sourceKey,
        result.collectedAt,
        writeGuard,
        2,
        result.authoritativeSnapshot === true && acceptedGroups.length > 0,
        [
          ...new Set(
            result.groups.flatMap((group) =>
              sourceChannels(group, result.sourceKey).map(
                ({ externalId }) => externalId,
              ),
            ),
          ),
        ],
      );
      const persistedReviewWrites = uniqueReviewWrites([
        ...reviewGroups.map((group) => ({
          sourceKey: result.sourceKey,
          externalId: group.release.externalId,
          group,
        })),
        ...writePlan.collisionReviewGroups.map((group) => ({
          sourceKey: result.sourceKey,
          externalId: group.release.externalId,
          group,
        })),
        ...cachedConflictPlan.reviewWrites,
      ]);
      const reviewIdentities = new Map<
        string,
        { sourceKey: string; externalId: string }
      >();
      for (const group of result.groups) {
        for (const channel of sourceChannels(group, result.sourceKey)) {
          reviewIdentities.set(
            reviewWriteIdentity(result.sourceKey, channel.externalId),
            { sourceKey: result.sourceKey, externalId: channel.externalId },
          );
        }
      }
      for (const write of persistedReviewWrites) {
        reviewIdentities.set(
          reviewWriteIdentity(write.sourceKey, write.externalId),
          { sourceKey: write.sourceKey, externalId: write.externalId },
        );
      }
      const queries: D1BatchQuery[] = [...reviewIdentities.values()].map(
        ({ sourceKey, externalId }) =>
        db
          .update(reviewItems)
          .set({
            status: "ignored",
            resolvedAt: result.collectedAt,
            resolvedBy: `collector:${result.sourceKey}`,
            claimToken: null,
            claimedAt: null,
          })
          .where(
            and(
              eq(reviewItems.sourceKey, sourceKey),
              eq(reviewItems.externalId, externalId),
              eq(reviewItems.status, "pending"),
              lte(reviewItems.createdAt, result.collectedAt),
              writeGuard,
            ),
          ),
      );
      queries.push(...writePlan.queries);

      const reviewInsertIndexes: number[] = [];
      for (const write of persistedReviewWrites) {
        reviewInsertIndexes.push(queries.length);
        queries.push(
          db.insert(reviewItems).select(
            sql`select
              ${sql.raw("null")},
              ${write.sourceKey},
              ${write.externalId},
              ${write.group.reviewReason!},
              ${reviewPayload(write.group)},
              ${"pending"},
              ${result.collectedAt},
              ${null},
              ${null},
              ${null},
              ${null}
            where ${writeGuard}
              and ${noNewerPendingReviewGuard(
                write.sourceKey,
                write.externalId,
                result.collectedAt,
              )}`,
          ).returning({ id: reviewItems.id }),
        );
      }

      queries.push(
        sourceHealthQuery(db, result, {
          sourceCount: result.groups.reduce(
            (count, group) =>
              count + sourceChannels(group, result.sourceKey).length,
            0,
          ),
          newCount: writePlan.newCount,
          mergedCount: writePlan.mergedCount,
          reviewCount: persistedReviewWrites.filter(
            ({ sourceKey }) => sourceKey === result.sourceKey,
          ).length,
        }, token),
      );
      const batchResults = await runBatch(db, queries);
      return {
        reviewItemsCreated: reviewInsertIndexes.reduce(
          (count, index) => count + returnedRowCount(batchResults[index]),
          0,
        ),
      };
    },

    async listSourceHealth() {
      const db = await provider();
      const rows = await db
        .select()
        .from(releaseSources)
        .orderBy(asc(releaseSources.sourceKey));
      return rows.flatMap((row) =>
        isSourceStatus(row.status)
          ? [
              {
                sourceKey: row.sourceKey,
                status: row.status,
                lastSuccessAt: row.lastSuccessAt,
                lastFailureAt: row.lastFailureAt,
                consecutiveFailures: row.consecutiveFailures,
                sourceCount: row.sourceCount,
                newCount: row.newCount,
                mergedCount: row.mergedCount,
                reviewCount: row.reviewCount,
                message: row.message ?? "",
              },
            ]
          : [],
      );
    },

    async listReviewItems() {
      const db = await provider();
      const rows = await db
        .select()
        .from(reviewItems)
        .where(eq(reviewItems.status, "pending"))
        .orderBy(desc(reviewItems.createdAt), desc(reviewItems.id));
      return rows.flatMap((row) =>
        isReviewReason(row.reason) && isReviewStatus(row.status)
          ? [
              {
                id: row.id,
                sourceKey: row.sourceKey,
                externalId: row.externalId,
                reason: row.reason,
                payloadJson: row.payloadJson,
                status: row.status,
              },
            ]
          : [],
      );
    },

    async countPendingReviewItems() {
      const db = await provider();
      const row = await db
        .select({ count: sql<number>`count(*)` })
        .from(reviewItems)
        .where(eq(reviewItems.status, "pending"))
        .get();
      return Number(row?.count ?? 0);
    },

    async listPendingUndatedReviews() {
      const db = await provider();
      const rows = await db
        .select({
          id: reviewItems.id,
          sourceKey: reviewItems.sourceKey,
          externalId: reviewItems.externalId,
          reason: reviewItems.reason,
          payloadJson: reviewItems.payloadJson,
          status: reviewItems.status,
        })
        .from(reviewItems)
        .where(and(
          eq(reviewItems.reason, "missing_date"),
          eq(reviewItems.status, "pending"),
        ))
        .orderBy(desc(reviewItems.createdAt), desc(reviewItems.id))
        .limit(200);
      return rows.flatMap((row) =>
        isReviewReason(row.reason) && isReviewStatus(row.status)
          ? [{ id: row.id, sourceKey: row.sourceKey, externalId: row.externalId,
              reason: row.reason, payloadJson: row.payloadJson, status: row.status }]
          : [],
      );
    },

    // Retained for older repositories and callers using the Nike-only contract.
    async listPendingNikeMissingDateReviews() {
      const db = await provider();
      const rows = await db
        .select({
          id: reviewItems.id,
          sourceKey: reviewItems.sourceKey,
          externalId: reviewItems.externalId,
          reason: reviewItems.reason,
          payloadJson: reviewItems.payloadJson,
          status: reviewItems.status,
        })
        .from(reviewItems)
        .where(
          and(
            eq(reviewItems.sourceKey, "nike"),
            eq(reviewItems.reason, "missing_date"),
            eq(reviewItems.status, "pending"),
          ),
        )
        .orderBy(desc(reviewItems.createdAt), desc(reviewItems.id));
      return rows.flatMap((row) =>
        isReviewReason(row.reason) && isReviewStatus(row.status)
          ? [
              {
                id: row.id,
                sourceKey: row.sourceKey,
                externalId: row.externalId,
                reason: row.reason,
                payloadJson: row.payloadJson,
                status: row.status,
              },
            ]
          : [],
      );
    },

    async persistManualSnsRelease(result, collectedAt) {
      const db = await provider();
      const group = groupCollectedReleases([result.release])[0];
      if (!group) throw new Error("SNS release could not be grouped.");
      const persistResult: PersistSourceResult = {
        sourceKey: "sns",
        status: "manual",
        groups: [group],
        collectedAt,
        message: "Official Instagram announcement saved.",
        confirmedEmpty: false,
      };
      const token = await claimSourceResult(db, persistResult);
      if (!token) {
        return {
          status: "published",
          releaseId: catalogId(group.canonicalKey),
          externalId: result.release.externalId,
        };
      }
      const writeGuard = sourceClaimGuard("sns", token);
      const writePlan = await planGroupWrites(
        db,
        [group],
        "sns",
        collectedAt,
        writeGuard,
        2,
        false,
      );
      await runBatch(db, [
        ...writePlan.queries,
        sourceHealthQuery(
          db,
          persistResult,
          {
            sourceCount: 1,
            newCount: writePlan.newCount,
            mergedCount: writePlan.mergedCount,
            reviewCount: 0,
          },
          token,
        ),
      ]);
      return {
        status: "published",
        releaseId: catalogId(group.canonicalKey),
        externalId: result.release.externalId,
      };
    },

    async createManualSnsReview(result, collectedAt) {
      const db = await provider();
      const reviewRelease = {
        sourceKey: "sns",
        externalId: result.externalId,
        title: result.payload.title.trim(),
        brand: result.payload.brand.trim(),
        category: result.payload.category,
        releaseKind: result.payload.kind === "raffle" ? "raffle" : "general",
        releaseDate: "",
        releaseTime: result.payload.releaseTime,
        priceLabel: null,
        styleCode: result.payload.styleCode?.trim() || null,
        retailer: `SNS · @${result.payload.handle}`,
        productUrl: null,
        sourceUrl: result.payload.canonicalUrl,
        collectedAt,
      } satisfies CollectedRelease;
      const payloadJson = JSON.stringify({
        canonicalKey: `sns:${result.externalId}`,
        release: reviewRelease,
        channels: [reviewRelease],
        reviewReason: "missing_date",
      });
      const inserted = await db
        .insert(reviewItems)
        .select(
          sql`select
            ${sql.raw("null")},
            ${"sns"},
            ${result.externalId},
            ${"missing_date"},
            ${payloadJson},
            ${"pending"},
            ${collectedAt},
            ${null},
            ${null},
            ${null},
            ${null}
          where ${noNewerPendingReviewGuard("sns", result.externalId, collectedAt)}`,
        )
        .returning({ id: reviewItems.id })
        .get();
      if (inserted) {
        return { status: "review", reviewId: inserted.id, externalId: result.externalId };
      }
      const existing = await db
        .select({ id: reviewItems.id })
        .from(reviewItems)
        .where(
          and(
            eq(reviewItems.sourceKey, "sns"),
            eq(reviewItems.externalId, result.externalId),
            eq(reviewItems.status, "pending"),
          ),
        )
        .orderBy(desc(reviewItems.id))
        .get();
      if (!existing) throw new Error("SNS review could not be persisted.");
      return { status: "review", reviewId: existing.id, externalId: result.externalId };
    },

    async resolveReview(input) {
      const db = await provider();
      const item = await claimReviewItem(db, input.id);
      const token = item.claimToken!;
      const writeGuard = reviewClaimGuard(input.id, token);
      const resolvedAt = new Date().toISOString();
      const finishReview = (
        status: ReviewItem["status"],
        payloadJson = item.payloadJson,
      ) =>
        db
          .update(reviewItems)
          .set({
            status,
            payloadJson,
            resolvedAt,
            resolvedBy: input.resolvedBy,
            claimToken: null,
            claimedAt: null,
          })
          .where(
            and(
              eq(reviewItems.id, input.id),
              eq(reviewItems.status, "pending"),
              eq(reviewItems.claimToken, token),
            ),
          )
          .returning({ id: reviewItems.id });
      const runClaimedBatch = async (queries: D1BatchQuery[]) => {
        const results = await runBatch(db, queries);
        if (!batchResultHasRows(results.at(-1))) {
          throw new ReviewResolutionError("not_pending");
        }
      };

      try {
        if (input.action === "ignore") {
          await runClaimedBatch([finishReview("ignored")]);
          return;
        }

        const group = parseReviewPayload(item.payloadJson);
        if (input.action === "merge") {
          const target = await db
            .select({ id: releaseCatalog.id })
            .from(releaseCatalog)
            .where(eq(releaseCatalog.id, input.releaseId))
            .get();
          if (!target) {
            throw new ReviewResolutionError("merge_target_not_found");
          }

          const queries: D1BatchQuery[] = [];
          for (const channel of group.channels) {
            queries.push(
              db
                .insert(releaseChannels)
                .select(
                  sql`select
                    ${channelId(channel.sourceKey, channel.externalId)},
                    ${input.releaseId},
                    ${channel.sourceKey},
                    ${channel.externalId},
                    ${channel.retailer},
                    ${channel.productUrl},
                    ${channel.sourceUrl},
                    ${channel.priceLabel},
                    ${channel.releaseDate},
                    ${channel.releaseTime},
                    ${channel.collectedAt},
                    ${channelDetailsJson(channel)}
                  where ${writeGuard}`,
                )
                .onConflictDoNothing({
                  target: [
                    releaseChannels.sourceKey,
                    releaseChannels.externalId,
                  ],
                }),
            );
            queries.push(
              db
                .update(releaseChannels)
                .set({
                  releaseId: input.releaseId,
                  retailer: channel.retailer,
                  productUrl: channel.productUrl,
                  sourceUrl: channel.sourceUrl,
                  priceLabel: channel.priceLabel,
                  releaseDate: channel.releaseDate,
                  releaseTime: channel.releaseTime,
                  collectedAt: channel.collectedAt,
                  detailsJson: channelDetailsJson(channel),
                })
                .where(
                  and(
                    eq(releaseChannels.sourceKey, channel.sourceKey),
                    eq(releaseChannels.externalId, channel.externalId),
                    lte(
                      releaseChannels.collectedAt,
                      channel.collectedAt,
                    ),
                    writeGuard,
                  ),
                ),
            );
          }
          queries.push(finishReview("merged"));
          await runClaimedBatch(queries);
          return;
        }

        const approvedGroup =
          input.action === "edit"
            ? (() => {
                const release = {
                  ...group.release,
                  title: input.title,
                  releaseDate: input.releaseDate,
                  releaseTime: input.releaseTime,
                };
                const channels = group.channels.map((channel) => ({
                  ...channel,
                  title: input.title,
                  releaseDate: input.releaseDate,
                  releaseTime: input.releaseTime,
                }));
                return {
                  ...group,
                  release,
                  channels,
                  reviewReason: null,
                } satisfies ReleaseGroup;
              })()
            : { ...group, reviewReason: null };
        const writePlan = await planGroupWrites(
          db,
          [approvedGroup],
          item.sourceKey,
          resolvedAt,
          writeGuard,
          3,
          false,
          undefined,
          approvedGroup.release.collectedAt,
        );
        await runClaimedBatch([
          ...writePlan.queries,
          finishReview("approved", reviewPayload(approvedGroup)),
        ]);
      } catch (error) {
        await db
          .update(reviewItems)
          .set({ claimToken: null, claimedAt: null })
          .where(
            and(
              eq(reviewItems.id, input.id),
              eq(reviewItems.status, "pending"),
              eq(reviewItems.claimToken, token),
            ),
          );
        throw error;
      }
    },
  };
}

export function createCollectionRepositoryWithDb(
  db: CollectionDb,
): CollectionRepository {
  return createRepository(async () => db);
}

export function createCollectionRepository(): CollectionRepository {
  return createRepository(async () => {
    const { getDb } = await import("../../db/index.ts");
    return getDb();
  });
}
