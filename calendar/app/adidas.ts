import type { ExternalRelease, SourceFetchResult } from "./source-types";
import {
  fetchSourceJson,
  isRecord,
  SOURCE_CACHE_TTL_MS,
  stringValue,
  todayInSeoul,
  won,
} from "./source-utils";

/**
 * 아디다스 코리아 공식 출시 일정.
 *
 * 화면 페이지(https://www.adidas.co.kr/release-dates)는 자바스크립트로 그려져
 * 서버에서 목록을 못 읽지만, 그 화면이 쓰는 데이터 주소(JSON)는 서버에서 읽힌다.
 * sort=newest-to-oldest 를 붙여야 출시 예정(가장 최신 onlineFrom) 상품이 앞에 온다.
 * (2026-07-25 확인: 당일 10시 발매 상품들이 이 순서로 조회됨)
 *
 * ※ onlineFrom 은 "2026-07-25T10:00:00.000Z"처럼 Z(UTC) 표기가 붙지만,
 *   실제로는 한국 발매 시각을 그대로 담은 값으로 확인됨(아디다스 KR 통상 발매가
 *   오전 10~11시이고 값도 10:00/11:00). 그래서 시간대 변환 없이 문자 그대로 쓴다.
 *   시각이 중요한 상품은 공식 페이지에서 최종 확인하도록 안내 문구를 유지한다.
 */

const ADIDAS_API_URL =
  "https://www.adidas.co.kr/api/plp/content-engine?sitePath=kr&query=release-dates&sort=newest-to-oldest";
const ADIDAS_ORIGIN = "https://www.adidas.co.kr";
const RELEASE_PAGE_URL = "https://www.adidas.co.kr/release-dates";

type CacheEntry = {
  expiresAt: number;
  result: SourceFetchResult;
};

let cacheEntry: CacheEntry | null = null;
let inFlight: Promise<SourceFetchResult> | null = null;

function itemArray(payload: unknown): unknown[] {
  if (!isRecord(payload)) return [];
  const raw = isRecord(payload.raw) ? payload.raw : payload;
  const itemList = isRecord(raw.itemList) ? raw.itemList : null;
  return itemList && Array.isArray(itemList.items) ? itemList.items : [];
}

function literalDateTime(value: string | null) {
  if (!value) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (match) return { date: match[1], time: match[2] };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { date: value, time: null };
  return null;
}

export function normalizeAdidasItem(
  value: unknown,
  today: string,
): ExternalRelease | null {
  if (!isRecord(value)) return null;

  const productId = stringValue(value.productId);
  const title = stringValue(value.displayName);
  const onlineFrom = literalDateTime(stringValue(value.onlineFrom));
  if (!productId || !title || !onlineFrom) return null;
  if (onlineFrom.date < today) return null;

  const price = won(value.salePrice) ?? won(value.price);
  const link = stringValue(value.link);
  let productUrl = RELEASE_PAGE_URL;
  if (link) {
    try {
      productUrl = new URL(link, ADIDAS_ORIGIN).toString();
    } catch {
      productUrl = RELEASE_PAGE_URL;
    }
  }

  return {
    id: `adidas:${productId}`,
    externalId: `adidas:${productId}`,
    title,
    brand: "ADIDAS",
    category: "정보",
    releaseDate: onlineFrom.date,
    releaseTime: onlineFrom.time,
    channel: "아디다스 코리아 공식",
    sourceName: "ADIDAS",
    sourceUrl: RELEASE_PAGE_URL,
    status: "예정",
    confidence: 100,
    note: "아디다스 공식 출시 일정입니다. 한정판 응모(CONFIRMED 앱) 여부와 정확한 발매 시각은 공식 페이지에서 최종 확인하세요.",
    isFeatured: false,
    retailer: "adidas 코리아",
    releaseMethod: "온라인 출시",
    priceLabel: price,
    styleCode: productId,
    region: "한국",
    marketScope: "korea",
    productUrl,
  };
}

function staleFallback(message: string): SourceFetchResult {
  if (!cacheEntry) return { status: "error", releases: [], message };
  return {
    ...cacheEntry.result,
    status: "error",
    message: `${message} · 이전 캐시 사용`,
  };
}

async function requestAdidasReleases(): Promise<SourceFetchResult> {
  try {
    const payload = await fetchSourceJson(ADIDAS_API_URL);
    const items = itemArray(payload);
    if (!items.length) {
      return staleFallback("아디다스 응답에서 상품 목록을 찾지 못했습니다.");
    }

    const today = todayInSeoul();
    const seen = new Set<string>();
    const releases: ExternalRelease[] = [];
    for (const item of items) {
      const release = normalizeAdidasItem(item, today);
      if (!release || seen.has(release.externalId)) continue;
      seen.add(release.externalId);
      releases.push(release);
    }

    const result: SourceFetchResult = {
      status: "connected",
      releases,
      message: releases.length
        ? `공식 출시 일정 ${releases.length}건 확인 · 30분 캐시`
        : "오늘 이후 출시 예정이 아직 등록되지 않음 · 30분 캐시",
    };
    cacheEntry = { expiresAt: Date.now() + SOURCE_CACHE_TTL_MS, result };
    return result;
  } catch {
    return staleFallback("아디다스 공식 일정 확인 실패");
  }
}

export async function fetchAdidasReleases(): Promise<SourceFetchResult> {
  if (cacheEntry && cacheEntry.expiresAt > Date.now()) return cacheEntry.result;
  if (!inFlight) {
    inFlight = requestAdidasReleases().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
