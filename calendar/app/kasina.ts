import type { ExternalRelease, SourceFetchResult } from "./source-types";
import {
  isRecord,
  numberValue,
  SOURCE_CACHE_TTL_MS,
  SOURCE_REQUEST_TIMEOUT_MS,
  stringValue,
  withSourceRequest,
  won,
} from "./source-utils";

const KASINA_API_URL =
  "https://shop-api-secondary.shopby.co.kr/products/search?categoryNos=492883&pageSize=50&pageNumber=1&order.by=SALE_YMD&order.direction=DESC&filter.saleStatus=ALL_CONDITIONS&filter.soldout=false";
const KASINA_ORIGIN = "https://www.kasina.co.kr";
const TERMINAL_STATUS =
  /STOP|SOLD|END|CLOSE|FINISH|EXPIRE|CANCEL|품절|종료|마감|취소/i;

type CacheEntry = {
  expiresAt: number;
  releases: ExternalRelease[];
};

export type KasinaKstDateTime = {
  date: string;
  time: string;
  iso: string;
  timestamp: number;
};

let cacheEntry: CacheEntry | null = null;
let inFlight: Promise<SourceFetchResult> | null = null;

function positiveId(value: unknown) {
  const parsed = numberValue(value);
  return parsed !== null && Number.isSafeInteger(parsed) && parsed > 0
    ? String(parsed)
    : null;
}

/**
 * Shopby returns Kasina calendar values without an offset. They are KST wall
 * times, so attach +09:00 explicitly and verify the calendar fields to avoid a
 * deployment region silently shifting a launch.
 */
export function parseKasinaKstDateTime(
  value: unknown,
): KasinaKstDateTime | null {
  const raw = stringValue(value);
  const match = raw?.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) return null;

  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const time = `${match[4]}:${match[5]}`;
  const second = match[6] ?? "00";
  const iso = `${date}T${time}:${second}+09:00`;
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return null;

  const verified = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    verified.find((item) => item.type === type)?.value ?? "";

  if (
    `${part("year")}-${part("month")}-${part("day")}` !== date ||
    `${part("hour")}:${part("minute")}` !== time ||
    part("second") !== second
  ) {
    return null;
  }

  return { date, time, iso, timestamp };
}

function hasDrawProperty(value: unknown) {
  return (
    Array.isArray(value) &&
    value.some(
      (property) =>
        isRecord(property) &&
        (stringValue(property.propName)?.toUpperCase() === "DRAW" ||
          stringValue(property.propValue)?.toUpperCase() === "DRAW"),
    )
  );
}

function isFeaturedBrand(brand: string) {
  return /NIKE|JORDAN|ADIDAS|NEW BALANCE|ASICS|VANS|MIZUNO|CONVERSE/i.test(
    brand,
  );
}

function productUrl(productNo: string) {
  return new URL(
    `/product-detail/${encodeURIComponent(productNo)}`,
    KASINA_ORIGIN,
  ).toString();
}

export function normalizeKasinaProduct(
  value: unknown,
  now = new Date(),
): ExternalRelease | null {
  if (!isRecord(value)) return null;

  const productNo = positiveId(value.productNo);
  const title =
    stringValue(value.productName) ?? stringValue(value.productNameEn);
  const brand = stringValue(value.brandName) ?? "KASINA";
  const saleStatus = stringValue(value.saleStatusType) ?? "";
  if (
    !productNo ||
    !title ||
    value.isSoldOut === true ||
    TERMINAL_STATUS.test(saleStatus)
  ) {
    return null;
  }

  const directUrl = productUrl(productNo);
  const styleCode = stringValue(value.productManagementCd);
  const priceLabel = won(value.salePrice);
  const draw =
    hasDrawProperty(value.customProperties) && isRecord(value.reservationData);

  if (draw && isRecord(value.reservationData)) {
    const start = parseKasinaKstDateTime(
      value.reservationData.reservationStartYmdt,
    );
    const end = parseKasinaKstDateTime(
      value.reservationData.reservationEndYmdt,
    );
    if (
      !start ||
      !end ||
      end.timestamp <= start.timestamp ||
      end.timestamp <= now.getTime()
    ) {
      return null;
    }

    const externalId = `kasina:draw:${productNo}:${start.timestamp}`;
    return {
      id: externalId,
      externalId,
      title,
      brand,
      category: "응모",
      releaseDate: end.date,
      releaseTime: end.time,
      channel: "KASINA 응모",
      sourceName: "KASINA",
      sourceUrl: directUrl,
      status: "예정",
      confidence: 100,
      note: "카시나 공식 LAUNCHES 응모 일정입니다.",
      isFeatured: isFeaturedBrand(brand),
      retailer: "KASINA",
      releaseMethod: "응모",
      winnerMethod: "추첨",
      scheduleLabel: `${start.date} ${start.time} ~ ${end.date} ${end.time} 응모`,
      startAt: start.iso,
      endAt: end.iso,
      startTimeUnknown: false,
      endTimeUnknown: false,
      priceLabel,
      styleCode,
      region: "대한민국",
      marketScope: "korea",
      productUrl: directUrl,
      mode: "online",
    };
  }

  if (saleStatus.toUpperCase() !== "READY") return null;

  const start = parseKasinaKstDateTime(value.saleStartYmdt);
  if (!start || start.timestamp <= now.getTime()) return null;

  const externalId = `kasina:launch:${productNo}:${start.timestamp}`;
  return {
    id: externalId,
    externalId,
    title,
    brand,
    category: "선착순",
    releaseDate: start.date,
    releaseTime: start.time,
    channel: "KASINA LAUNCHES",
    sourceName: "KASINA",
    sourceUrl: directUrl,
    status: "예정",
    confidence: 100,
    note: "카시나 공식 LAUNCHES 온라인 발매 일정입니다.",
    isFeatured: isFeaturedBrand(brand),
    retailer: "KASINA",
    releaseMethod: "온라인 발매",
    scheduleLabel: `${start.date} ${start.time} 온라인 발매`,
    startAt: start.iso,
    startTimeUnknown: false,
    priceLabel,
    styleCode,
    region: "대한민국",
    marketScope: "korea",
    productUrl: directUrl,
    mode: "online",
  };
}

export function parseKasinaProducts(
  payload: unknown,
  now = new Date(),
): ExternalRelease[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new Error("KASINA 상품 목록 응답 형식 오류");
  }

  const releases = payload.items
    .map((item) => normalizeKasinaProduct(item, now))
    .filter((release): release is ExternalRelease => Boolean(release));

  return [
    ...new Map(
      releases.map((release) => [release.externalId, release]),
    ).values(),
  ].sort((left, right) => {
    const dateOrder = left.releaseDate.localeCompare(right.releaseDate);
    if (dateOrder) return dateOrder;
    const timeOrder = (left.releaseTime ?? "").localeCompare(
      right.releaseTime ?? "",
    );
    return timeOrder || left.title.localeCompare(right.title, "ko");
  });
}

async function fetchKasinaPayload() {
  return withSourceRequest(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SOURCE_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(KASINA_API_URL, {
        headers: {
          Accept: "application/json",
          company: "Kasina/Request",
          clientid: "183SVEgDg5nHbILW//3jvg==",
          platform: "PC",
          version: "1.0",
        },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`HTTP ${response.status}`);
      }
      return (await response.json()) as unknown;
    } finally {
      clearTimeout(timeout);
    }
  });
}

function stillUpcoming(release: ExternalRelease, now = Date.now()) {
  const timestamp = Date.parse(release.endAt ?? release.startAt ?? "");
  return Number.isFinite(timestamp) && timestamp > now;
}

function cachedReleases(now = Date.now()) {
  return (
    cacheEntry?.releases.filter((release) => stillUpcoming(release, now)) ?? []
  );
}

function connectedResult(releases: ExternalRelease[]): SourceFetchResult {
  return {
    status: "connected",
    releases,
    message: releases.length
      ? `공식 발매·응모 ${releases.length}건 확인 · 30분 캐시`
      : "오늘 이후 공식 발매·응모 일정 0건 · 30분 캐시",
  };
}

function staleFallback(message: string): SourceFetchResult {
  return {
    status: "error",
    releases: cachedReleases(),
    message: cacheEntry ? `${message} · 이전 성공 캐시 사용` : message,
  };
}

async function requestKasinaReleases(): Promise<SourceFetchResult> {
  try {
    const now = new Date();
    const releases = parseKasinaProducts(await fetchKasinaPayload(), now);
    cacheEntry = {
      expiresAt: Date.now() + SOURCE_CACHE_TTL_MS,
      releases,
    };
    return connectedResult(releases);
  } catch {
    return staleFallback("KASINA LAUNCHES 확인 실패");
  }
}

export async function fetchKasinaReleases(): Promise<SourceFetchResult> {
  if (cacheEntry && cacheEntry.expiresAt > Date.now()) {
    return connectedResult(cachedReleases());
  }

  if (!inFlight) {
    inFlight = requestKasinaReleases().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
