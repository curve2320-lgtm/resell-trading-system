import type { ExternalRelease, SourceFetchResult } from "./source-types";
import {
  fetchSourceText,
  htmlText,
  SOURCE_CACHE_TTL_MS,
  todayInSeoul,
} from "./source-utils";

const CALENDAR_URL = "https://grandstage.a-rt.com/display/calendar";

type CacheEntry = {
  expiresAt: number;
  result: SourceFetchResult;
};

let cacheEntry: CacheEntry | null = null;
let inFlight: Promise<SourceFetchResult> | null = null;

function upcomingSection(html: string) {
  const start = html.indexOf("<!-- s : UPCOMING");
  if (start < 0) throw new Error("ABC Grandstage UPCOMING 영역을 찾지 못했습니다.");
  const end = html.indexOf("<!-- s : LAUNCHED", start);
  return html.slice(start, end > start ? end : undefined);
}

export function parseGrandstageCalendar(
  html: string,
  now = new Date(),
): ExternalRelease[] {
  const section = upcomingSection(html);
  const today = todayInSeoul(now);
  const dateMatches = [
    ...section.matchAll(/data-relis-todo-dtm=["']([^"']+)["']/gi),
  ];
  const releases: ExternalRelease[] = [];

  for (let index = 0; index < dateMatches.length; index += 1) {
    const dateTime = dateMatches[index][1].match(
      /^(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})/,
    );
    if (!dateTime || dateTime[1] < today) continue;
    const groupStart = dateMatches[index].index ?? 0;
    const groupEnd = dateMatches[index + 1]?.index ?? section.length;
    const group = section.slice(groupStart, groupEnd);
    const productPattern =
      /<li\s+class=["']([^"']*\bprod-item\b[^"']*)["'][^>]*data-product-no=["']([^"']+)["'][^>]*>[\s\S]*?<span\s+class=["']prod-brand["']>([\s\S]*?)<\/span>[\s\S]*?<span\s+class=["']prod-name["']>([\s\S]*?)<\/span>[\s\S]*?<span\s+class=["']price-cost["']>([\s\S]*?)<\/span>[\s\S]*?<a\s+href=["']([^"']+)["']\s+class=["']prod-link["']\s+data-sell-status=["']([^"']+)["']/gi;

    for (const product of group.matchAll(productPattern)) {
      const className = product[1].toLowerCase();
      const sellStatus = product[7].toLowerCase();
      if (
        className.includes("sold") ||
        sellStatus.includes("sold")
      ) {
        continue;
      }

      const productNo = product[2];
      const brand = htmlText(product[3]) || "ABC Grandstage";
      const title = htmlText(product[4]);
      const price = htmlText(product[5]);
      if (!title) continue;
      const sourceUrl = new URL(product[6], CALENDAR_URL).toString();
      const externalId = `grandstage:${productNo}:${dateTime[1]}T${dateTime[2]}:${dateTime[3]}`;

      releases.push({
        id: externalId,
        externalId,
        title,
        brand,
        category: "정보",
        releaseDate: dateTime[1],
        releaseTime: `${dateTime[2]}:${dateTime[3]}`,
        channel: "ABC Grandstage",
        sourceName: "ABC GRANDSTAGE",
        sourceUrl,
        status: "예정",
        confidence: 100,
        note: "캘린더에 판매 방식이 없어 발매 당일 제품 페이지에서 방식·시각을 확인하세요.",
        isFeatured: false,
        retailer: "ABC Grandstage",
        releaseMethod: "방식 표기 없음",
        scheduleLabel: `${dateTime[1]} ${dateTime[2]}:${dateTime[3]} 발매`,
        startAt: `${dateTime[1]}T${dateTime[2]}:${dateTime[3]}:00+09:00`,
        priceLabel: price ? `${price}원` : null,
        region: "한국",
        marketScope: "korea",
        productUrl: sourceUrl,
      });
    }
  }

  return releases;
}

function staleFallback(message: string): SourceFetchResult {
  if (!cacheEntry) return { status: "error", releases: [], message };
  return {
    ...cacheEntry.result,
    status: "error",
    message: `${message} · 이전 캐시 사용`,
  };
}

async function requestGrandstageReleases(): Promise<SourceFetchResult> {
  try {
    const releases = parseGrandstageCalendar(await fetchSourceText(CALENDAR_URL));
    const result: SourceFetchResult = {
      status: "connected",
      releases,
      message: releases.length
        ? "공식 런칭캘린더 정상 확인 · 30분 캐시"
        : "오늘 이후 공식 일정 0건 · 30분 캐시",
    };
    cacheEntry = { expiresAt: Date.now() + SOURCE_CACHE_TTL_MS, result };
    return result;
  } catch {
    return staleFallback("ABC Grandstage 확인 실패");
  }
}

export async function fetchGrandstageReleases() {
  if (cacheEntry && cacheEntry.expiresAt > Date.now()) return cacheEntry.result;
  if (!inFlight) {
    inFlight = requestGrandstageReleases().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
