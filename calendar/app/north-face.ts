import type {
  ExternalRelease,
  SourceFetchResult,
  UndatedRelease,
} from "./source-types";
import {
  fetchSourceText,
  htmlText,
  SOURCE_CACHE_TTL_MS,
} from "./source-utils";

const NORTH_FACE_ORIGIN = "https://www.thenorthfacekorea.co.kr";
const NORTH_FACE_NEW_ARRIVALS_URL =
  "https://www.thenorthfacekorea.co.kr/category/n/new?sort=ACTIVE_DATE_DESC";
const PRODUCT_HREF = /<a\b[^>]*\bhref=["']([^"']*\/product\/([A-Z0-9-]+))["'][^>]*>([\s\S]*?)<\/a>/giu;
const PRODUCT_PATH = /\/product\/([A-Z0-9-]+)\/?$/iu;
const EXPLICIT_DATE =
  /\b(20\d{2})\s*(?:년|[./-])\s*(\d{1,2})\s*(?:월|[./-])\s*(\d{1,2})\s*일?\b/iu;

export type ParsedNorthFaceReleases = {
  releases: ExternalRelease[];
  undated: UndatedRelease[];
  malformedRows: number;
  structureValid: boolean;
};

export type NorthFaceFetchResult = Omit<SourceFetchResult, "undated"> & {
  undated: UndatedRelease[];
  malformedRows: number;
  snapshotComplete?: boolean;
};

type ProductCandidate = {
  styleCode: string;
  title: string;
  productUrl: string;
  priceLabel: string | null;
};

type ProductPage = { url: string; html: string };

type CacheEntry = {
  expiresAt: number;
  result: NorthFaceFetchResult;
};

let cacheEntry: CacheEntry | null = null;
let inFlight: Promise<NorthFaceFetchResult> | null = null;

function safeProductUrl(value: string) {
  try {
    const url = new URL(htmlText(value), NORTH_FACE_ORIGIN);
    if (
      url.protocol !== "https:" ||
      (url.hostname !== "thenorthfacekorea.co.kr" &&
        !url.hostname.endsWith(".thenorthfacekorea.co.kr"))
    ) {
      return null;
    }
    const match = url.pathname.match(PRODUCT_PATH);
    if (!match) return null;
    return {
      url: `${NORTH_FACE_ORIGIN}/product/${match[1].toUpperCase()}`,
      styleCode: match[1].toUpperCase(),
    };
  } catch {
    return null;
  }
}

function dataValue(markup: string, attribute: string) {
  return markup.match(
    new RegExp(`\\b${attribute}=["']([^"']+)["']`, "iu"),
  )?.[1] ?? null;
}

function titleFromMarkup(markup: string) {
  const dataName = dataValue(markup, "data-name");
  if (dataName) return htmlText(dataName);
  const heading = markup.match(
    /<h[1-6]\b[^>]*class=["'][^"']*product-name[^"']*["'][^>]*>([\s\S]*?)<\/h[1-6]>/iu,
  )?.[1];
  return htmlText(heading ?? markup)
    .replace(/\s+/g, " ")
    .trim();
}

function priceFromMarkup(markup: string) {
  const dataPrice = dataValue(markup, "data-price");
  if (dataPrice && /^\d+(?:\.\d+)?$/u.test(dataPrice.replaceAll(",", ""))) {
    return `${new Intl.NumberFormat("ko-KR").format(Number(dataPrice))}원`;
  }
  const price = markup.match(
    /<(?:strong|span)\b[^>]*class=["'][^"']*price[^"']*["'][^>]*>([\s\S]*?)<\/(?:strong|span)>/iu,
  )?.[1];
  return price ? htmlText(price).replace(/\s+/g, "") : null;
}

function productCandidates(html: string) {
  const candidates = new Map<string, ProductCandidate>();
  for (const match of html.matchAll(PRODUCT_HREF)) {
    const product = safeProductUrl(match[1]);
    if (!product) continue;
    const title = titleFromMarkup(match[3]);
    if (!title) continue;
    candidates.set(product.styleCode, {
      styleCode: product.styleCode,
      title,
      productUrl: product.url,
      priceLabel: priceFromMarkup(match[3]),
    });
  }
  return [...candidates.values()];
}

function upcomingProductUrls(html: string) {
  const urls = new Set<string>();
  const blocks = [
    ...html.matchAll(/<(article|li)\b[^>]*>[\s\S]*?<\/\1>/giu),
  ].map((match) => match[0]);
  for (const block of blocks) {
    if (!/출시\s*예정|출시\s*알림/iu.test(htmlText(block))) continue;
    const candidate = productCandidates(block)[0];
    if (candidate) urls.add(candidate.productUrl);
  }
  return [...urls].slice(0, 30);
}

function explicitDate(text: string) {
  const match = text.match(EXPLICIT_DATE);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function liveRelease(
  candidate: ProductCandidate,
  releaseDate: string,
): ExternalRelease {
  return {
    id: `northFace:${candidate.styleCode}`,
    externalId: `northFace:${candidate.styleCode}`,
    title: candidate.title,
    brand: "THE NORTH FACE",
    category: "정보",
    releaseDate,
    releaseTime: null,
    channel: "노스페이스 공식몰",
    sourceName: "THE NORTH FACE",
    sourceUrl: candidate.productUrl,
    status: "예정",
    confidence: 100,
    note: "노스페이스 공식몰 출시예정 상품입니다.",
    isFeatured: true,
    retailer: "노스페이스 공식몰",
    releaseMethod: "온라인 발매",
    scheduleLabel: `${releaseDate} 출시 예정`,
    startTimeUnknown: true,
    priceLabel: candidate.priceLabel,
    styleCode: candidate.styleCode,
    region: "대한민국",
    marketScope: "korea",
    productUrl: candidate.productUrl,
    mode: "online",
  };
}

function undatedRelease(candidate: ProductCandidate): UndatedRelease {
  return {
    id: `northFace:${candidate.styleCode}`,
    title: candidate.title,
    sourceUrl: candidate.productUrl,
    note: "노스페이스 공식몰 신상품 후보지만 공개 발매일은 확인되지 않았습니다.",
    brand: "THE NORTH FACE",
    styleCode: candidate.styleCode,
    productUrl: candidate.productUrl,
  };
}

export function parseNorthFaceReleases(
  newArrivalsHtml: string,
  upcomingProductPages: ReadonlyArray<ProductPage> = [],
): ParsedNorthFaceReleases {
  const candidates = productCandidates(newArrivalsHtml);
  if (!candidates.length || !/<h1\b[^>]*class=["'][^"']*title[^"']*["'][^>]*>\s*신상품/iu.test(newArrivalsHtml)) {
    return { releases: [], undated: [], malformedRows: 0, structureValid: false };
  }

  const byUrl = new Map(candidates.map((candidate) => [candidate.productUrl, candidate]));
  const releases = new Map<string, ExternalRelease>();
  const undated = new Map<string, UndatedRelease>();
  let malformedRows = 0;

  for (const candidate of candidates) {
    undated.set(candidate.styleCode, undatedRelease(candidate));
  }

  for (const page of upcomingProductPages) {
    const product = safeProductUrl(page.url);
    if (!product) {
      malformedRows += 1;
      continue;
    }
    const candidate = byUrl.get(product.url) ?? {
      styleCode: product.styleCode,
      title: titleFromMarkup(page.html),
      productUrl: product.url,
      priceLabel: priceFromMarkup(page.html),
    };
    const text = htmlText(page.html);
    if (!/출시\s*예정|출시\s*알림/iu.test(text)) continue;
    const date = explicitDate(text);
    if (!date || !candidate.title) continue;
    releases.set(candidate.styleCode, liveRelease(candidate, date));
    undated.delete(candidate.styleCode);
  }

  return {
    releases: [...releases.values()].sort((left, right) =>
      left.releaseDate.localeCompare(right.releaseDate) || left.title.localeCompare(right.title, "ko"),
    ),
    undated: [...undated.values()].sort((left, right) => left.title.localeCompare(right.title, "ko")),
    malformedRows,
    structureValid: true,
  };
}

function staleFallback(message: string): NorthFaceFetchResult {
  if (!cacheEntry) {
    return { status: "error", releases: [], undated: [], message, malformedRows: 0 };
  }
  return {
    ...cacheEntry.result,
    status: "error",
    message: `${message} · 이전 성공 캐시 사용`,
    snapshotComplete: false,
  };
}

async function requestNorthFaceReleases(): Promise<NorthFaceFetchResult> {
  try {
    const listHtml = await fetchSourceText(NORTH_FACE_NEW_ARRIVALS_URL);
    const pages = await Promise.all(
      upcomingProductUrls(listHtml).map(async (url) => {
        try {
          return { url, html: await fetchSourceText(url) };
        } catch {
          return null;
        }
      }),
    );
    const parsed = parseNorthFaceReleases(
      listHtml,
      pages.filter((page): page is ProductPage => page !== null),
    );
    if (!parsed.structureValid) return staleFallback("노스페이스 신상품 구조 확인 실패");
    const result: NorthFaceFetchResult = {
      status: "connected",
      releases: parsed.releases,
      undated: parsed.undated,
      message: `공식 신상품 후보 ${parsed.undated.length}건 · 출시일 확정 ${parsed.releases.length}건 · 30분 캐시`,
      malformedRows: parsed.malformedRows,
      snapshotComplete: false,
    };
    cacheEntry = { expiresAt: Date.now() + SOURCE_CACHE_TTL_MS, result };
    return result;
  } catch {
    return staleFallback("노스페이스 공식몰 확인 실패");
  }
}

export async function fetchNorthFaceReleases(): Promise<NorthFaceFetchResult> {
  if (cacheEntry && cacheEntry.expiresAt > Date.now()) return cacheEntry.result;
  if (!inFlight) {
    inFlight = requestNorthFaceReleases().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
