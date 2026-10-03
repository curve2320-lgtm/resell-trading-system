import type { ExternalRelease } from "./source-types";
import { withSourceRequest } from "./source-utils";

type JsonRecord = Record<string, unknown>;

export type ShoeprizeRelease = ExternalRelease & {
  sourceName: "SHOEPRIZE";
};

export type ShoeprizeFetchResult = {
  status: "connected" | "error";
  releases: ShoeprizeRelease[];
  message: string;
};

type CacheEntry = {
  expiresAt: number;
  releases: ShoeprizeRelease[];
};

const API_URL =
  "https://api.shoeprize.com/api/v2/releases/?page=1&page_size=100&is_end=false&ordering=start_time,-id";
const SOURCE_ORIGIN = "https://www.shoeprize.com";
const CACHE_TTL_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;

let cacheEntry: CacheEntry | null = null;
let inFlight: Promise<ShoeprizeFetchResult> | null = null;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function seoulDateTime(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";

  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

function categoryFor(method: string, type: number | null): ShoeprizeRelease["category"] {
  if (type === 1) return "응모";
  if (type === 0) return "선착순";
  const normalized = method.toLowerCase();
  if (/응모|드로우|래플|라플|추첨|당첨|draw|raffle/.test(normalized)) return "응모";
  if (/선착순|first/.test(normalized)) return "선착순";
  return "정보";
}

function priceLabel(value: unknown, currencyValue: unknown) {
  const price = numberValue(value);
  const currency = stringValue(currencyValue)?.toUpperCase();
  if (price === null || price <= 0 || !currency) return null;

  try {
    return new Intl.NumberFormat("ko-KR", {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "KRW" ? 0 : 2,
    }).format(price);
  } catch {
    return `${price.toLocaleString("ko-KR")} ${currency}`;
  }
}

function sourceUrl(permalink: string | null) {
  if (!permalink) return `${SOURCE_ORIGIN}/today`;
  return new URL(`/product/${encodeURIComponent(permalink)}`, SOURCE_ORIGIN).toString();
}

function externalUrl(value: unknown) {
  const candidate = stringValue(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function isoTimestamp(value: number | null) {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeShoeprizeItem(value: unknown): ShoeprizeRelease | null {
  if (!isRecord(value)) return null;
  if (value.isExpired === true) return null;

  const releaseId = stringValue(value.id) ?? stringValue(value.uuid);
  const product = isRecord(value.product) ? value.product : {};
  const market = isRecord(value.releaseMarket) ? value.releaseMarket : {};
  const title = stringValue(product.name) ?? stringValue(product.nameEn);
  const brand = stringValue(product.brandName) ?? "브랜드 미상";
  const method = stringValue(value.method) ?? "발매 정보";
  const type = numberValue(value.type);
  const category = categoryFor(method, type);
  const isDraw = category === "응모";
  const startTimestamp = numberValue(value.startTimestamp);
  const endTimestamp =
    numberValue(value.closedTimestamp) ?? numberValue(value.endTimestamp);
  const eventTimestamp = isDraw
    ? endTimestamp ?? startTimestamp
    : startTimestamp ?? endTimestamp;

  if (!releaseId || !title || eventTimestamp === null) return null;

  const { date, time } = seoulDateTime(eventTimestamp);
  const timeIsUndefined = isDraw
    ? value.isUndefinedEndTime === true
    : value.isUndefinedStartTime === true;
  const marketName = stringValue(market.name) ?? "발매처 미상";
  const region = stringValue(value.region);
  const marketScope: ExternalRelease["marketScope"] =
    value.isDomesticSite === false
      ? "overseas"
      : value.isDomesticSite === true
        ? "korea"
        : undefined;
  const shippingMethod = stringValue(value.shippingMethod);
  const paymentMethod = stringValue(value.payMethod);
  const styleCode = stringValue(product.code);
  const price =
    priceLabel(value.salePrice, value.salePriceCurrency) ??
    stringValue(value.price);
  const startAt = isoTimestamp(startTimestamp);
  const endAt = isoTimestamp(endTimestamp);
  const announcementAt = isoTimestamp(numberValue(value.announcedTimestamp));

  return {
    id: `shoeprize:${releaseId}`,
    externalId: `shoeprize:${releaseId}`,
    title,
    brand,
    category,
    releaseDate: date,
    releaseTime: timeIsUndefined ? null : time,
    channel: region ? `${marketName} · ${region}` : marketName,
    sourceName: "SHOEPRIZE",
    sourceUrl: sourceUrl(stringValue(product.permalink)),
    status: "예정",
    confidence: 96,
    note: "일정·재고·구매 조건은 판매처 사정에 따라 바뀔 수 있습니다.",
    isFeatured: brand === "NIKE" || brand === "JORDAN",
    retailer: marketName,
    releaseMethod: category === "응모" ? "응모" : method,
    winnerMethod: category === "응모" ? method : null,
    paymentMethod,
    scheduleLabel: stringValue(value.dateInfo),
    startAt,
    endAt,
    announcementAt,
    startTimeUnknown: value.isUndefinedStartTime === true,
    endTimeUnknown: value.isUndefinedEndTime === true,
    priceLabel: price,
    styleCode,
    region,
    marketScope,
    shippingMethod,
    productUrl: externalUrl(value.url),
    appOnly: market.isUseApp === true,
    mode: stringValue(value.mode),
  };
}

function staleFallback(message: string): ShoeprizeFetchResult {
  return {
    status: "error",
    releases: cacheEntry?.releases ?? [],
    message: cacheEntry?.releases.length ? `${message} · 이전 캐시 사용` : message,
  };
}

async function requestReleases(): Promise<ShoeprizeFetchResult> {
  return withSourceRequest(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(API_URL, {
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if (response.status === 429) return staleFallback("호출 제한 대기 중");
        return staleFallback(`SHOEPRIZE API 오류 (${response.status})`);
      }

      const payload = (await response.json()) as unknown;
      const items =
        isRecord(payload) && Array.isArray(payload.results) ? payload.results : [];
      const releases = items
        .map(normalizeShoeprizeItem)
        .filter((release): release is ShoeprizeRelease => Boolean(release));

      cacheEntry = {
        expiresAt: Date.now() + CACHE_TTL_MS,
        releases,
      };

      return {
        status: "connected",
        releases,
        message: `정상 연결 · 15분 캐시`,
      };
    } catch {
      return staleFallback("SHOEPRIZE API 응답 지연");
    } finally {
      clearTimeout(timeout);
    }
  });
}

export async function fetchShoeprizeReleases(): Promise<ShoeprizeFetchResult> {
  if (cacheEntry && cacheEntry.expiresAt > Date.now()) {
    return {
      status: "connected",
      releases: cacheEntry.releases,
      message: "정상 연결 · 15분 캐시",
    };
  }

  if (!inFlight) {
    inFlight = requestReleases().finally(() => {
      inFlight = null;
    });
  }

  return inFlight;
}
