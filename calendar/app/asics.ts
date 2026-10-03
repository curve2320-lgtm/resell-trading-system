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

const ASICS_CALENDAR_URL =
  "https://www.asics.co.kr/board/?id=spscalendar";
const ASICS_ORIGIN = "https://www.asics.co.kr";
const STYLE_CODE = /\b(\d{4}[A-Z]\d{3})(?:[.\-](\d{3}))?\b/iu;
const EXPLICIT_DATE =
  /\b(20\d{2})\s*(?:[./-]|년)\s*(\d{1,2})\s*(?:[./-]|월)\s*(\d{1,2})(?:\s*일)?(?:\s+(\d{1,2}):(\d{2}))?\b/u;

export type ParsedAsicsReleases = {
  releases: ExternalRelease[];
  undated: UndatedRelease[];
  malformedRows: number;
  structureValid: boolean;
};

type AsicsFetchResult = SourceFetchResult & {
  malformedRows: number;
};

type CacheEntry = {
  expiresAt: number;
  result: AsicsFetchResult;
};

let cacheEntry: CacheEntry | null = null;
let inFlight: Promise<AsicsFetchResult> | null = null;

function hasCalendarStructure(html: string) {
  return /(?:id|class)=["'][^"']*(?:spscalendar|launch-calendar|sps_gallerylist)[^"']*["']/iu.test(
    html,
  );
}

const PRODUCT_TARGET = /product\/detail|goods\/view|\/p\/|\/raffleEvent\//iu;

function rowBlocks(html: string) {
  for (const pattern of [
    /<tr\b[^>]*>[\s\S]*?<\/tr>/giu,
    /<(?:article|li)\b[^>]*>[\s\S]*?<\/(?:article|li)>/giu,
  ]) {
    const rows = [...html.matchAll(pattern)].map((match) => match[0]);
    if (rows.some((row) => PRODUCT_TARGET.test(row))) {
      return rows;
    }
  }
  return [html];
}

function explicitDate(text: string) {
  const match = text.match(EXPLICIT_DATE);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const value = new Date(Date.UTC(year, month - 1, day));
  const hour = match[4] === undefined ? null : Number(match[4]);
  const minute = match[5] === undefined ? null : Number(match[5]);
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day ||
    (hour !== null && (hour > 23 || minute === null || minute > 59))
  ) {
    return null;
  }
  const date =
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const time =
    hour === null
      ? null
      : `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return { date, time };
}

function publicProductUrl(href: string) {
  try {
    const url = new URL(htmlText(href), ASICS_ORIGIN);
    if (
      url.protocol !== "https:" ||
      !(
        url.hostname === "asics.co.kr" ||
        url.hostname.endsWith(".asics.co.kr")
      )
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function productAnchor(block: string) {
  return [
    ...block.matchAll(
      /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu,
    ),
  ].find((match) => PRODUCT_TARGET.test(match[1]));
}

function currentGalleryValue(block: string, className: string) {
  const pattern = new RegExp(
    `<(?:div|span|strong)\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/(?:div|span|strong)>`,
    "iu",
  );
  return block.match(pattern)?.[1];
}

function productViewlink(block: string) {
  return [...block.matchAll(/\bviewlink=["']([^"']+)["']/giu)].find(
    (match) => PRODUCT_TARGET.test(match[1]),
  )?.[1];
}

function rowTitle(anchorBody: string) {
  const strong = anchorBody.match(
    /<(?:strong|h[1-6])\b[^>]*>([\s\S]*?)<\/(?:strong|h[1-6])>/iu,
  )?.[1];
  const alt = anchorBody.match(/<img\b[^>]*\balt=["']([^"']+)["']/iu)?.[1];
  return htmlText(strong ?? alt ?? anchorBody)
    .replace(EXPLICIT_DATE, " ")
    .replace(/\b(?:RAFFLE|래플|응모|추첨)(?:\s*예정)?\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTitle(value: string) {
  return value
    .replace(
      /\s*\(\s*\d{4}[A-Z]\d{3}(?:[.\-]\d{3})?(?:\s*,\s*\d{4}[A-Z]\d{3}(?:[.\-]\d{3})?)*\s*\)\s*/giu,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function parseAsicsReleases(
  html: string,
  _now = new Date(),
): ParsedAsicsReleases {
  if (!hasCalendarStructure(html)) {
    return {
      releases: [],
      undated: [],
      malformedRows: 0,
      structureValid: false,
    };
  }

  const releases: ExternalRelease[] = [];
  const undated: UndatedRelease[] = [];
  let malformedRows = 0;

  for (const block of rowBlocks(html)) {
    if (!PRODUCT_TARGET.test(block)) {
      if (/\b(?:datalist|goods_sbj|goods_sbt)\b/iu.test(block)) {
        malformedRows += 1;
      }
      continue;
    }
    const anchor = productAnchor(block);
    const text = htmlText(block);
    const target = anchor?.[1] ?? productViewlink(block);
    const productUrl = target ? publicProductUrl(target) : null;
    const titleMarkup =
      currentGalleryValue(block, "goods_sbj") ??
      currentGalleryValue(block, "goods_sbt") ??
      anchor?.[2] ??
      "";
    const rawTitle = rowTitle(titleMarkup);
    const title = cleanTitle(rawTitle);
    if (!target || !productUrl || !title) {
      malformedRows += 1;
      continue;
    }

    const style = text.match(STYLE_CODE);
    const styleCode = style
      ? `${style[1].toUpperCase()}${style[2] ? `-${style[2]}` : ""}`
      : null;
    const schedule = explicitDate(text);
    const raffle = /RAFFLE|래플|응모|추첨/iu.test(text);
    const url = new URL(productUrl);
    const productNo = url.searchParams.get("product_no");
    const externalId =
      `asics:${productNo ?? styleCode ?? `${url.pathname}${url.search}`}`;

    if (!schedule) {
      undated.push({
        id: externalId,
        title,
        sourceUrl: productUrl,
        note: "ASICS 공식 Launch Calendar에 등록됐지만 날짜 미확정입니다.",
        brand: "ASICS",
        styleCode,
        productUrl,
      });
      continue;
    }

    releases.push({
      id: externalId,
      externalId,
      title,
      brand: "ASICS",
      category: raffle ? "응모" : "정보",
      releaseDate: schedule.date,
      releaseTime: schedule.time,
      channel: raffle ? "ASICS Korea 응모" : "ASICS Korea",
      sourceName: "ASICS",
      sourceUrl: productUrl,
      status: "예정",
      confidence: 100,
      note: "ASICS 공식 Launch Calendar 일정입니다.",
      isFeatured: true,
      retailer: "ASICS Korea",
      releaseMethod: raffle ? "응모" : "온라인 발매",
      scheduleLabel: `${schedule.date}${schedule.time ? ` ${schedule.time}` : ""}`,
      startTimeUnknown: schedule.time === null,
      styleCode,
      region: "대한민국",
      marketScope: "korea",
      productUrl,
      mode: "online",
    });
  }

  return { releases, undated, malformedRows, structureValid: true };
}

function staleFallback(message: string): AsicsFetchResult {
  if (!cacheEntry) {
    return {
      status: "error",
      releases: [],
      undated: [],
      message,
      malformedRows: 0,
    };
  }
  return {
    ...cacheEntry.result,
    status: "error",
    message: `${message} · 이전 성공 캐시 사용`,
  };
}

async function requestAsicsReleases(): Promise<AsicsFetchResult> {
  try {
    const parsed = parseAsicsReleases(
      await fetchSourceText(ASICS_CALENDAR_URL),
    );
    if (!parsed.structureValid) {
      return staleFallback("ASICS Launch Calendar 구조 확인 실패");
    }
    const result: AsicsFetchResult = {
      status: "connected",
      releases: parsed.releases,
      undated: parsed.undated,
      message:
        `공식 Launch Calendar ${parsed.releases.length}건` +
        ` · 날짜 미확정 ${parsed.undated.length}건 · 30분 캐시`,
      malformedRows: parsed.malformedRows,
    };
    cacheEntry = {
      expiresAt: Date.now() + SOURCE_CACHE_TTL_MS,
      result,
    };
    return result;
  } catch {
    return staleFallback("ASICS Launch Calendar 확인 실패");
  }
}

export async function fetchAsicsReleases(): Promise<AsicsFetchResult> {
  if (cacheEntry && cacheEntry.expiresAt > Date.now()) {
    return cacheEntry.result;
  }
  if (!inFlight) {
    inFlight = requestAsicsReleases().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
