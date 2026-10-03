import type { ExternalRelease, SourceFetchResult } from "./source-types";
import {
  fetchSourceJson,
  isRecord,
  numberValue,
  stringValue,
} from "./source-utils";

const WORKSOUT_RAFFLE_API_URL =
  "https://api.worksout.co.kr/v1/raffle/products";
const WORKSOUT_RAFFLE_URL = "https://www.worksout.co.kr/app-download";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const CACHE_TTL_MS = 15 * 60 * 1000;
const TERMINAL_STATUS =
  /COMPLETED|CLOSED|FINISHED|ENDED|EXPIRED|CANCEL(?:LED)?|SOLD[_ -]?OUT|마감|종료|취소|품절/i;

type CacheEntry = {
  expiresAt: number;
  releases: ExternalRelease[];
};

export type WorksoutKstDateTime = {
  date: string;
  time: string;
  iso: string;
  timestamp: number;
};

export type WorksoutRafflePage = {
  page: number;
  totalPages: number;
  last: boolean;
  raffles: unknown[];
};

let cacheEntry: CacheEntry | null = null;
let inFlight: Promise<SourceFetchResult> | null = null;

const kstFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function integerValue(value: unknown) {
  const parsed = numberValue(value);
  return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
}

function wonAmount(value: unknown) {
  const amount = numberValue(value);
  if (amount === null || amount < 0) return null;
  return `${new Intl.NumberFormat("ko-KR").format(amount)}원`;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

/**
 * WORKSOUT currently returns ISO 8601 raffle timestamps with an explicit
 * +09:00 offset. Reject timezone-less values so a server locale can never
 * silently move a Korean deadline.
 */
export function parseWorksoutKstDateTime(
  value: unknown,
): WorksoutKstDateTime | null {
  const raw = stringValue(value);
  if (
    !raw ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(
      raw,
    )
  ) {
    return null;
  }

  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return null;

  const parts = kstFormatter.formatToParts(new Date(timestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  const time = `${part("hour")}:${part("minute")}`;
  const second = part("second");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return null;
  }

  return {
    date,
    time,
    iso: `${date}T${time}:${second || "00"}+09:00`,
    timestamp,
  };
}

export function parseWorksoutRafflePage(
  payload: unknown,
): WorksoutRafflePage | null {
  if (
    !isRecord(payload) ||
    stringValue(payload.code) !== "SUCCESS" ||
    !isRecord(payload.payload) ||
    !Array.isArray(payload.payload.content)
  ) {
    return null;
  }

  const page = integerValue(payload.payload.number);
  const totalPages = integerValue(payload.payload.totalPages);
  const last = booleanValue(payload.payload.last);

  if (
    page === null ||
    page < 0 ||
    totalPages === null ||
    totalPages < 0 ||
    last === null
  ) {
    return null;
  }

  return {
    page,
    totalPages,
    last,
    raffles: payload.payload.content,
  };
}

function raffleId(value: unknown) {
  const parsed = integerValue(value);
  return parsed !== null && parsed > 0 ? String(parsed) : null;
}

function releaseTitle(value: Record<string, unknown>) {
  const productName =
    stringValue(value.productKoreanName) ?? stringValue(value.productName);
  if (!productName) return null;

  const color =
    stringValue(value.colorKoreanName) ?? stringValue(value.color);
  if (!color || productName.toLocaleLowerCase().includes(color.toLocaleLowerCase())) {
    return productName;
  }
  return `${productName} · ${color}`;
}

export function normalizeWorksoutRaffle(
  value: unknown,
  now = new Date(),
): ExternalRelease | null {
  if (!isRecord(value)) return null;

  const id = raffleId(value.raffleProductId);
  const title = releaseTitle(value);
  const brand = stringValue(value.brandName) ?? "WORKSOUT";
  const status = stringValue(value.status);
  const statusCompleted = status === "COMPLETED";
  const start = parseWorksoutKstDateTime(value.availableFrom);
  const end = parseWorksoutKstDateTime(value.availableUntil);

  if (
    !id ||
    !title ||
    !start ||
    !end ||
    end.timestamp <= start.timestamp ||
    end.timestamp <= now.getTime() ||
    statusCompleted ||
    (status && TERMINAL_STATUS.test(status))
  ) {
    return null;
  }

  const instagramRaffle = booleanValue(value.isInstagramRaffle) === true;
  const externalId = `worksout:${id}`;

  return {
    id: externalId,
    externalId,
    title,
    brand,
    category: "응모",
    releaseDate: end.date,
    releaseTime: end.time,
    channel: "WORKSOUT 응모",
    sourceName: "WORKSOUT",
    sourceUrl: WORKSOUT_RAFFLE_URL,
    status: "예정",
    confidence: 100,
    note: instagramRaffle
      ? "응모 조건과 당첨 안내는 웍스아웃 공식 안내에서 확인하세요."
      : "웍스아웃 앱에서 진행되는 공식 응모입니다.",
    isFeatured: /NIKE|JORDAN|NEW BALANCE|ASICS|ADIDAS|VANS/i.test(brand),
    retailer: "WORKSOUT",
    releaseMethod: instagramRaffle ? "인스타그램 응모" : "응모",
    winnerMethod: "추첨",
    scheduleLabel: `${start.date} ${start.time} ~ ${end.date} ${end.time} 응모`,
    startAt: start.iso,
    endAt: end.iso,
    startTimeUnknown: false,
    endTimeUnknown: false,
    priceLabel: wonAmount(value.currentPrice),
    region: "대한민국",
    marketScope: "korea",
    productUrl: WORKSOUT_RAFFLE_URL,
    appOnly: !instagramRaffle,
    mode: "online",
  };
}

function listUrl(page: number) {
  const url = new URL(WORKSOUT_RAFFLE_API_URL);
  url.searchParams.set("page", String(page));
  url.searchParams.set("size", String(PAGE_SIZE));
  return url.toString();
}

async function fetchAllRafflePages() {
  const raffles: unknown[] = [];

  for (let expectedPage = 0; expectedPage < MAX_PAGES; expectedPage += 1) {
    const parsed = parseWorksoutRafflePage(
      await fetchSourceJson(listUrl(expectedPage)),
    );
    if (!parsed || parsed.page !== expectedPage) {
      throw new Error("WORKSOUT 응모 목록 응답 형식 오류");
    }
    if (parsed.totalPages > MAX_PAGES) {
      throw new Error("WORKSOUT 응모 페이지 안전 제한 초과");
    }

    raffles.push(...parsed.raffles);
    if (parsed.last || parsed.totalPages === 0) return raffles;

    if (
      parsed.raffles.length === 0 ||
      expectedPage + 1 >= parsed.totalPages
    ) {
      throw new Error("WORKSOUT 응모 페이지 정보 불일치");
    }
  }

  throw new Error("WORKSOUT 응모 페이지 안전 제한 초과");
}

function unexpired(release: ExternalRelease, now = Date.now()) {
  if (!release.endAt) return false;
  const end = Date.parse(release.endAt);
  return Number.isFinite(end) && end > now;
}

function cachedReleases(now = Date.now()) {
  return cacheEntry?.releases.filter((release) => unexpired(release, now)) ?? [];
}

function connectedResult(releases: ExternalRelease[]): SourceFetchResult {
  return {
    status: "connected",
    releases,
    message: `공식 응모 ${releases.length}건 확인 · 15분 캐시`,
  };
}

function staleFallback(message: string): SourceFetchResult {
  return {
    status: "error",
    releases: cachedReleases(),
    message: cacheEntry ? `${message} · 이전 성공 캐시 사용` : message,
  };
}

async function requestWorksoutReleases(): Promise<SourceFetchResult> {
  try {
    const now = new Date();
    const normalized = (await fetchAllRafflePages())
      .map((item) => normalizeWorksoutRaffle(item, now))
      .filter((release): release is ExternalRelease => Boolean(release));
    const releases = [
      ...new Map(
        normalized.map((release) => [release.externalId, release]),
      ).values(),
    ].sort((left, right) => {
      const dateOrder = left.releaseDate.localeCompare(right.releaseDate);
      if (dateOrder) return dateOrder;
      const timeOrder = (left.releaseTime ?? "").localeCompare(
        right.releaseTime ?? "",
      );
      return timeOrder || left.title.localeCompare(right.title, "ko");
    });

    cacheEntry = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      releases,
    };
    return connectedResult(releases);
  } catch {
    return staleFallback("WORKSOUT 응모 확인 실패");
  }
}

export async function fetchWorksoutReleases(): Promise<SourceFetchResult> {
  if (cacheEntry && cacheEntry.expiresAt > Date.now()) {
    return connectedResult(cachedReleases());
  }

  if (!inFlight) {
    inFlight = requestWorksoutReleases().finally(() => {
      inFlight = null;
    });
  }

  return inFlight;
}
