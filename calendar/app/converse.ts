import type { ExternalRelease, SourceFetchResult } from "./source-types";
import {
  fetchSourceText,
  htmlText,
  SOURCE_CACHE_TTL_MS,
  todayInSeoul,
} from "./source-utils";

const CONVERSE_LAUNCH_URL =
  "https://www.converse.co.kr/limited/launch.html";
const MAX_FUTURE_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
const EXPLICIT_UNAVAILABLE =
  /ico_product_soldout|alt\s*=\s*["'][^"']*(?:품절|sold\s*out)[^"']*["']|(?:품절|sold\s*out)/i;

type CacheEntry = {
  expiresAt: number;
  result: SourceFetchResult;
};

type LaunchDateTime = {
  date: string;
  time: string;
  iso: string;
};

let cacheEntry: CacheEntry | null = null;
let inFlight: Promise<SourceFetchResult> | null = null;

function latestSection(html: string) {
  const header = html.search(
    /<h2\b[^>]*\bid=["']categoryName["'][^>]*>\s*The Latest\s*<\/h2>/i,
  );
  if (header < 0) {
    throw new Error("Converse The Latest 영역을 찾지 못했습니다.");
  }

  const following = html.slice(header);
  const nextSection = following.search(
    /<div\b[^>]*\bid=["']mcontent2["'][^>]*>/i,
  );
  return following.slice(0, nextSection > 0 ? nextSection : undefined);
}

function fieldText(block: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(
    new RegExp(
      `<li\\b[^>]*\\brel=["']${escapedLabel}["'][^>]*>[\\s\\S]*?<span\\b[^>]*>([\\s\\S]*?)<\\/span>`,
      "i",
    ),
  );
  return match ? htmlText(match[1]) : "";
}

function validLaunchDateTime(value: string): LaunchDateTime | null {
  const match = value.match(
    /\b(20\d{2})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?\b/,
  );
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? "0");
  const calendarDate = new Date(Date.UTC(year, month - 1, day));

  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const time = `${match[4]}:${match[5]}`;
  return {
    date,
    time,
    iso: `${date}T${time}:${String(second).padStart(2, "0")}+09:00`,
  };
}

function withinReleaseWindow(date: string, today: string) {
  if (date < today) return false;
  const releaseDay = Date.parse(`${date}T12:00:00+09:00`);
  const todayValue = Date.parse(`${today}T12:00:00+09:00`);
  return (
    Number.isFinite(releaseDay) &&
    Number.isFinite(todayValue) &&
    releaseDay - todayValue <= MAX_FUTURE_DAYS * DAY_MS
  );
}

function unavailableProduct(block: string) {
  const icons = block.matchAll(
    /<div\b[^>]*\bclass=["'][^"']*\b(?:m_icon|prdIco)\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
  );
  return [...icons].some((icon) => EXPLICIT_UNAVAILABLE.test(icon[1]));
}

function productHref(block: string, productId: string) {
  const escapedId = productId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(
    new RegExp(
      `<a\\b(?=[^>]*\\bname=["']anchorBoxName_${escapedId}["'])[^>]*\\bhref=["']([^"']+)["'][^>]*>`,
      "i",
    ),
  );
  if (!match) return null;

  try {
    const url = new URL(htmlText(match[1]), CONVERSE_LAUNCH_URL);
    if (
      url.protocol !== "https:" ||
      !["converse.co.kr", "www.converse.co.kr"].includes(
        url.hostname.toLowerCase(),
      )
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function productTitle(block: string, productId: string) {
  const escapedId = productId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const imageTag = block.match(
    new RegExp(
      `<img\\b(?=[^>]*\\bid=["']eListPrdImage${escapedId}(?:_\\d+)?["'])[^>]*>`,
      "i",
    ),
  )?.[0];
  const alt = imageTag?.match(/\balt=["']([^"']+)["']/i)?.[1];
  if (alt && htmlText(alt)) return htmlText(alt);

  const name = block.match(
    /<div\b[^>]*\bclass=["'][^"']*\bname\b[^"']*["'][^>]*>[\s\S]*?<span\b[^>]*>([\s\S]*?)<\/span>/i,
  );
  return name ? htmlText(name[1]) : "";
}

function priceLabel(block: string) {
  const price = fieldText(block, "판매가");
  const amount = price.match(/[\d,]+\s*원/);
  return amount ? amount[0].replace(/\s+/g, "") : price || null;
}

function normalizeProductBlock(
  block: string,
  productId: string,
  today: string,
): ExternalRelease | null {
  if (unavailableProduct(block)) return null;

  const launch = validLaunchDateTime(fieldText(block, "판매시작일"));
  const title = productTitle(block, productId);
  const productUrl = productHref(block, productId);
  if (
    !launch ||
    !withinReleaseWindow(launch.date, today) ||
    !title ||
    !productUrl
  ) {
    return null;
  }

  const externalId = `converse:${productId}`;
  return {
    id: externalId,
    externalId,
    title,
    brand: "Converse",
    category: "정보",
    releaseDate: launch.date,
    releaseTime: launch.time,
    channel: "Converse Korea",
    sourceName: "CONVERSE",
    sourceUrl: productUrl,
    status: "예정",
    confidence: 100,
    note: "컨버스 공식 런칭캘린더에 공개된 판매 시작 일정입니다.",
    isFeatured: false,
    retailer: "Converse Korea",
    releaseMethod: "온라인 발매",
    scheduleLabel: `${launch.date} ${launch.time} 발매`,
    startAt: launch.iso,
    startTimeUnknown: false,
    priceLabel: priceLabel(block),
    region: "한국",
    marketScope: "korea",
    productUrl,
    mode: "online",
  };
}

export function parseConverseLaunchCalendar(
  html: string,
  now = new Date(),
): ExternalRelease[] {
  const section = latestSection(html);
  const today = todayInSeoul(now);
  const productStarts = [
    ...section.matchAll(
      /<li\b[^>]*\bid=["']anchorBoxId_(\d+)["'][^>]*>/gi,
    ),
  ];
  const releases = new Map<string, ExternalRelease>();

  for (let index = 0; index < productStarts.length; index += 1) {
    const match = productStarts[index];
    const productId = match[1];
    if (releases.has(productId)) continue;

    const start = match.index ?? 0;
    const end = productStarts[index + 1]?.index ?? section.length;
    const release = normalizeProductBlock(
      section.slice(start, end),
      productId,
      today,
    );
    if (release) releases.set(productId, release);
  }

  return [...releases.values()].sort((left, right) => {
    const dateOrder = left.releaseDate.localeCompare(right.releaseDate);
    if (dateOrder) return dateOrder;
    const timeOrder = (left.releaseTime ?? "").localeCompare(
      right.releaseTime ?? "",
    );
    return timeOrder || left.title.localeCompare(right.title, "ko");
  });
}

function staleFallback(message: string): SourceFetchResult {
  if (!cacheEntry) return { status: "error", releases: [], message };

  const today = todayInSeoul();
  return {
    ...cacheEntry.result,
    status: "error",
    releases: cacheEntry.result.releases.filter((release) =>
      withinReleaseWindow(release.releaseDate, today),
    ),
    message: `${message} · 이전 성공 캐시 사용`,
  };
}

function connectedResult(releases: ExternalRelease[]): SourceFetchResult {
  return {
    status: "connected",
    releases,
    message: releases.length
      ? `공식 런칭 일정 ${releases.length}건 확인 · 30분 캐시`
      : "오늘 이후 공식 런칭 일정 0건 · 30분 캐시",
  };
}

async function requestConverseReleases(): Promise<SourceFetchResult> {
  try {
    const releases = parseConverseLaunchCalendar(
      await fetchSourceText(CONVERSE_LAUNCH_URL),
    );
    const result = connectedResult(releases);
    cacheEntry = {
      expiresAt: Date.now() + SOURCE_CACHE_TTL_MS,
      result,
    };
    return result;
  } catch {
    return staleFallback("Converse 런칭캘린더 확인 실패");
  }
}

export async function fetchConverseReleases(): Promise<SourceFetchResult> {
  if (cacheEntry && cacheEntry.expiresAt > Date.now()) {
    return cacheEntry.result;
  }

  if (!inFlight) {
    inFlight = requestConverseReleases().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

export const CONVERSE_CALENDAR_URL = CONVERSE_LAUNCH_URL;
