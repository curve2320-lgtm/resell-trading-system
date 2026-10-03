import type {
  ExternalRelease,
  SourceFetchResult,
  UndatedRelease,
} from "./source-types";
import {
  fetchSourceJson,
  fetchSourceText,
  htmlText,
  isRecord,
  numberValue,
  SOURCE_CACHE_TTL_MS,
  stringValue,
  todayInSeoul,
  won,
} from "./source-utils";

const SALOMON_LAUNCH_PRODUCTS_URL =
  "https://salomon.co.kr/collections/launch-calendar/products.json?limit=250";
const SALOMON_RAFFLE_URL =
  "https://salomon.co.kr/collections/raffle-event";
const SALOMON_ORIGIN = "https://salomon.co.kr";
const NON_PRODUCT_RUNNING_EVENT =
  /(?:러닝|running|run)\s*(?:세션|session|클래스|class|클리닉|clinic|크루|crew|트레이닝|training|체험|experience)|참가\s*응모/iu;

export type ParsedSalomonReleases = {
  releases: ExternalRelease[];
  undated: UndatedRelease[];
  malformedRows: number;
  structureValid: boolean;
};

type SalomonFetchResult = SourceFetchResult & {
  malformedRows: number;
};

type CacheEntry = {
  expiresAt: number;
  result: SalomonFetchResult;
};

let cacheEntry: CacheEntry | null = null;
let inFlight: Promise<SalomonFetchResult> | null = null;

function validDate(year: number, month: number, day: number) {
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

function nearestDate(month: number, day: number, now: Date) {
  const today = todayInSeoul(now);
  const year = Number(today.slice(0, 4));
  const todayValue = Date.parse(`${today}T12:00:00+09:00`);
  const candidates = [year - 1, year, year + 1]
    .map((candidateYear) => validDate(candidateYear, month, day))
    .filter((value): value is string => Boolean(value))
    .map((date) => ({
      date,
      distance: Math.abs(
        Date.parse(`${date}T12:00:00+09:00`) - todayValue,
      ),
    }))
    .sort(
      (left, right) =>
        left.distance - right.distance || left.date.localeCompare(right.date),
    );
  return candidates[0]?.date ?? null;
}

function markedMonthDay(text: string, markerSource: string, now: Date) {
  const monthDay =
    "(\\d{1,2})\\s*(?:[./]|월)\\s*(\\d{1,2})(?:\\s*일)?";
  const separator = "(?:\\s|[:：·-]){0,12}";
  const before = text.match(
    new RegExp(`${monthDay}${separator}(?:${markerSource})`, "iu"),
  );
  const after = text.match(
    new RegExp(`(?:${markerSource})${separator}${monthDay}`, "iu"),
  );
  const match = before ?? after;
  return match ? nearestDate(Number(match[1]), Number(match[2]), now) : null;
}

function productPrice(variants: unknown[]) {
  const prices = variants
    .filter(isRecord)
    .map((variant) => numberValue(variant.price))
    .filter((price): price is number => price !== null && price > 0);
  return prices.length ? won(Math.min(...prices)) : null;
}

function productStyleCode(variants: unknown[]) {
  for (const variant of variants) {
    if (!isRecord(variant)) continue;
    const sku = stringValue(variant.sku);
    if (sku) return sku;
  }
  return null;
}

function parseLaunchProducts(payload: unknown, now: Date) {
  if (!isRecord(payload) || !Array.isArray(payload.products)) {
    throw new Error("Salomon 런칭 상품 응답 형식 오류");
  }

  const releases: ExternalRelease[] = [];
  let malformedRows = 0;

  for (const value of payload.products) {
    if (!isRecord(value)) {
      malformedRows += 1;
      continue;
    }
    const title = stringValue(value.title);
    const handle = stringValue(value.handle);
    const body = htmlText(stringValue(value.body_html) ?? "");
    const tags = Array.isArray(value.tags)
      ? value.tags.map(stringValue).filter((tag): tag is string => Boolean(tag))
      : [];
    const text = [title, body, ...tags].filter(Boolean).join(" ");
    const releaseDate = markedMonthDay(text, "오픈\\s*예정", now);
    if (!/오픈\s*예정/iu.test(text)) continue;
    if (!title || !handle || !releaseDate) {
      malformedRows += 1;
      continue;
    }

    const productUrl = new URL(
      `/products/${encodeURIComponent(handle)}`,
      SALOMON_ORIGIN,
    ).toString();
    const productId = numberValue(value.id);
    const externalId = `salomon:launch:${productId ?? handle}`;
    const variants = Array.isArray(value.variants) ? value.variants : [];
    const memberOnly = /회원\s*전용|member\s*only/iu.test(text);

    releases.push({
      id: externalId,
      externalId,
      title,
      brand: stringValue(value.vendor) ?? "SALOMON",
      category: "정보",
      releaseDate,
      releaseTime: null,
      channel: "Salomon Korea",
      sourceName: "SALOMON",
      sourceUrl: productUrl,
      status: "예정",
      confidence: 95,
      note: memberOnly
        ? "Salomon 공식 런칭 캘린더 일정이며 회원 전용 상품입니다."
        : "Salomon 공식 런칭 캘린더 일정입니다.",
      isFeatured: true,
      retailer: "Salomon Korea",
      releaseMethod: memberOnly ? "회원 전용 온라인 발매" : "온라인 발매",
      scheduleLabel: `${releaseDate} 오픈 예정`,
      startTimeUnknown: true,
      priceLabel: productPrice(variants),
      styleCode: productStyleCode(variants),
      region: "대한민국",
      marketScope: "korea",
      productUrl,
      mode: "online",
    });
  }

  return { releases, malformedRows };
}

function raffleBlocks(html: string) {
  const blocks = [
    ...html.matchAll(
      /<(article|li)\b[^>]*>[\s\S]*?<\/\1>/giu,
    ),
  ].map((match) => match[0]);
  return blocks.length ? blocks : [html];
}

function hasRaffleStructure(html: string) {
  return /(?:id|class)=["'][^"']*raffle-event(?:-list)?[^"']*["']/iu.test(
    html,
  );
}

function raffleTitle(block: string, anchorBody: string) {
  const heading = anchorBody.match(
    /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/iu,
  )?.[1];
  const imageAlt = anchorBody.match(/<img\b[^>]*\balt=["']([^"']+)["']/iu)?.[1];
  return htmlText(heading ?? imageAlt ?? anchorBody)
    .replace(/\b\d{1,2}\s*[./]\s*\d{1,2}\s*응모\s*마감\b/giu, "")
    .trim();
}

function parseRaffles(html: string, now: Date) {
  if (!hasRaffleStructure(html)) {
    return { releases: [], malformedRows: 0, structureValid: false };
  }

  const releases: ExternalRelease[] = [];
  let malformedRows = 0;

  for (const block of raffleBlocks(html)) {
    if (!/응모\s*마감/iu.test(block)) continue;
    const anchor = block.match(
      /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/iu,
    );
    const text = htmlText(block);
    const releaseDate = markedMonthDay(text, "응모\\s*마감", now);
    const title = anchor ? raffleTitle(block, anchor[2]) : "";
    if (!anchor || !releaseDate || !title) {
      malformedRows += 1;
      continue;
    }
    if (NON_PRODUCT_RUNNING_EVENT.test(title)) continue;

    let productUrl: string;
    try {
      const url = new URL(htmlText(anchor[1]), SALOMON_ORIGIN);
      if (
        url.protocol !== "https:" ||
        !(
          url.hostname === "salomon.co.kr" ||
          url.hostname.endsWith(".salomon.co.kr")
        )
      ) {
        malformedRows += 1;
        continue;
      }
      productUrl = url.toString();
    } catch {
      malformedRows += 1;
      continue;
    }

    const externalId = `salomon:raffle:${productUrl}`;
    releases.push({
      id: externalId,
      externalId,
      title,
      brand: "SALOMON",
      category: "응모",
      releaseDate,
      releaseTime: null,
      channel: "Salomon Korea 응모",
      sourceName: "SALOMON",
      sourceUrl: productUrl,
      status: "예정",
      confidence: 100,
      note: "Salomon 공식 래플 이벤트의 응모 마감 일정입니다.",
      isFeatured: true,
      retailer: "Salomon Korea",
      releaseMethod: "응모",
      winnerMethod: "추첨",
      scheduleLabel: `${releaseDate} 응모 마감`,
      endTimeUnknown: true,
      region: "대한민국",
      marketScope: "korea",
      productUrl,
      mode: "online",
    });
  }

  return { releases, malformedRows, structureValid: true };
}

export function parseSalomonReleases(
  launchPayload: unknown,
  raffleHtml: string,
  now = new Date(),
): ParsedSalomonReleases {
  const launch = parseLaunchProducts(launchPayload, now);
  const raffle = parseRaffles(raffleHtml, now);
  const releases = [...launch.releases, ...raffle.releases]
    .filter(
      (release, index, all) =>
        all.findIndex(({ externalId }) => externalId === release.externalId) ===
        index,
    )
    .sort((left, right) => {
      const dateOrder = left.releaseDate.localeCompare(right.releaseDate);
      return dateOrder || left.title.localeCompare(right.title, "ko");
    });
  return {
    releases,
    undated: [],
    malformedRows: launch.malformedRows + raffle.malformedRows,
    structureValid: raffle.structureValid,
  };
}

function staleFallback(message: string): SalomonFetchResult {
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

async function requestSalomonReleases(): Promise<SalomonFetchResult> {
  try {
    const [launchPayload, raffleHtml] = await Promise.all([
      fetchSourceJson(SALOMON_LAUNCH_PRODUCTS_URL),
      fetchSourceText(SALOMON_RAFFLE_URL),
    ]);
    const parsed = parseSalomonReleases(launchPayload, raffleHtml);
    if (!parsed.structureValid) {
      return staleFallback("Salomon 응모 목록 구조 확인 실패");
    }
    const result: SalomonFetchResult = {
      status: "connected",
      releases: parsed.releases,
      undated: parsed.undated,
      message: `공식 런칭·응모 ${parsed.releases.length}건 확인 · 30분 캐시`,
      malformedRows: parsed.malformedRows,
    };
    cacheEntry = {
      expiresAt: Date.now() + SOURCE_CACHE_TTL_MS,
      result,
    };
    return result;
  } catch {
    return staleFallback("Salomon 공식 일정 확인 실패");
  }
}

export async function fetchSalomonReleases(): Promise<SalomonFetchResult> {
  if (cacheEntry && cacheEntry.expiresAt > Date.now()) {
    return cacheEntry.result;
  }
  if (!inFlight) {
    inFlight = requestSalomonReleases().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
