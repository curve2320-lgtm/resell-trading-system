import type { ExternalRelease, SourceFetchResult } from "./source-types";
import {
  fetchSourceJson,
  htmlText,
  isRecord,
  numberValue,
  seoulDateTime,
  SOURCE_CACHE_TTL_MS,
  stringValue,
  todayInSeoul,
  won,
} from "./source-utils";

const FILA_PRODUCTS_URL =
  "https://www.fila.co.kr/collections/all/products.json?limit=250&page=1";
const FILA_ORIGIN = "https://www.fila.co.kr";
const MAX_FUTURE_DAYS = 180;
const SEQUENTIAL_SHIPPING =
  /순차(?:\s*출고|적(?:으)?로\s*출고)|순차배송|순차\s*배송/i;
const EXACT_DATE =
  /\b(20\d{2})\s*(?:[-/.]\s*|년\s*)(\d{1,2})\s*(?:[-/.]\s*|월\s*)(\d{1,2})(?:\s*일)?\b/;
const MONTH_AND_DAY =
  /(?:^|[^\d])(\d{1,2})\s*(?:[/.]|월)\s*(\d{1,2})(?:\s*일)?(?:[^\d]|$)/;
const SOLD_OUT_TITLE =
  /(?:^|[\s<[(（])(?:품절|sold\s*out)(?:$|[\s>\])）])/i;

type CacheEntry = {
  expiresAt: number;
  result: SourceFetchResult;
};

type ParsedShippingDate = {
  date: string;
  inferredYear: boolean;
};

type NearbyDateMatch = {
  distance: number;
  value: string;
};

let cacheEntry: CacheEntry | null = null;
let inFlight: Promise<SourceFetchResult> | null = null;

function validCalendarDate(year: number, month: number, day: number) {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 2000 ||
    year > 2100
  ) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function withinRelevantWindow(date: string, today: string) {
  const value = Date.parse(`${date}T12:00:00+09:00`);
  const start = Date.parse(`${today}T12:00:00+09:00`);
  if (!Number.isFinite(value) || !Number.isFinite(start) || value < start) {
    return false;
  }
  return value - start <= MAX_FUTURE_DAYS * 24 * 60 * 60 * 1000;
}

function withinPublishedWindow(date: string, publishedDate: string) {
  const value = Date.parse(`${date}T12:00:00+09:00`);
  const published = Date.parse(`${publishedDate}T12:00:00+09:00`);
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(published) ||
    value < published
  ) {
    return false;
  }
  return value - published <= MAX_FUTURE_DAYS * 24 * 60 * 60 * 1000;
}

function exactDate(text: string) {
  const numeric = text.match(EXACT_DATE);
  if (!numeric) return null;
  return validCalendarDate(
    Number(numeric[1]),
    Number(numeric[2]),
    Number(numeric[3]),
  );
}

function monthAndDay(text: string) {
  const value = text.match(MONTH_AND_DAY);
  if (!value) return null;
  return { month: Number(value[1]), day: Number(value[2]) };
}

function nearestDateText(
  text: string,
  datePattern: RegExp,
): NearbyDateMatch | null {
  const shippingMatches = [
    ...text.matchAll(new RegExp(SEQUENTIAL_SHIPPING.source, "gi")),
  ];
  const dateMatches = [
    ...text.matchAll(new RegExp(datePattern.source, "gi")),
  ];
  let nearest: { distance: number; value: string } | null = null;

  for (const shipping of shippingMatches) {
    const shippingStart = shipping.index ?? 0;
    const shippingEnd = shippingStart + shipping[0].length;
    for (const date of dateMatches) {
      const dateStart = date.index ?? 0;
      const dateEnd = dateStart + date[0].length;
      const distance = Math.max(
        shippingStart - dateEnd,
        dateStart - shippingEnd,
        0,
      );
      if (distance <= 80 && (!nearest || distance < nearest.distance)) {
        nearest = { distance, value: date[0] };
      }
    }
  }

  return nearest;
}

function inferYearlessDate(
  month: number,
  day: number,
  publishedDate: string,
) {
  const published = publishedDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!published) return null;

  let year = Number(published[1]);
  const publishedMonthDay = `${published[2]}-${published[3]}`;
  const candidateMonthDay = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (candidateMonthDay < publishedMonthDay) year += 1;
  return validCalendarDate(year, month, day);
}

function nearbyShippingDate(
  text: string,
  publishedDate: string,
  today: string,
): ParsedShippingDate | null {
  const exactMatch = nearestDateText(text, EXACT_DATE);
  const partialMatch = nearestDateText(text, MONTH_AND_DAY);
  const exact = exactMatch ? exactDate(exactMatch.value) : null;
  const partial = partialMatch ? monthAndDay(partialMatch.value) : null;
  const exactMonthDay = exact?.slice(5);
  const partialMonthDay = partial
    ? `${String(partial.month).padStart(2, "0")}-${String(partial.day).padStart(2, "0")}`
    : null;
  const preferExact =
    exactMatch !== null &&
    exact !== null &&
    (!partialMatch ||
      exactMonthDay === partialMonthDay ||
      exactMatch.distance <= partialMatch.distance);

  if (
    preferExact &&
    exact &&
    withinRelevantWindow(exact, today) &&
    withinPublishedWindow(exact, publishedDate)
  ) {
    return { date: exact, inferredYear: false };
  }

  if (partial) {
    const inferred = inferYearlessDate(
      partial.month,
      partial.day,
      publishedDate,
    );
    if (
      inferred &&
      withinRelevantWindow(inferred, today) &&
      withinPublishedWindow(inferred, publishedDate)
    ) {
      return { date: inferred, inferredYear: true };
    }
  }

  return null;
}

function sequentialShippingDate(
  title: string,
  body: string,
  publishedDate: string,
  today: string,
): ParsedShippingDate | null {
  if (!SEQUENTIAL_SHIPPING.test(`${title} ${body}`)) return null;

  // Product labels such as "<7/31 순차출고>" are concise and authoritative.
  // If the label has no date, fall back to the date closest to the shipping
  // phrase in the description, not a separate reservation-period date.
  return (
    nearbyShippingDate(title, publishedDate, today) ??
    nearbyShippingDate(body, publishedDate, today)
  );
}

function cleanProductTitle(title: string) {
  return title
    .replace(
      /^\s*[<[(（]?\s*(?:20\d{2}\s*[-/.년]\s*)?\d{1,2}\s*[/.월]\s*\d{1,2}\s*일?\s*(?:이후|부터)?\s*순차\s*출고\s*[>\])）]?\s*/i,
      "",
    )
    .trim();
}

function productPrice(variants: unknown[]) {
  const prices = variants
    .filter(isRecord)
    .map((variant) => numberValue(variant.price))
    .filter((price): price is number => price !== null && price > 0);
  return prices.length ? won(Math.min(...prices)) : null;
}

function allVariantsUnavailable(variants: unknown[]) {
  const availability = variants
    .filter(isRecord)
    .map((variant) => variant.available)
    .filter((value): value is boolean => typeof value === "boolean");
  return availability.length > 0 && availability.every((value) => !value);
}

function productStyleCode(handle: string) {
  const normalized = handle.toUpperCase();
  return normalized.replace(/^\d{4}(?=[A-Z])/, "");
}

export function normalizeFilaProduct(
  value: unknown,
  now = new Date(),
): ExternalRelease | null {
  if (!isRecord(value)) return null;

  const rawTitle = stringValue(value.title);
  const handle = stringValue(value.handle);
  const rawBody = stringValue(value.body_html) ?? "";
  const body = htmlText(rawBody);
  const variants = Array.isArray(value.variants) ? value.variants : [];
  if (
    !rawTitle ||
    !handle ||
    SOLD_OUT_TITLE.test(rawTitle) ||
    allVariantsUnavailable(variants)
  ) {
    return null;
  }

  const today = todayInSeoul(now);
  const publishedDate =
    seoulDateTime(stringValue(value.published_at) ?? now)?.date ?? today;
  const shipping = sequentialShippingDate(
    rawTitle,
    body,
    publishedDate,
    today,
  );
  if (!shipping) return null;

  const title = cleanProductTitle(rawTitle) || rawTitle;
  const productUrl = new URL(
    `/products/${encodeURIComponent(handle)}`,
    FILA_ORIGIN,
  ).toString();
  const productId = numberValue(value.id);
  const externalId = `fila:${productId ?? handle}:${shipping.date}`;

  return {
    id: externalId,
    externalId,
    title,
    brand: stringValue(value.vendor) ?? "FILA",
    category: "정보",
    releaseDate: shipping.date,
    releaseTime: null,
    channel: "FILA Korea",
    sourceName: "FILA",
    sourceUrl: productUrl,
    status: "예정",
    confidence: shipping.inferredYear ? 95 : 100,
    note: "FILA 공식 상품 페이지에 안내된 예약판매 순차출고 일정입니다.",
    isFeatured: false,
    retailer: "FILA",
    releaseMethod: "순차출고(일반 발매)",
    scheduleLabel: `${shipping.date} 순차출고`,
    startTimeUnknown: true,
    priceLabel: productPrice(variants),
    styleCode: productStyleCode(handle),
    region: "대한민국",
    marketScope: "korea",
    shippingMethod: "순차출고",
    productUrl,
    mode: "online",
  };
}

export function parseFilaProducts(
  payload: unknown,
  now = new Date(),
): ExternalRelease[] {
  if (!isRecord(payload) || !Array.isArray(payload.products)) {
    throw new Error("FILA 상품 목록 응답 형식 오류");
  }

  const releases = payload.products
    .map((product) => normalizeFilaProduct(product, now))
    .filter((release): release is ExternalRelease => Boolean(release));

  return [
    ...new Map(
      releases.map((release) => [release.externalId, release]),
    ).values(),
  ].sort((left, right) => {
    const dateOrder = left.releaseDate.localeCompare(right.releaseDate);
    return dateOrder || left.title.localeCompare(right.title, "ko");
  });
}

function staleFallback(message: string): SourceFetchResult {
  if (!cacheEntry) return { status: "error", releases: [], message };
  return {
    ...cacheEntry.result,
    status: "error",
    message: `${message} · 이전 캐시 사용`,
  };
}

function connectedResult(releases: ExternalRelease[]): SourceFetchResult {
  return {
    status: "connected",
    releases,
    message: releases.length
      ? `공식 순차출고 ${releases.length}건 확인 · 30분 캐시`
      : "오늘 이후 공식 순차출고 일정 0건 · 30분 캐시",
  };
}

async function requestFilaReleases(): Promise<SourceFetchResult> {
  try {
    const releases = parseFilaProducts(
      await fetchSourceJson(FILA_PRODUCTS_URL),
    );
    const result = connectedResult(releases);
    cacheEntry = {
      expiresAt: Date.now() + SOURCE_CACHE_TTL_MS,
      result,
    };
    return result;
  } catch {
    return staleFallback("FILA 순차출고 확인 실패");
  }
}

export async function fetchFilaReleases(): Promise<SourceFetchResult> {
  if (cacheEntry && cacheEntry.expiresAt > Date.now()) {
    return cacheEntry.result;
  }

  if (!inFlight) {
    inFlight = requestFilaReleases().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
