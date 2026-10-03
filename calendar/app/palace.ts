import type {
  ExternalRelease,
  SourceFetchResult,
  UndatedRelease,
} from "./source-types";
import {
  fetchSourceJson,
  isRecord,
  SOURCE_CACHE_TTL_MS,
  stringValue,
} from "./source-utils";

const PALACE_ORIGIN = "https://palaceskateboards.seoul.kr";
const PALACE_ENDPOINTS = [
  {
    waitingStoreId: 1,
    name: "압구정",
    url: "https://api.palaceskateboards.seoul.kr/v1/raffleStore/getRaffleStores?waitingStoreId=1",
  },
  {
    waitingStoreId: 7,
    name: "홍대",
    url: "https://api.palaceskateboards.seoul.kr/v1/raffleStore/getRaffleStores?waitingStoreId=7",
  },
] as const;

export type ParsedPalaceReleases = {
  releases: ExternalRelease[];
  undated: UndatedRelease[];
  malformedRows: number;
  structureValid: boolean;
};

export type PalaceFetchResult = Omit<SourceFetchResult, "undated"> & {
  undated: UndatedRelease[];
  malformedRows: number;
  snapshotComplete?: boolean;
};

type StorePayload = { waitingStoreId: number; payload: unknown };

type CacheEntry = {
  expiresAt: number;
  result: PalaceFetchResult;
};

let cacheEntry: CacheEntry | null = null;
let inFlight: Promise<PalaceFetchResult> | null = null;

function localDateTime(value: string) {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/u,
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second = "00"] = match;
  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour) - 9,
      Number(minute),
      Number(second),
    ),
  );
  if (Number.isNaN(date.getTime())) return null;
  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
    iso: `${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`,
    epoch: date.getTime(),
  };
}

function reservationsText(value: unknown) {
  if (!Array.isArray(value)) return "시간 미상";
  const times = value
    .filter(isRecord)
    .map((item) => stringValue(item.reservationTime))
    .filter((time): time is string => Boolean(time));
  return times.length ? times.join(", ") : "시간 미상";
}

function parseStorePayload(
  waitingStoreId: number,
  storeName: string,
  value: unknown,
  now: Date,
) {
  if (!isRecord(value) || value.code !== "SUCCESS" || !Array.isArray(value.payload)) {
    return { releases: [], malformedRows: 1, structureValid: false };
  }

  const releases: ExternalRelease[] = [];
  let malformedRows = 0;
  for (const item of value.payload) {
    if (!isRecord(item)) {
      malformedRows += 1;
      continue;
    }
    const id = typeof item.id === "number" || typeof item.id === "string" ? String(item.id) : null;
    const eventFrom = stringValue(item.eventFrom);
    const eventUntil = stringValue(item.eventUntil);
    const reservationDay = stringValue(item.reservationDay);
    const from = eventFrom ? localDateTime(eventFrom) : null;
    const until = eventUntil ? localDateTime(eventUntil) : null;
    if (
      !id ||
      item.visible !== true ||
      item.status !== "READY" ||
      !from ||
      !until ||
      !reservationDay ||
      until.epoch <= now.getTime()
    ) {
      if (item.visible === true && item.status === "READY") malformedRows += 1;
      continue;
    }

    const storeUrl = `${PALACE_ORIGIN}/waitingStore?waitingStoreId=${waitingStoreId}`;
    const externalId = `palace:${waitingStoreId}:${id}`;
    const times = reservationsText(item.raffleStoreReservations);
    releases.push({
      id: externalId,
      externalId,
      title: `PALACE 매장 입장 응모 · ${storeName}`,
      brand: "PALACE",
      category: "응모",
      releaseDate: from.date,
      releaseTime: from.time,
      channel: `PALACE ${storeName}`,
      sourceName: "PALACE",
      sourceUrl: storeUrl,
      status: "예정",
      confidence: 100,
      note: `사인업 ${from.date} ${from.time}–${until.time} · 방문 ${reservationDay} · 예약 시간 ${times}`,
      isFeatured: true,
      retailer: "PALACE 서울",
      releaseMethod: "매장 입장 응모",
      winnerMethod: "추첨",
      scheduleLabel: `사인업 ${from.date} ${from.time}–${until.time} · 방문 ${reservationDay}`,
      startAt: from.iso,
      endAt: until.iso,
      priceLabel: null,
      styleCode: null,
      region: "대한민국",
      marketScope: "korea",
      productUrl: storeUrl,
      mode: "offline",
    });
  }

  return { releases, malformedRows, structureValid: true };
}

export function parsePalaceReleases(
  storePayloads: ReadonlyArray<StorePayload>,
  now = new Date(),
): ParsedPalaceReleases {
  const releases: ExternalRelease[] = [];
  let malformedRows = 0;
  let structureValid = storePayloads.length === PALACE_ENDPOINTS.length;
  for (const { waitingStoreId, payload } of storePayloads) {
    const store = PALACE_ENDPOINTS.find((item) => item.waitingStoreId === waitingStoreId);
    if (!store) {
      malformedRows += 1;
      structureValid = false;
      continue;
    }
    const parsed = parseStorePayload(waitingStoreId, store.name, payload, now);
    releases.push(...parsed.releases);
    malformedRows += parsed.malformedRows;
    structureValid = structureValid && parsed.structureValid;
  }
  return {
    releases: releases.sort(
      (left, right) =>
        left.releaseDate.localeCompare(right.releaseDate) ||
        (left.releaseTime ?? "").localeCompare(right.releaseTime ?? "") ||
        left.title.localeCompare(right.title, "ko"),
    ),
    undated: [],
    malformedRows,
    structureValid,
  };
}

function staleFallback(message: string): PalaceFetchResult {
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

async function requestPalaceReleases(): Promise<PalaceFetchResult> {
  try {
    const payloads = await Promise.all(
      PALACE_ENDPOINTS.map(async ({ waitingStoreId, url }) => ({
        waitingStoreId,
        payload: await fetchSourceJson(url),
      })),
    );
    const parsed = parsePalaceReleases(payloads);
    if (!parsed.structureValid) return staleFallback("PALACE 사인업 API 구조 확인 실패");
    const result: PalaceFetchResult = {
      status: "connected",
      releases: parsed.releases,
      undated: [],
      message: `PALACE 압구정·홍대 사인업 ${parsed.releases.length}건 · 30분 캐시`,
      malformedRows: parsed.malformedRows,
      snapshotComplete: false,
    };
    cacheEntry = { expiresAt: Date.now() + SOURCE_CACHE_TTL_MS, result };
    return result;
  } catch {
    return staleFallback("PALACE 사인업 일정 확인 실패");
  }
}

export async function fetchPalaceReleases(): Promise<PalaceFetchResult> {
  if (cacheEntry && cacheEntry.expiresAt > Date.now()) return cacheEntry.result;
  if (!inFlight) {
    inFlight = requestPalaceReleases().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
