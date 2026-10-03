import type { ExternalRelease, SourceFetchResult } from "./source-types";
import { isRecord, numberValue, stringValue, withSourceRequest } from "./source-utils";

const RAFFLE_LIST_URL =
  "https://svc.soldout.co.kr/api/v3/product/raffle/get-raffle-list";
const RAFFLE_DETAIL_URL =
  "https://svc.soldout.co.kr/api/v3/product/raffle/get-raffle";
const RAFFLE_PAGE_ORIGIN = "https://svc.soldout.co.kr";
const CACHE_TTL_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;
const DETAIL_CONCURRENCY = 4;

type CacheEntry = {
  expiresAt: number;
  result: SourceFetchResult;
};

export type SoldoutKstDateTime = {
  date: string;
  time: string;
  iso: string;
  timestamp: number;
};

let cacheEntry: CacheEntry | null = null;
let inFlight: Promise<SourceFetchResult> | null = null;

function raffleId(value: unknown) {
  const id = numberValue(value);
  return id !== null && Number.isSafeInteger(id) && id > 0 ? String(id) : null;
}

/**
 * SOLDOUT sends timezone-less timestamps, but its Korean raffle pages interpret
 * them in KST. Keep the explicit +09:00 offset so downstream code does not
 * accidentally reinterpret them in the server's local timezone.
 */
export function parseSoldoutKstDateTime(
  value: unknown,
): SoldoutKstDateTime | null {
  const raw = stringValue(value);
  const match = raw?.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) return null;

  const [, year, month, day, hour, minute, second = "00"] = match;
  const date = `${year}-${month}-${day}`;
  const time = `${hour}:${minute}`;
  const iso = `${date}T${time}:${second}+09:00`;
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";

  if (
    `${part("year")}-${part("month")}-${part("day")}` !== date ||
    `${part("hour")}:${part("minute")}:${part("second")}` !==
      `${hour}:${minute}:${second}`
  ) {
    return null;
  }

  return { date, time, iso, timestamp };
}

export function safeSoldoutRaffleUrl(
  value: unknown,
  idValue: unknown,
): string | null {
  const id = raffleId(idValue);
  if (!id) return null;
  const fallback = `${RAFFLE_PAGE_ORIGIN}/product/raffle/${encodeURIComponent(id)}`;
  const candidate = stringValue(value);
  if (!candidate) return fallback;

  try {
    const url = new URL(candidate);
    const isOfficial =
      url.protocol === "https:" && url.hostname === "svc.soldout.co.kr";
    const isRafflePage =
      url.pathname === `/product/raffle/${id}` ||
      url.pathname === `/product/raffle/${id}/` ||
      url.pathname === `/trade/raffle/product/${id}` ||
      url.pathname === `/trade/raffle/product/${id}/`;
    return isOfficial && isRafflePage ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function priceLabel(value: unknown) {
  const price = numberValue(value);
  if (price === null || price < 0) return null;
  return `${new Intl.NumberFormat("ko-KR").format(price)}원`;
}

export function normalizeSoldoutRaffleItem(
  value: unknown,
  now = new Date(),
): ExternalRelease | null {
  if (!isRecord(value)) return null;

  const id = raffleId(value.id);
  const statusCode = stringValue(value.raffle_status_code);
  if (!id || (statusCode !== "00" && statusCode !== "10")) return null;
  if (numberValue(value.is_show) === 0) return null;

  const start = parseSoldoutKstDateTime(value.raffle_from);
  const end = parseSoldoutKstDateTime(value.raffle_to);
  if (!start || !end || end.timestamp <= start.timestamp) return null;

  const nowTimestamp = now.getTime();
  if (Number.isNaN(nowTimestamp) || end.timestamp <= nowTimestamp) return null;

  const title =
    stringValue(value.display_item_name_kor) ??
    stringValue(value.display_item_name);
  if (!title) return null;

  const links = isRecord(value.link_list) ? value.link_list : {};
  const sourceUrl = safeSoldoutRaffleUrl(links.web_link, id);
  if (!sourceUrl) return null;

  const announcement = parseSoldoutKstDateTime(value.raffle_draw_dt);
  const winnerCount = numberValue(value.draw_cnt);
  const externalId = `soldout:${id}`;

  return {
    id: externalId,
    externalId,
    title,
    brand: "SOLDOUT",
    category: "응모",
    releaseDate: end.date,
    releaseTime: end.time,
    channel: "SOLDOUT 래플",
    sourceName: "SOLDOUT",
    sourceUrl,
    status: "예정",
    confidence: 100,
    note: "솔드아웃 공식 래플 일정입니다.",
    isFeatured: false,
    retailer: "SOLDOUT",
    releaseMethod: "응모",
    winnerMethod:
      winnerCount !== null && winnerCount > 0
        ? `추첨 · ${winnerCount.toLocaleString("ko-KR")}명`
        : "추첨",
    scheduleLabel: `${start.date} ${start.time} ~ ${end.date} ${end.time}`,
    startAt: start.iso,
    endAt: end.iso,
    announcementAt: announcement?.iso ?? null,
    startTimeUnknown: false,
    endTimeUnknown: false,
    priceLabel:
      priceLabel(value.raffle_price) ?? priceLabel(value.item_price),
    region: "한국",
    marketScope: "korea",
    productUrl: sourceUrl,
    mode: "online",
  };
}

export function parseSoldoutListPayload(payload: unknown) {
  if (
    !isRecord(payload) ||
    numberValue(payload.code) !== 200 ||
    !isRecord(payload.data) ||
    !Array.isArray(payload.data.list)
  ) {
    throw new Error("SOLDOUT 래플 목록 응답 형식이 올바르지 않습니다.");
  }
  return payload.data.list;
}

function parseSoldoutDetailPayload(payload: unknown) {
  if (
    !isRecord(payload) ||
    numberValue(payload.code) !== 200 ||
    !isRecord(payload.data)
  ) {
    throw new Error("SOLDOUT 래플 상세 응답 형식이 올바르지 않습니다.");
  }
  return payload.data;
}

async function fetchSoldoutJson(url: string, appKey: string) {
  return withSourceRequest(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          APPKEY: appKey,
        },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`SOLDOUT HTTP ${response.status}`);
      }
      return (await response.json()) as unknown;
    } finally {
      clearTimeout(timeout);
    }
  });
}

async function fetchDetail(
  item: unknown,
  appKey: string,
): Promise<Record<string, unknown> | null> {
  if (!isRecord(item)) return null;
  const id = raffleId(item.id);
  if (!id) return null;

  const url = new URL(RAFFLE_DETAIL_URL);
  url.searchParams.set("raffle_id", id);
  try {
    return parseSoldoutDetailPayload(
      await fetchSoldoutJson(url.toString(), appKey),
    );
  } catch {
    return null;
  }
}

async function fetchDetails(
  items: unknown[],
  appKey: string,
): Promise<(Record<string, unknown> | null)[]> {
  const results = new Array<Record<string, unknown> | null>(items.length).fill(
    null,
  );
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fetchDetail(items[index], appKey);
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(DETAIL_CONCURRENCY, items.length) },
      worker,
    ),
  );
  return results;
}

function staleFallback(message: string): SourceFetchResult {
  if (!cacheEntry) return { status: "error", releases: [], message };
  const releases = cacheEntry.result.releases.filter((release) => {
    if (!release.endAt) return false;
    const end = Date.parse(release.endAt);
    return !Number.isNaN(end) && end > Date.now();
  });
  return {
    ...cacheEntry.result,
    status: "error",
    releases,
    message: `${message} · 이전 성공 데이터 사용`,
  };
}

async function requestSoldoutReleases(): Promise<SourceFetchResult> {
  const appKey = process.env.SOLDOUT_APP_KEY?.trim();
  if (!appKey) return staleFallback("솔드아웃 연동 설정이 필요합니다.");

  try {
    const now = new Date();
    const listPayload = await fetchSoldoutJson(RAFFLE_LIST_URL, appKey);
    const listItems = parseSoldoutListPayload(listPayload);
    const candidates = [
      ...new Map(
        listItems
          .filter((item) => normalizeSoldoutRaffleItem(item, now))
          .map((item) => [
            isRecord(item) ? raffleId(item.id) : null,
            item,
          ]),
      ).values(),
    ].filter((item): item is unknown => Boolean(item));

    const details = await fetchDetails(candidates, appKey);
    const releases = candidates
      .map((item, index) => {
        if (!isRecord(item)) return null;
        const detail = details[index];
        return normalizeSoldoutRaffleItem(
          detail ? { ...item, ...detail } : item,
          now,
        );
      })
      .filter((release): release is ExternalRelease => Boolean(release))
      .sort((left, right) => {
        const dateOrder = left.releaseDate.localeCompare(right.releaseDate);
        if (dateOrder) return dateOrder;
        const timeOrder = (left.releaseTime ?? "").localeCompare(
          right.releaseTime ?? "",
        );
        return timeOrder || left.title.localeCompare(right.title, "ko");
      });

    const detailCount = details.filter(Boolean).length;
    const result: SourceFetchResult = {
      status: "connected",
      releases,
      message:
        detailCount === candidates.length
          ? `공식 래플 ${releases.length}건 확인 · 15분 캐시`
          : `공식 래플 ${releases.length}건 확인 · 일부 상세 확인 보류 · 15분 캐시`,
    };
    cacheEntry = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      result,
    };
    return result;
  } catch {
    return staleFallback("솔드아웃 래플 확인 실패");
  }
}

export async function fetchSoldoutReleases(): Promise<SourceFetchResult> {
  if (cacheEntry && cacheEntry.expiresAt > Date.now()) {
    const releases = cacheEntry.result.releases.filter((release) => {
      if (!release.endAt) return false;
      const end = Date.parse(release.endAt);
      return !Number.isNaN(end) && end > Date.now();
    });
    return {
      ...cacheEntry.result,
      releases,
      message: `공식 래플 ${releases.length}건 확인 · 15분 캐시`,
    };
  }
  if (!inFlight) {
    inFlight = requestSoldoutReleases().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
