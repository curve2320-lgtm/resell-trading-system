import type {
  ExternalRelease,
  SourceFetchResult,
  UndatedRelease,
} from "./source-types";
import {
  fetchSourceJson,
  fetchSourceText,
  isRecord,
  seoulDateTime,
  SOURCE_CACHE_TTL_MS,
  stringValue,
  todayInSeoul,
  won,
} from "./source-utils";

const UPCOMING_URL = "https://www.nike.com/kr/launch/upcoming";
const FILTERED_URL =
  "https://www.nike.com/kr/launch/?activeDate=date-filter%3AAFTER&type=upcoming";
const CONTENT_API_URL =
  "https://snkrs.services.nike.com/snkrs/content/v2/public/web/KR/ko/upcoming";

type NikeParsed = {
  releases: ExternalRelease[];
  undated: UndatedRelease[];
};

type CacheEntry = {
  expiresAt: number;
  result: SourceFetchResult;
};

let cacheEntry: CacheEntry | null = null;
let inFlight: Promise<SourceFetchResult> | null = null;

function values(value: unknown) {
  if (Array.isArray(value)) return value;
  return isRecord(value) ? Object.values(value) : [];
}

function nextState(html: string) {
  const script = html.match(
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  )?.[1];
  if (!script) throw new Error("Nike 페이지 데이터 형식을 찾지 못했습니다.");

  const nextData = JSON.parse(script) as unknown;
  if (!isRecord(nextData) || !isRecord(nextData.props)) {
    throw new Error("Nike 페이지 데이터가 비어 있습니다.");
  }

  const pageProps = nextData.props.pageProps;
  if (!isRecord(pageProps)) throw new Error("Nike 발매 데이터가 비어 있습니다.");
  const initialState =
    typeof pageProps.initialState === "string"
      ? (JSON.parse(pageProps.initialState) as unknown)
      : pageProps.initialState;
  if (!isRecord(initialState)) throw new Error("Nike 발매 데이터 형식이 바뀌었습니다.");
  return initialState;
}

function nestedItems(state: Record<string, unknown>, key: string) {
  const product = isRecord(state.product) ? state.product : {};
  const collection = isRecord(product[key]) ? product[key] : {};
  const data = isRecord(collection.data) ? collection.data : {};
  return data.items;
}

function isSoldOut(
  thread: Record<string, unknown>,
  product: Record<string, unknown>,
  timestamp: number | null,
) {
  const status = [
    thread.active,
    product.launchStatus,
    product.merchStatus,
    product.status,
  ]
    .map((value) => stringValue(value)?.toUpperCase() ?? "")
    .join(" ");
  if (/SOLD.?OUT|품절/.test(status)) return true;
  if (product.isActive === false || status.includes("INACTIVE")) return true;

  const skus = Array.isArray(product.skus) ? product.skus : [];
  const noAvailableSize =
    skus.length > 0 &&
    skus.every((sku) => isRecord(sku) && sku.available === false);
  return Boolean(timestamp && timestamp <= Date.now() && noAvailableSize);
}

function categoryForLaunchView(value: unknown): ExternalRelease["category"] {
  const launchView = Array.isArray(value)
    ? value.find(isRecord)
    : isRecord(value)
      ? value
      : null;
  if (!launchView) return "정보";
  const method = stringValue(launchView.method)?.toUpperCase() ?? "";
  if (launchView.stopEntryDate || /DRAW|DAN|LEO|RAFFLE/.test(method)) return "응모";
  if (/LINE|FLOW|FIRST/.test(method)) return "선착순";
  return "정보";
}

export function parseNikeApiPayload(
  payload: unknown,
  now = new Date(),
): NikeParsed {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new Error("Nike 공식 발매 API 형식이 바뀌었습니다.");
  }

  const today = todayInSeoul(now);
  const releases: ExternalRelease[] = [];
  const undated: UndatedRelease[] = [];

  for (const rawItem of payload.items) {
    if (!isRecord(rawItem) || !Array.isArray(rawItem.products)) continue;
    if (stringValue(rawItem.type) !== "product-card") continue;
    const threadId = stringValue(rawItem.thread_id);
    if (!threadId) continue;
    const itemTitle = stringValue(rawItem.title) ?? "Nike SNKRS 발매 예정";
    const slug = stringValue(rawItem.seo_slug);
    const sourceUrl = slug
      ? `https://www.nike.com/kr/launch/t/${encodeURIComponent(slug)}`
      : UPCOMING_URL;

    for (const rawProduct of rawItem.products) {
      if (!isRecord(rawProduct)) continue;
      const productId = stringValue(rawProduct.product_id) ?? threadId;
      const status = stringValue(rawProduct.status)?.toUpperCase() ?? "";
      if (status && status !== "ACTIVE") continue;
      if (rawProduct.available === false) continue;

      const productTitle = stringValue(rawProduct.title) ?? itemTitle;
      const productSubtitle = stringValue(rawProduct.subtitle);
      const title =
        rawItem.is_multi_product === true && productSubtitle
          ? `${productTitle} · ${productSubtitle}`
          : rawItem.is_multi_product === true
            ? productTitle
            : itemTitle;
      const launches = Array.isArray(rawProduct.launches)
        ? rawProduct.launches.filter(isRecord)
        : [];
      const launchDates = launches
        .map((launch) => stringValue(launch.start_entry_date))
        .filter((value): value is string => Boolean(value))
        .filter((value) => !Number.isNaN(Date.parse(value)))
        .sort((a, b) => Date.parse(b) - Date.parse(a));
      const start =
        launchDates[0] ??
        stringValue(rawProduct.commerce_start_date) ??
        stringValue(rawItem.effective_start_sell_date);
      const price =
        won(rawProduct.current_price) ??
        won(rawProduct.full_price) ??
        won(rawProduct.msrp);
      const styleCode = stringValue(rawProduct.style_color);
      const details = [
        "Nike 공식 발매 예정",
        price,
        styleCode ? `스타일 ${styleCode}` : null,
      ].filter((value): value is string => Boolean(value));
      const externalId = `nike:${threadId}:${productId}`;
      const brand = /조던|jordan/i.test(
        `${title} ${stringValue(rawProduct.title) ?? ""}`,
      )
        ? "JORDAN"
        : "NIKE";

      if (!start || Number.isNaN(Date.parse(start))) {
        undated.push({
          id: externalId,
          title,
          sourceUrl,
          note: [...details, "날짜 미정"].join(" · "),
          brand,
          priceLabel: price,
          styleCode,
          productUrl: sourceUrl,
        });
        continue;
      }

      const dateTime = seoulDateTime(start);
      if (!dateTime || dateTime.date < today) continue;
      const category = categoryForLaunchView(launches);

      releases.push({
        id: externalId,
        externalId,
        title,
        brand,
        category,
        releaseDate: dateTime.date,
        releaseTime: dateTime.time,
        channel: "Nike SNKRS Korea",
        sourceName: "NIKE SNKRS",
        sourceUrl,
        status: "예정",
        confidence: 100,
        note: "Nike 공식 발매 데이터이며 품절 상태는 일정에서 제외됩니다.",
        isFeatured: true,
        retailer: "Nike SNKRS Korea",
        releaseMethod: category === "정보" ? "발매 예정" : category,
        startAt: start,
        priceLabel: price,
        styleCode,
        region: "한국",
        marketScope: "korea",
        productUrl: sourceUrl,
      });
    }
  }

  return { releases, undated };
}

export function parseNikeLaunchHtml(
  html: string,
  now = new Date(),
): NikeParsed {
  const state = nextState(html);
  const threads = values(nestedItems(state, "threads"));
  const productItems = nestedItems(state, "products");
  const products = isRecord(productItems) ? productItems : {};
  const launchViewItems = nestedItems(state, "launchViews");
  const launchViews = isRecord(launchViewItems) ? launchViewItems : {};
  const today = todayInSeoul(now);
  const releases: ExternalRelease[] = [];
  const undated: UndatedRelease[] = [];

  for (const rawThread of threads) {
    if (!isRecord(rawThread)) continue;
    const primaryProductId = stringValue(rawThread.productId);
    const productIds = [
      ...new Set(
        [
          primaryProductId,
          ...(Array.isArray(rawThread.productIds)
            ? rawThread.productIds.map(stringValue)
            : []),
        ].filter((value): value is string => Boolean(value)),
      ),
    ];
    if (!productIds.length) continue;

    const threadId = stringValue(rawThread.id) ?? productIds[0];
    const seo = isRecord(rawThread.seo) ? rawThread.seo : {};
    const slug = stringValue(seo.slug);
    const sourceUrl = slug
      ? `https://www.nike.com/kr/launch/t/${encodeURIComponent(slug)}`
      : UPCOMING_URL;
    const threadTitle = stringValue(rawThread.title) ?? "Nike SNKRS 발매 예정";

    for (const productId of productIds) {
      const rawProduct = products[productId];
      if (!isRecord(rawProduct)) continue;
      const productTitle = stringValue(rawProduct.title) ?? threadTitle;
      const productSubtitle = stringValue(rawProduct.subtitle);
      const title =
        productIds.length > 1 && productSubtitle
          ? `${productTitle} · ${productSubtitle}`
          : productIds.length > 1
            ? productTitle
            : threadTitle;
      const start = stringValue(rawProduct.commerceStartDate);
      const timestamp = start ? Date.parse(start) : null;
      if (isSoldOut(rawThread, rawProduct, timestamp)) continue;

      const price =
        won(rawProduct.currentPrice) ??
        won(rawProduct.fullPrice) ??
        won(rawProduct.msrp);
      const styleCode = stringValue(rawProduct.styleColor);
      const details = [
        "Nike 공식 발매 예정",
        price,
        styleCode ? `스타일 ${styleCode}` : null,
      ].filter((value): value is string => Boolean(value));
      const externalId = `nike:${threadId}:${productId}`;
      const brand = /조던|jordan/i.test(`${title} ${productTitle}`)
        ? "JORDAN"
        : "NIKE";

      if (!start || timestamp === null || Number.isNaN(timestamp)) {
        undated.push({
          id: externalId,
          title,
          sourceUrl,
          note: [...details, "날짜 미정"].join(" · "),
          brand,
          priceLabel: price,
          styleCode,
          productUrl: sourceUrl,
        });
        continue;
      }

      const dateTime = seoulDateTime(start);
      if (!dateTime || dateTime.date < today) continue;
      const category = categoryForLaunchView(launchViews[productId]);

      releases.push({
        id: externalId,
        externalId,
        title,
        brand,
        category,
        releaseDate: dateTime.date,
        releaseTime: dateTime.time,
        channel: "Nike SNKRS Korea",
        sourceName: "NIKE SNKRS",
        sourceUrl,
        status: "예정",
        confidence: 100,
        note: "Nike 공식 발매 데이터이며 품절 상태는 일정에서 제외됩니다.",
        isFeatured: true,
        retailer: "Nike SNKRS Korea",
        releaseMethod: category === "정보" ? "발매 예정" : category,
        startAt: start,
        priceLabel: price,
        styleCode,
        region: "한국",
        marketScope: "korea",
        productUrl: sourceUrl,
      });
    }
  }

  return { releases, undated };
}

function staleFallback(message: string): SourceFetchResult {
  if (!cacheEntry) return { status: "error", releases: [], message, undated: [] };
  return {
    ...cacheEntry.result,
    status: "error",
    message: `${message} · 이전 캐시 사용`,
  };
}

async function requestNikeReleases(): Promise<SourceFetchResult> {
  try {
    const parsed = parseNikeApiPayload(await fetchSourceJson(CONTENT_API_URL));
    const result: SourceFetchResult = {
      status: "connected",
      releases: parsed.releases,
      undated: parsed.undated,
      message: "Nike 공식 발매 데이터 정상 확인 · 30분 캐시",
    };
    cacheEntry = { expiresAt: Date.now() + SOURCE_CACHE_TTL_MS, result };
    return result;
  } catch {
    // Fall back to the exact two launch pages requested by the user.
  }

  const attempts = await Promise.allSettled([
    fetchSourceText(UPCOMING_URL),
    fetchSourceText(FILTERED_URL),
  ]);
  const parsed: NikeParsed[] = [];

  for (const attempt of attempts) {
    if (attempt.status !== "fulfilled") continue;
    try {
      parsed.push(parseNikeLaunchHtml(attempt.value));
    } catch {
      // The other official launch page may still provide the complete payload.
    }
  }

  if (!parsed.length) return staleFallback("Nike SNKRS 확인 실패");

  const releaseMap = new Map<string, ExternalRelease>();
  const undatedMap = new Map<string, UndatedRelease>();
  for (const result of parsed) {
    for (const release of result.releases) releaseMap.set(release.externalId, release);
    for (const release of result.undated) undatedMap.set(release.id, release);
  }

  const result: SourceFetchResult = {
    status: "connected",
    releases: [...releaseMap.values()],
    undated: [...undatedMap.values()].filter((item) => !releaseMap.has(item.id)),
    message:
      parsed.length === attempts.length
        ? "공식 발매 페이지 정상 확인 · 30분 캐시"
        : "공식 발매 페이지 일부 확인 · 30분 캐시",
  };
  cacheEntry = { expiresAt: Date.now() + SOURCE_CACHE_TTL_MS, result };
  return result;
}

export async function fetchNikeReleases() {
  if (cacheEntry && cacheEntry.expiresAt > Date.now()) return cacheEntry.result;
  if (!inFlight) {
    inFlight = requestNikeReleases().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
