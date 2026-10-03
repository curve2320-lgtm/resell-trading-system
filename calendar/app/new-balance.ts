import type { ExternalRelease, SourceFetchResult } from "./source-types";
import {
  fetchSourceText,
  htmlText,
  SOURCE_CACHE_TTL_MS,
  todayInSeoul,
} from "./source-utils";

const CALENDAR_URL = "https://m.nbkorea.com/launchingCalendar/list.action";
const MANUAL_MESSAGE = "오늘 확인 안 됨 — 공식 런칭캘린더에서 확인";

type CacheEntry = {
  expiresAt: number;
  result: SourceFetchResult;
};

let cacheEntry: CacheEntry | null = null;
let inFlight: Promise<SourceFetchResult> | null = null;

function attribute(tag: string, name: string) {
  return htmlText(
    tag.match(new RegExp(`${name}=["']([^"']*)["']`, "i"))?.[1] ?? "",
  );
}

function releaseDate(month: number, day: number, today: string) {
  const [currentYear] = today.split("-").map(Number);
  const make = (year: number) =>
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  let value = make(currentYear);

  const current = new Date(`${today}T12:00:00+09:00`).getTime();
  const candidate = new Date(`${value}T12:00:00+09:00`).getTime();
  const halfYear = 180 * 24 * 60 * 60 * 1000;
  if (candidate < current - halfYear) value = make(currentYear + 1);
  return value;
}

export function parseNewBalanceCalendar(
  html: string,
  now = new Date(),
): ExternalRelease[] {
  const today = todayInSeoul(now);
  const anchorPattern =
    /<a\b[^>]*class=["'][^"']*\bjsLaunchingDetailBtn\b[^"']*["'][^>]*>/gi;
  const anchors = [...html.matchAll(anchorPattern)];
  const releases: ExternalRelease[] = [];

  for (const anchorMatch of anchors) {
    const tag = anchorMatch[0];
    if (attribute(tag, "data-launch-status").toUpperCase() !== "COMMING") continue;

    const launchingIdx = attribute(tag, "data-launching-calendar-idx");
    const launchType = attribute(tag, "data-launch-type").toUpperCase();
    if (!launchingIdx) continue;
    const blockStart = anchorMatch.index ?? 0;
    const blockEnd = html.indexOf("</li>", blockStart);
    const block = html.slice(blockStart, blockEnd > blockStart ? blockEnd : undefined);
    const timeText = htmlText(
      block.match(
        /<span\s+class=["']?launching_time["']?[^>]*>([\s\S]*?)<\/span>/i,
      )?.[1] ?? "",
    );
    const dateMatch = timeText.match(
      /(\d{1,2})\/(\d{1,2})\s*(오전|오후)\s*(\d{1,2}):(\d{2})/,
    );
    if (!dateMatch) continue;

    const date = releaseDate(Number(dateMatch[1]), Number(dateMatch[2]), today);
    if (date < today) continue;
    let hour = Number(dateMatch[4]);
    if (dateMatch[3] === "오전" && hour === 12) hour = 0;
    if (dateMatch[3] === "오후" && hour < 12) hour += 12;
    const time = `${String(hour).padStart(2, "0")}:${dateMatch[5]}`;
    const title =
      attribute(tag, "data-launch-title") ||
      htmlText(
        block.match(
          /<span\s+class=["']?launching_name["']?[^>]*>([\s\S]*?)<\/span>/i,
        )?.[1] ?? "",
      );
    if (!title) continue;

    const sourceUrl = new URL(
      `/launchingCalendar/detail.action?listStatus=H&launchingIdx=${encodeURIComponent(launchingIdx)}`,
      CALENDAR_URL,
    ).toString();
    const externalId = `newbalance:${launchingIdx}`;
    const isRaffle = launchType === "R" || /\[?RAFFLE\]?/i.test(title);

    releases.push({
      id: externalId,
      externalId,
      title,
      brand: "NEW BALANCE",
      category: isRaffle ? "응모" : "정보",
      releaseDate: date,
      releaseTime: time,
      channel: isRaffle ? "New Balance Korea 응모" : "New Balance Korea",
      sourceName: "NEW BALANCE",
      sourceUrl,
      status: "예정",
      confidence: 100,
      note: isRaffle
        ? "뉴발란스 공식 런칭캘린더의 응모 예정 일정입니다."
        : "뉴발란스 공식 런칭캘린더의 출시 예정 일정입니다.",
      isFeatured: false,
      retailer: "New Balance Korea",
      releaseMethod: isRaffle ? "응모" : "출시 예정",
      scheduleLabel: `${date} ${time} 출시 예정`,
      startAt: `${date}T${time}:00+09:00`,
      region: "한국",
      marketScope: "korea",
      productUrl: sourceUrl,
    });
  }

  return [...new Map(releases.map((item) => [item.externalId, item])).values()];
}

function fallbackResult(): SourceFetchResult {
  if (!cacheEntry) return { status: "manual", releases: [], message: MANUAL_MESSAGE };
  return {
    ...cacheEntry.result,
    status: "error",
    message: `${MANUAL_MESSAGE} · 이전 캐시 사용`,
  };
}

async function requestNewBalanceReleases(): Promise<SourceFetchResult> {
  try {
    const releases = parseNewBalanceCalendar(await fetchSourceText(CALENDAR_URL));
    if (!releases.length) return fallbackResult();
    const result: SourceFetchResult = {
      status: "connected",
      releases,
      message: "모바일 공식 런칭캘린더 정상 확인 · 30분 캐시",
    };
    cacheEntry = { expiresAt: Date.now() + SOURCE_CACHE_TTL_MS, result };
    return result;
  } catch {
    return fallbackResult();
  }
}

export async function fetchNewBalanceReleases() {
  if (cacheEntry && cacheEntry.expiresAt > Date.now()) return cacheEntry.result;
  if (!inFlight) {
    inFlight = requestNewBalanceReleases().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
