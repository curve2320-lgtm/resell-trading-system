import type { ExternalRelease, SourceFetchResult } from "./source-types";
import {
  fetchSourceJson,
  isRecord,
  numberValue,
  seoulDateTime,
  stringValue,
} from "./source-utils";

const API_ORIGIN = "https://api.musinsa.com";
const SOURCE_ORIGIN = "https://www.musinsa.com";
const PAGE_SIZE = 50;
const MAX_PAGES_PER_STATUS = 10;
const CACHE_TTL_MS = 10 * 60 * 1000;
const RAFFLE_STATUSES = ["WIP", "SCHEDULED"] as const;

type MusinsaRaffleStatus = (typeof RAFFLE_STATUSES)[number];

type CacheEntry = {
  expiresAt: number;
  releases: ExternalRelease[];
};

export type MusinsaKstDateTime = {
  date: string;
  time: string;
  iso: string;
  timestamp: number;
};

export type MusinsaRafflePage = {
  page: number;
  size: number;
  totalElements: number;
  raffles: unknown[];
};

let cacheEntry: CacheEntry | null = null;
let inFlight: Promise<SourceFetchResult> | null = null;

function integerValue(value: unknown) {
  const parsed = numberValue(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function wonAmount(value: unknown) {
  const amount = numberValue(value);
  if (amount === null || amount < 0) return null;
  return `${new Intl.NumberFormat("ko-KR").format(amount)}원`;
}

function priceLabel(priceValue: unknown, normalPriceValue: unknown) {
  const price = wonAmount(priceValue);
  const normalPrice = wonAmount(normalPriceValue);

  if (price && normalPrice && price !== normalPrice) {
    return `${price} · 정가 ${normalPrice}`;
  }
  return price ?? normalPrice;
}

/**
 * MUSINSA raffle timestamps omit an offset even though they represent Korea
 * local time. This helper makes that KST contract explicit before parsing.
 */
export function parseMusinsaKstDateTime(
  value: unknown,
): MusinsaKstDateTime | null {
  const raw = stringValue(value);
  if (!raw) return null;

  const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw);
  const parsed = new Date(hasOffset ? raw : `${raw}+09:00`);
  if (Number.isNaN(parsed.getTime())) return null;

  const seoul = seoulDateTime(parsed);
  if (!seoul) return null;

  return {
    ...seoul,
    iso: parsed.toISOString(),
    timestamp: parsed.getTime(),
  };
}

export function parseMusinsaRafflePage(
  payload: unknown,
): MusinsaRafflePage | null {
  if (!isRecord(payload) || !isRecord(payload.data)) return null;

  const page = integerValue(payload.data.page);
  const size = integerValue(payload.data.size);
  const totalElements = integerValue(payload.data.totalElements);
  const raffles = payload.data.raffles;

  if (
    page === null ||
    page < 0 ||
    size === null ||
    size <= 0 ||
    totalElements === null ||
    totalElements < 0 ||
    !Array.isArray(raffles)
  ) {
    return null;
  }

  return {
    page,
    size,
    totalElements,
    raffles,
  };
}

export function normalizeMusinsaRaffle(
  value: unknown,
  now = new Date(),
): ExternalRelease | null {
  if (!isRecord(value)) return null;

  const raffleNo = integerValue(value.raffleNo);
  const title = stringValue(value.goodsName) ?? stringValue(value.title);
  const start = parseMusinsaKstDateTime(value.entryStartTime);
  const end = parseMusinsaKstDateTime(value.entryEndTime);

  if (
    raffleNo === null ||
    raffleNo < 1 ||
    !title ||
    !start ||
    !end ||
    end.timestamp <= now.getTime()
  ) {
    return null;
  }

  const brand = stringValue(value.brandName) ?? "MUSINSA";
  const announcement = parseMusinsaKstDateTime(value.winningTime);
  const purchaseStart = parseMusinsaKstDateTime(value.purchaseStartTime);
  const purchaseEnd = parseMusinsaKstDateTime(value.purchaseEndTime);
  const winnerCount = integerValue(value.winnerCount);
  const sourceUrl = new URL(
    `/events/raffle/${encodeURIComponent(String(raffleNo))}`,
    SOURCE_ORIGIN,
  ).toString();
  const externalId = `musinsa:${raffleNo}`;

  return {
    id: externalId,
    externalId,
    title,
    brand,
    category: "응모",
    releaseDate: end.date,
    releaseTime: end.time,
    channel: "MUSINSA 래플",
    sourceName: "MUSINSA",
    sourceUrl,
    status: "예정",
    confidence: 100,
    note: "응모 조건과 구매 안내는 무신사 공식 래플 상세에서 확인하세요.",
    isFeatured: /NIKE|JORDAN|나이키|조던/i.test(brand),
    retailer: "MUSINSA",
    releaseMethod: "응모",
    winnerMethod:
      winnerCount !== null && winnerCount > 0
        ? `추첨 · ${winnerCount.toLocaleString("ko-KR")}명`
        : "추첨",
    paymentMethod:
      purchaseStart && purchaseEnd
        ? `${purchaseStart.date} ${purchaseStart.time} - ${purchaseEnd.date} ${purchaseEnd.time} 구매`
        : purchaseStart
          ? `${purchaseStart.date} ${purchaseStart.time} 구매 시작`
          : null,
    scheduleLabel: `${start.date} ${start.time} - ${end.date} ${end.time} 응모`,
    startAt: start.iso,
    endAt: end.iso,
    announcementAt: announcement?.iso ?? null,
    startTimeUnknown: false,
    endTimeUnknown: false,
    priceLabel: priceLabel(value.price, value.normalPrice),
    region: "대한민국",
    marketScope: "korea",
    productUrl: sourceUrl,
    appOnly: true,
    mode: "online",
  };
}

function listUrl(status: MusinsaRaffleStatus, page: number) {
  const url = new URL("/api2/campaign/raffle/v1/raffles", API_ORIGIN);
  url.searchParams.set("status", status);
  url.searchParams.set("page", String(page));
  url.searchParams.set("size", String(PAGE_SIZE));
  return url.toString();
}

async function fetchStatusPages(status: MusinsaRaffleStatus) {
  const raffles: unknown[] = [];
  let nextPage = 0;

  for (let requestCount = 0; requestCount < MAX_PAGES_PER_STATUS; requestCount += 1) {
    const parsed = parseMusinsaRafflePage(
      await fetchSourceJson(listUrl(status, nextPage)),
    );
    if (!parsed) throw new Error("MUSINSA API 응답 형식 오류");

    raffles.push(...parsed.raffles);
    const fetchedThrough = (parsed.page + 1) * parsed.size;
    if (
      parsed.raffles.length === 0 ||
      fetchedThrough >= parsed.totalElements
    ) {
      return raffles;
    }

    const followingPage = parsed.page + 1;
    if (followingPage <= nextPage) {
      throw new Error("MUSINSA API 페이지 정보 오류");
    }
    nextPage = followingPage;
  }

  throw new Error("MUSINSA API 페이지 제한 초과");
}

function unexpired(release: ExternalRelease, now = Date.now()) {
  if (!release.endAt) return false;
  const end = new Date(release.endAt).getTime();
  return Number.isFinite(end) && end > now;
}

function cachedReleases(now = Date.now()) {
  return cacheEntry?.releases.filter((release) => unexpired(release, now)) ?? [];
}

function staleFallback(message: string): SourceFetchResult {
  const releases = cachedReleases();
  return {
    status: "error",
    releases,
    message: cacheEntry ? `${message} · 이전 캐시 사용` : message,
  };
}

async function requestMusinsaReleases(): Promise<SourceFetchResult> {
  try {
    const pages = await Promise.all(
      RAFFLE_STATUSES.map((status) => fetchStatusPages(status)),
    );
    const now = new Date();
    const releases = pages
      .flat()
      .map((item) => normalizeMusinsaRaffle(item, now))
      .filter((release): release is ExternalRelease => Boolean(release));
    const deduplicated = [
      ...new Map(releases.map((release) => [release.externalId, release])).values(),
    ].sort((left, right) =>
      `${left.releaseDate}${left.releaseTime ?? "99:99"}`.localeCompare(
        `${right.releaseDate}${right.releaseTime ?? "99:99"}`,
      ),
    );

    cacheEntry = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      releases: deduplicated,
    };

    return {
      status: "connected",
      releases: deduplicated,
      message: `진행 중·진행 예정 ${deduplicated.length}건 · 10분 캐시`,
    };
  } catch {
    return staleFallback("MUSINSA 래플 확인 실패");
  }
}

export async function fetchMusinsaReleases(): Promise<SourceFetchResult> {
  if (cacheEntry && cacheEntry.expiresAt > Date.now()) {
    const releases = cachedReleases();
    return {
      status: "connected",
      releases,
      message: `진행 중·진행 예정 ${releases.length}건 · 10분 캐시`,
    };
  }

  if (!inFlight) {
    inFlight = requestMusinsaReleases().finally(() => {
      inFlight = null;
    });
  }

  return inFlight;
}
