import type {
  ExternalRelease,
  SourceFetchResult,
  UndatedRelease,
} from "./source-types";
import {
  fetchSourceJson,
  htmlText,
  isRecord,
  numberValue,
  SOURCE_CACHE_TTL_MS,
  stringValue,
  won,
} from "./source-utils";

const TUNE_PRODUCTS_URL =
  "https://tuneglobal.myshopify.com/products.json?limit=250";
const TUNE_ORIGIN = "https://tune.kr";
const TUNE_PAGE_SIZE = 250;
const TUNE_MAX_PAGES = 8;
const TUNE_UNDATED_RECENCY_DAYS = 45;
const RELEASE_PRODUCT_TYPE =
  /(?:shoe|sneaker|footwear|apparel|clothing|accessor|bag|cap|hat|신발|의류|가방|모자)/iu;
const RELEASE_TAG =
  /(?:raffle|draw|launch|release|drop|limited|exclusive|collab|new\s*arrival|발매|출시|응모|한정|협업|신상품)/iu;
const STYLE_CODE =
  /(?:style\s*(?:code|no\.?)|스타일\s*(?:코드|넘버)|품번)\s*[:：#]?\s*([A-Z0-9]{6,}(?:[.\-][A-Z0-9]{2,})?)/iu;
const SCHEDULE =
  /(?:release|launch|raffle|draw|발매|출시|응모)(?:\s*(?:date|schedule|일정|마감))?\s*[:：-]?\s*(20\d{2})\s*(?:[./-]|년)\s*(\d{1,2})\s*(?:[./-]|월)\s*(\d{1,2})(?:\s*일)?(?:\s+(\d{1,2}):(\d{2}))?/iu;

export type ParsedTuneProducts = {
  releases: ExternalRelease[];
  undated: UndatedRelease[];
  malformedRows: number;
};

type TuneFetchResult = SourceFetchResult & {
  malformedRows: number;
};

type CacheEntry = {
  expiresAt: number;
  result: TuneFetchResult;
};

let cacheEntry: CacheEntry | null = null;
let inFlight: Promise<TuneFetchResult> | null = null;

export type TuneProductPages = {
  products: unknown[];
  truncated: boolean;
  malformedPages: number;
};

function normalizedStyleCode(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function productPrice(variants: unknown[]) {
  const prices = variants
    .filter(isRecord)
    .map((variant) => numberValue(variant.price))
    .filter((price): price is number => price !== null && price > 0);
  return prices.length ? won(Math.min(...prices)) : null;
}

function productTags(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map(stringValue)
      .filter((tag): tag is string => Boolean(tag));
  }
  const tags = stringValue(value);
  return tags ? tags.split(",").map((tag) => tag.trim()).filter(Boolean) : [];
}

function styleCode(text: string, variants: unknown[]) {
  const bodyMatch = text.match(STYLE_CODE)?.[1];
  if (bodyMatch) return bodyMatch.toUpperCase().replace(".", "-");

  for (const variant of variants) {
    if (!isRecord(variant)) continue;
    const sku = stringValue(variant.sku);
    const candidate = sku?.match(/\b([A-Z0-9]{6,}(?:[.\-][A-Z0-9]{2,})?)/iu)?.[1];
    if (candidate) return candidate.toUpperCase().replace(".", "-");
  }
  return null;
}

function explicitSchedule(text: string) {
  const match = text.match(SCHEDULE);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] === undefined ? null : Number(match[4]);
  const minute = match[5] === undefined ? null : Number(match[5]);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day ||
    (hour !== null && (hour > 23 || minute === null || minute > 59))
  ) {
    return null;
  }
  return {
    date:
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    time:
      hour === null
        ? null
        : `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

function availableSchedules(releases: readonly ExternalRelease[]) {
  const schedules = new Map<
    string,
    { date: string; time: string | null; category: ExternalRelease["category"] }
  >();
  for (const release of releases) {
    const key = normalizedStyleCode(release.styleCode);
    if (key && /^\d{4}-\d{2}-\d{2}$/.test(release.releaseDate)) {
      schedules.set(key, {
        date: release.releaseDate,
        time: release.releaseTime,
        category: release.category,
      });
    }
  }
  return schedules;
}

function recentlyPublished(value: string, now: Date) {
  const publishedAt = Date.parse(value);
  if (!Number.isFinite(publishedAt)) return null;
  const age = now.getTime() - publishedAt;
  return (
    age >= -24 * 60 * 60 * 1000 &&
    age <= TUNE_UNDATED_RECENCY_DAYS * 24 * 60 * 60 * 1000
  );
}

function releaseRelevant(productType: string | null, tags: string[]) {
  return Boolean(
    productType &&
      RELEASE_PRODUCT_TYPE.test(productType) &&
      tags.some((tag) => RELEASE_TAG.test(tag)),
  );
}

export function parseTuneProducts(
  payload: unknown,
  availableReleases: readonly ExternalRelease[] = [],
  _now = new Date(),
): ParsedTuneProducts {
  if (!isRecord(payload) || !Array.isArray(payload.products)) {
    throw new Error("TUNE 상품 목록 응답 형식 오류");
  }

  const context = availableSchedules(availableReleases);
  const releases: ExternalRelease[] = [];
  const undated: UndatedRelease[] = [];
  const seenProducts = new Set<string>();
  let malformedRows = 0;

  for (const value of payload.products) {
    if (!isRecord(value)) {
      malformedRows += 1;
      continue;
    }
    const title = stringValue(value.title);
    const handle = stringValue(value.handle);
    const body = htmlText(stringValue(value.body_html) ?? "");
    const tags = productTags(value.tags);
    const productType = stringValue(value.product_type);
    const publishedAt = stringValue(value.published_at);
    const variants = Array.isArray(value.variants) ? value.variants : [];
    const combined = [title, body, ...tags].filter(Boolean).join(" ");
    const explicit = explicitSchedule(combined);
    const relevant = releaseRelevant(productType, tags);
    if (!relevant) continue;
    const recent = publishedAt ? recentlyPublished(publishedAt, _now) : null;
    if (recent === null) {
      malformedRows += 1;
      continue;
    }
    if (!explicit && !recent) continue;

    const code = styleCode(combined, variants);
    const normalizedCode = normalizedStyleCode(code);
    if (!title || !handle) {
      malformedRows += 1;
      continue;
    }

    const productUrl = new URL(
      `/products/${encodeURIComponent(handle)}`,
      TUNE_ORIGIN,
    ).toString();
    const productId = numberValue(value.id);
    const externalId = `tune:${productId ?? handle}`;
    const identity = normalizedCode ? `style:${normalizedCode}` : externalId;
    if (seenProducts.has(identity)) continue;
    seenProducts.add(identity);

    const inherited = context.get(normalizedCode);
    const schedule = explicit ?? inherited ?? null;
    const raffle =
      /RAFFLE|DRAW|래플|응모|추첨/iu.test(combined) ||
      inherited?.category === "응모";
    const priceLabel = productPrice(variants);
    const brand = stringValue(value.vendor) ?? "TUNE";

    if (!schedule) {
      undated.push({
        id: externalId,
        title,
        sourceUrl: productUrl,
        note:
          "TUNE 공식 상품이지만 확인된 발매 일정이 없어 날짜 미확정 검수 후보입니다.",
        brand,
        priceLabel,
        styleCode: code,
        productUrl,
      });
      continue;
    }

    const inheritedSchedule = explicit === null && inherited !== undefined;
    releases.push({
      id: externalId,
      externalId,
      title,
      brand,
      category: raffle ? "응모" : "정보",
      releaseDate: schedule.date,
      releaseTime: schedule.time,
      channel: raffle ? "TUNE 응모" : "TUNE",
      sourceName: "TUNE",
      sourceUrl: productUrl,
      status: "예정",
      confidence: inheritedSchedule ? 95 : 100,
      note: inheritedSchedule
        ? "동일 스타일 코드의 확인된 공식 일정에 TUNE 판매 정보를 연결했습니다."
        : "TUNE 공식 상품 페이지에 명시된 발매 일정입니다.",
      isFeatured: true,
      retailer: "TUNE",
      releaseMethod: raffle ? "응모" : "온라인 발매",
      scheduleLabel:
        `${schedule.date}${schedule.time ? ` ${schedule.time}` : ""}`,
      startTimeUnknown: schedule.time === null,
      priceLabel,
      styleCode: code,
      region: "대한민국",
      marketScope: "korea",
      productUrl,
      mode: "online",
    });
  }

  return { releases, undated, malformedRows };
}

function staleFallback(
  message: string,
  malformedRows = 0,
): TuneFetchResult {
  if (!cacheEntry) {
    return {
      status: "error",
      releases: [],
      undated: [],
      message,
      malformedRows,
    };
  }
  return {
    ...cacheEntry.result,
    status: "error",
    message: `${message} · 이전 성공 캐시 사용`,
    malformedRows,
  };
}

export async function fetchTuneProductPages(
  fetchJson: (url: string) => Promise<unknown> = fetchSourceJson,
): Promise<TuneProductPages> {
  const products: unknown[] = [];

  for (let page = 1; page <= TUNE_MAX_PAGES; page += 1) {
    const url =
      page === 1 ? TUNE_PRODUCTS_URL : `${TUNE_PRODUCTS_URL}&page=${page}`;
    const payload = await fetchJson(url);
    if (!isRecord(payload) || !Array.isArray(payload.products)) {
      return { products, truncated: true, malformedPages: 1 };
    }

    products.push(...payload.products);
    if (payload.products.length < TUNE_PAGE_SIZE) {
      return { products, truncated: false, malformedPages: 0 };
    }
  }

  return { products, truncated: true, malformedPages: 0 };
}

async function requestTuneReleases(): Promise<TuneFetchResult> {
  try {
    const pages = await fetchTuneProductPages();
    const parsed = parseTuneProducts({ products: pages.products });
    const malformedRows = parsed.malformedRows + pages.malformedPages;
    if (pages.truncated) {
      return staleFallback(
        `TUNE 상품 페이지 잘림 1 · 형식 오류 ${malformedRows}`,
        malformedRows,
      );
    }
    const result: TuneFetchResult = {
      status: "connected",
      releases: parsed.releases,
      undated: parsed.undated,
      message:
        `공식 발매 ${parsed.releases.length}건` +
        ` · 날짜 미확정 ${parsed.undated.length}건` +
        ` · 형식 오류 ${malformedRows} · 30분 캐시`,
      malformedRows,
    };
    cacheEntry = {
      expiresAt: Date.now() + SOURCE_CACHE_TTL_MS,
      result,
    };
    return result;
  } catch {
    return staleFallback("TUNE 공식 상품 확인 실패");
  }
}

export async function fetchTuneReleases(): Promise<TuneFetchResult> {
  if (cacheEntry && cacheEntry.expiresAt > Date.now()) {
    return cacheEntry.result;
  }
  if (!inFlight) {
    inFlight = requestTuneReleases().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
