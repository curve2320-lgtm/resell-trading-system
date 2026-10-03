import type { ExternalRelease, SourceFetchResult } from "./source-types";
import {
  htmlText,
  numberValue,
  SOURCE_CACHE_TTL_MS,
  stringValue,
  withSourceRequest,
  won,
} from "./source-utils";

const KREAM_DRAW_URL = "https://kream.co.kr/brands/KREAM%20DRAW";
const KREAM_ORIGIN = "https://kream.co.kr";
const KREAM_API_ORIGIN = "https://api.kream.co.kr";
const KREAM_DRAW_SCREEN_PATH =
  "/api/screens/brands/KREAM%20DRAW/tabs/all?per_page=10";
const KREAM_API_VERSION = "61";
const KREAM_WEB_BUILD_VERSION = "26.9.4";
const KREAM_API_TIMEOUT_MS = 8_000;
const KREAM_HTML_FALLBACK_TIMEOUT_MS = 6_000;
const KREAM_FAILURE_RETRY_MS = 2 * 60 * 1000;
const MAX_CANDIDATE_BATCHES = 4;
const PRODUCT_CARD_MARKER =
  /data-sdui-id="product_card\/(\d+)"[^>]*href="([^"]+)"/gi;
const PARAGRAPH = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
const KREAM_EVENT_STYLE_CODE = /^(E\d{6})-\d+$/i;
const KOREAN_DATE_TIME =
  /(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일(?:\s*[월화수목금토일]요일)?\s*(오전|오후)?\s*(\d{1,2}):(\d{2})/;

type CacheEntry = {
  expiresAt: number;
  result: SourceFetchResult;
};

type KreamEventMetadata = {
  id: string;
  title: string;
  styleCode: string;
  batchCode: string;
  price: number | null;
};

export type KreamDrawCard = KreamEventMetadata & {
  productUrl: string;
  scheduled: boolean;
};

export type KreamDrawSchedule = {
  startAt: string;
  endAt: string;
  announcementAt: string | null;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  appOnly: boolean;
};

type KreamDrawBatch = {
  batchCode: string;
  cards: KreamDrawCard[];
  scheduled: boolean;
};

type ParsedDateTime = {
  iso: string;
  date: string;
  time: string;
  timestamp: number;
};

type JsonRecord = Record<string, unknown>;

let cacheEntry: CacheEntry | null = null;
let inFlight: Promise<SourceFetchResult> | null = null;
let kreamWebDeviceId: string | null = null;
let retryAfter = 0;
let lastFailureMessage = "";

function webDeviceId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `droplog-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function currentWebDeviceId() {
  if (!kreamWebDeviceId) kreamWebDeviceId = webDeviceId();
  return kreamWebDeviceId;
}

function kreamWebRequestSecret() {
  return process.env.KREAM_WEB_REQUEST_SECRET?.trim() ?? "";
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function kreamClientDateTime(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const part = (value: number, size = 2) =>
    String(value).padStart(size, "0");
  return [
    part(kst.getUTCFullYear(), 4),
    part(kst.getUTCMonth() + 1),
    part(kst.getUTCDate()),
    part(kst.getUTCHours()),
    part(kst.getUTCMinutes()),
    part(kst.getUTCSeconds()),
  ].join("") + "+0900";
}

function sourceFailureReason(error: unknown) {
  if (!(error instanceof Error)) return "알 수 없는 오류";
  if (error.name === "AbortError") return "응답 시간 초과";
  return error.message.slice(0, 120);
}

async function fetchKreamJson(path: string): Promise<unknown> {
  const webRequestSecret = kreamWebRequestSecret();
  if (!webRequestSecret) {
    throw new Error("KREAM 웹 API 서버 설정 없음");
  }

  const url = new URL(path, KREAM_API_ORIGIN);
  if (!url.searchParams.has("request_key")) {
    url.searchParams.set("request_key", webDeviceId());
  }

  return withSourceRequest(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), KREAM_API_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.6",
          Origin: KREAM_ORIGIN,
          Referer: `${KREAM_ORIGIN}/`,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
          "X-KREAM-API-VERSION": KREAM_API_VERSION,
          "X-KREAM-CLIENT-DATETIME": kreamClientDateTime(),
          "X-KREAM-DEVICE-ID": `web;${currentWebDeviceId()}`,
          "X-KREAM-WEB-BUILD-VERSION": KREAM_WEB_BUILD_VERSION,
          "X-KREAM-WEB-REQUEST-SECRET": webRequestSecret,
        },
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`KREAM API HTTP ${response.status}`);
      }
      const body = await response.json();
      if (!body || typeof body !== "object") {
        throw new Error("KREAM API 응답이 비어 있음");
      }
      return body;
    } finally {
      clearTimeout(timeout);
    }
  });
}

async function fetchKreamHtml(url: string) {
  return withSourceRequest(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      KREAM_HTML_FALLBACK_TIMEOUT_MS,
    );

    try {
      const response = await fetch(url, {
        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.6",
          Cookie: `strategy=local; ticketExpire=0; webDid=${currentWebDeviceId()}`,
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Upgrade-Insecure-Requests": "1",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        },
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`HTTP ${response.status}`);
      }
      const body = await response.text();
      if (body.length < 10_000) throw new Error("KREAM HTML 응답이 비어 있음");
      return body;
    } finally {
      clearTimeout(timeout);
    }
  });
}

function eventMetadata(html: string) {
  const script = html.match(
    /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
  )?.[1];
  if (!script) throw new Error("KREAM 목록 데이터 없음");

  const flattened = JSON.parse(script) as unknown;
  if (!Array.isArray(flattened)) {
    throw new Error("KREAM 목록 데이터 형식 오류");
  }

  const metadata = new Map<string, KreamEventMetadata>();
  for (const value of flattened) {
    if (typeof value !== "string" || !value.trimStart().startsWith("{")) continue;

    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      if (parsed.product_type !== "event_draw") continue;
      const productId = numberValue(parsed.product_id);
      const title = stringValue(parsed.product_name_ko);
      const styleCode = stringValue(parsed.product_style_code);
      const batchCode = styleCode?.match(KREAM_EVENT_STYLE_CODE)?.[1];
      if (!productId || !title || !styleCode || !batchCode) continue;

      const id = String(productId);
      metadata.set(id, {
        id,
        title,
        styleCode,
        batchCode: batchCode.toUpperCase(),
        price: numberValue(parsed.price),
      });
    } catch {
      // The Nuxt payload also contains non-product strings. Ignore malformed
      // entries and retain the independently rendered product cards.
    }
  }
  return metadata;
}

function cardParagraphs(block: string) {
  return [...block.matchAll(PARAGRAPH)]
    .map((match) => htmlText(match[1]))
    .filter(Boolean);
}

export function parseKreamDrawCards(html: string): KreamDrawCard[] {
  const metadata = eventMetadata(html);
  const markers = [...html.matchAll(PRODUCT_CARD_MARKER)];
  const cards: KreamDrawCard[] = [];

  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const id = marker[1];
    const meta = metadata.get(id);
    if (!meta) continue;

    const start = marker.index ?? 0;
    const end = markers[index + 1]?.index ?? html.length;
    const block = html.slice(start, end);
    const paragraphs = cardParagraphs(block);
    const href = marker[2].replaceAll("&amp;", "&");
    let productUrl: URL;
    try {
      productUrl = new URL(href, KREAM_ORIGIN);
    } catch {
      continue;
    }
    if (
      productUrl.protocol !== "https:" ||
      !["kream.co.kr", "www.kream.co.kr"].includes(
        productUrl.hostname.toLowerCase(),
      ) ||
      !productUrl.pathname.startsWith(`/products/${id}`)
    ) {
      continue;
    }

    cards.push({
      ...meta,
      productUrl: productUrl.toString(),
      scheduled: paragraphs.includes("진행예정"),
    });
  }

  if (!cards.length) throw new Error("KREAM DRAW 상품 카드 없음");
  return [
    ...new Map(cards.map((card) => [card.id, card])).values(),
  ];
}

function collectScreenProductCards(
  value: unknown,
  productCards: JsonRecord[],
) {
  if (Array.isArray(value)) {
    for (const item of value) collectScreenProductCards(item, productCards);
    return;
  }
  if (!isRecord(value)) return;
  if (
    value.display_type === "product_card" &&
    typeof value.id === "string" &&
    value.id.startsWith("product_card/")
  ) {
    productCards.push(value);
    return;
  }
  for (const child of Object.values(value)) {
    collectScreenProductCards(child, productCards);
  }
}

function screenCardActions(card: JsonRecord) {
  return Array.isArray(card.actions)
    ? card.actions.filter(isRecord)
    : [];
}

function screenCardMetadata(card: JsonRecord) {
  for (const action of screenCardActions(card)) {
    if (!isRecord(action.parameters)) continue;
    const properties = action.parameters.properties;
    if (!Array.isArray(properties)) continue;

    for (const property of properties) {
      if (typeof property !== "string") continue;
      try {
        const parsed = JSON.parse(property) as JsonRecord;
        if (parsed.product_type !== "event_draw") continue;
        const productId = numberValue(parsed.product_id);
        const title = stringValue(parsed.product_name_ko);
        const styleCode = stringValue(parsed.product_style_code);
        const batchCode = styleCode?.match(KREAM_EVENT_STYLE_CODE)?.[1];
        if (!productId || !title || !styleCode || !batchCode) continue;
        return {
          id: String(productId),
          title,
          styleCode,
          batchCode: batchCode.toUpperCase(),
          price: numberValue(parsed.price),
        } satisfies KreamEventMetadata;
      } catch {
        // Ignore unrelated analytics properties in the same SDUI action.
      }
    }
  }
  return null;
}

function screenCardProductUrl(card: JsonRecord, id: string) {
  const value = screenCardActions(card).find(
    (action) => action.type === "url" && typeof action.value === "string",
  )?.value;
  let productUrl: URL;
  try {
    productUrl = new URL(
      typeof value === "string" ? value : `/products/${id}`,
      KREAM_ORIGIN,
    );
  } catch {
    return null;
  }
  if (
    productUrl.protocol !== "https:" ||
    !["kream.co.kr", "www.kream.co.kr"].includes(
      productUrl.hostname.toLowerCase(),
    ) ||
    !productUrl.pathname.startsWith(`/products/${id}`)
  ) {
    return null;
  }
  return productUrl.toString();
}

export function parseKreamDrawScreen(screen: unknown): KreamDrawCard[] {
  const productCards: JsonRecord[] = [];
  collectScreenProductCards(screen, productCards);

  const cards = productCards.flatMap((card) => {
    const metadata = screenCardMetadata(card);
    if (!metadata) return [];
    const productUrl = screenCardProductUrl(card, metadata.id);
    if (!productUrl) return [];
    return [
      {
        ...metadata,
        productUrl,
        scheduled: JSON.stringify(card).includes("진행예정"),
      },
    ];
  });

  if (!cards.length) throw new Error("KREAM DRAW API 상품 카드 없음");
  return [...new Map(cards.map((card) => [card.id, card])).values()];
}

function screenNextCursor(screen: unknown) {
  if (!isRecord(screen) || !isRecord(screen.content)) return null;
  const pagination = screen.content.pagination;
  if (!isRecord(pagination)) return null;
  const cursor = stringValue(pagination.next_cursor);
  return cursor && /^\d+$/.test(cursor) ? cursor : null;
}

function validDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
) {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    year < 2000 ||
    year > 2100 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0",
  )}`;
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(
    2,
    "0",
  )}`;
  const iso = `${date}T${time}:00+09:00`;
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp)
    ? { iso, date, time, timestamp }
    : null;
}

function dateTimeCandidates(
  text: string,
  reference: Date,
): ParsedDateTime[] {
  const match = text.match(KOREAN_DATE_TIME);
  if (!match) return [];

  const explicitYear = match[1] ? Number(match[1]) : null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const meridiem = match[4] ?? null;
  let hour = Number(match[5]);
  const minute = Number(match[6]);
  if (meridiem === "오전" && hour === 12) hour = 0;
  if (meridiem === "오후" && hour < 12) hour += 12;

  const referenceYear = Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Seoul",
      year: "numeric",
    }).format(reference),
  );
  const years = explicitYear
    ? [explicitYear]
    : [referenceYear - 1, referenceYear, referenceYear + 1];

  return years
    .map((year) => validDateTime(year, month, day, hour, minute))
    .filter((value): value is ParsedDateTime => Boolean(value));
}

function closestDateTime(text: string, reference: Date) {
  return dateTimeCandidates(text, reference).sort(
    (left, right) =>
      Math.abs(left.timestamp - reference.getTime()) -
      Math.abs(right.timestamp - reference.getTime()),
  )[0];
}

function firstDateTimeAtOrAfter(
  text: string,
  reference: ParsedDateTime,
) {
  return dateTimeCandidates(text, new Date(reference.timestamp))
    .filter((value) => value.timestamp >= reference.timestamp)
    .sort((left, right) => left.timestamp - right.timestamp)[0];
}

export function parseKreamDrawSchedule(
  html: string,
  now = new Date(),
): KreamDrawSchedule | null {
  const scriptStart = html.search(/<script[^>]*(?:id="__NUXT_DATA__"|>window\.__NUXT__)/i);
  const visibleHtml = scriptStart >= 0 ? html.slice(0, scriptStart) : html;
  const text = htmlText(visibleHtml);
  const schedule = text.match(
    /응모\s*기간\s+(.{1,100}?)\s+-\s+(.{1,100}?)\s+당첨자\s*발표\s+(.{1,100}?)(?=\s+당첨\s*인원|\s+유의\s*사항)/,
  );
  if (!schedule) return null;

  const start = closestDateTime(schedule[1], now);
  if (!start) return null;
  const end = firstDateTimeAtOrAfter(schedule[2], start);
  if (!end || end.timestamp <= start.timestamp) return null;
  const announcement = firstDateTimeAtOrAfter(schedule[3], end) ?? null;

  return {
    startAt: start.iso,
    endAt: end.iso,
    announcementAt: announcement?.iso ?? null,
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    appOnly: /앱\s*전용/.test(text),
  };
}

function kstDateTimeFromIso(value: unknown): ParsedDateTime | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const kst = new Date(timestamp + 9 * 60 * 60 * 1000);
  const date = [
    String(kst.getUTCFullYear()).padStart(4, "0"),
    String(kst.getUTCMonth() + 1).padStart(2, "0"),
    String(kst.getUTCDate()).padStart(2, "0"),
  ].join("-");
  const time = [
    String(kst.getUTCHours()).padStart(2, "0"),
    String(kst.getUTCMinutes()).padStart(2, "0"),
  ].join(":");
  const seconds = String(kst.getUTCSeconds()).padStart(2, "0");
  return {
    iso: `${date}T${time}:${seconds}+09:00`,
    date,
    time,
    timestamp,
  };
}

export function parseKreamDrawProduct(
  product: unknown,
): KreamDrawSchedule | null {
  if (!isRecord(product) || !isRecord(product.event)) return null;
  const event = product.event;
  if (event.event_type !== "draw") return null;

  const start = kstDateTimeFromIso(event.date_started);
  const end = kstDateTimeFromIso(event.date_finished);
  const announcement = kstDateTimeFromIso(event.date_drawed);
  if (!start || !end || end.timestamp <= start.timestamp) return null;

  return {
    startAt: start.iso,
    endAt: end.iso,
    announcementAt:
      announcement && announcement.timestamp >= end.timestamp
        ? announcement.iso
        : null,
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    appOnly: JSON.stringify(event).includes("앱 전용"),
  };
}

function drawBatches(cards: KreamDrawCard[]) {
  const batches = new Map<string, KreamDrawBatch>();
  for (const card of cards) {
    const existing = batches.get(card.batchCode);
    if (existing) {
      existing.cards.push(card);
      existing.scheduled ||= card.scheduled;
      continue;
    }
    batches.set(card.batchCode, {
      batchCode: card.batchCode,
      cards: [card],
      scheduled: card.scheduled,
    });
  }
  return [...batches.values()];
}

function candidateBatches(cards: KreamDrawCard[]) {
  const batches = drawBatches(cards);
  const scheduled = batches.filter((batch) => batch.scheduled);
  const newestUnlabelled = batches.find((batch) => !batch.scheduled);
  return [
    ...(newestUnlabelled ? [newestUnlabelled] : []),
    ...scheduled,
  ].slice(0, MAX_CANDIDATE_BATCHES);
}

async function fetchKreamCards() {
  try {
    const firstScreen = await fetchKreamJson(KREAM_DRAW_SCREEN_PATH);
    const firstCards = parseKreamDrawScreen(firstScreen);
    const nextCursor = screenNextCursor(firstScreen);
    if (firstCards.some((card) => !card.scheduled) || !nextCursor) {
      return firstCards;
    }

    const nextPath = new URL(KREAM_DRAW_SCREEN_PATH, KREAM_API_ORIGIN);
    nextPath.searchParams.set("cursor", nextCursor);
    const nextCards = parseKreamDrawScreen(
      await fetchKreamJson(`${nextPath.pathname}${nextPath.search}`),
    );
    return [
      ...new Map(
        [...firstCards, ...nextCards].map((card) => [card.id, card]),
      ).values(),
    ];
  } catch (apiError) {
    const apiReason = sourceFailureReason(apiError);
    console.warn("KREAM DRAW API listing fallback", {
      reason: apiReason,
    });
    try {
      return parseKreamDrawCards(await fetchKreamHtml(KREAM_DRAW_URL));
    } catch (htmlError) {
      throw new Error(
        `API ${apiReason} · HTML ${sourceFailureReason(htmlError)}`,
      );
    }
  }
}

async function fetchBatchSchedule(batch: KreamDrawBatch, now: Date) {
  const representatives = batch.cards.slice(0, 2);
  for (const card of representatives) {
    try {
      const schedule = parseKreamDrawProduct(
        await fetchKreamJson(`/api/p/products/${card.id}`),
      );
      if (schedule) return schedule;
    } catch (error) {
      console.warn("KREAM DRAW API detail fallback", {
        batchCode: batch.batchCode,
        productId: card.id,
        reason: sourceFailureReason(error),
      });
    }

    try {
      const schedule = parseKreamDrawSchedule(
        await fetchKreamHtml(card.productUrl),
        now,
      );
      if (schedule) return schedule;
    } catch (error) {
      // A product page can intermittently fail while another product in the
      // same official event-code batch or API response remains available.
      console.warn("KREAM DRAW HTML detail check failed", {
        batchCode: batch.batchCode,
        productId: card.id,
        reason: sourceFailureReason(error),
      });
    }
  }
  return null;
}

export function normalizeKreamDraw(
  card: KreamDrawCard,
  schedule: KreamDrawSchedule,
  now = new Date(),
): ExternalRelease | null {
  const endTimestamp = Date.parse(schedule.endAt);
  if (!Number.isFinite(endTimestamp) || endTimestamp <= now.getTime()) {
    return null;
  }

  const externalId = `kream:${card.id}`;
  return {
    id: externalId,
    externalId,
    title: card.title,
    brand: "KREAM DRAW",
    category: "응모",
    releaseDate: schedule.endDate,
    releaseTime: schedule.endTime,
    channel: "KREAM DRAW",
    sourceName: "KREAM",
    sourceUrl: card.productUrl,
    status: "예정",
    confidence: 100,
    note: "KREAM 공식 응모입니다. 참여 조건은 상품 페이지에서 확인하세요.",
    isFeatured:
      /NIKE|JORDAN|ADIDAS|NEW BALANCE|ASICS|VANS|나이키|조던|아디다스|뉴발란스|아식스|반스/i.test(
        card.title,
      ),
    retailer: "KREAM",
    releaseMethod: "응모",
    winnerMethod: "추첨",
    scheduleLabel: `${schedule.startDate} ${schedule.startTime} ~ ${schedule.endDate} ${schedule.endTime} 응모`,
    startAt: schedule.startAt,
    endAt: schedule.endAt,
    announcementAt: schedule.announcementAt,
    startTimeUnknown: false,
    endTimeUnknown: false,
    priceLabel: won(card.price),
    styleCode: card.styleCode,
    region: "대한민국",
    marketScope: "korea",
    productUrl: card.productUrl,
    appOnly: schedule.appOnly,
    mode: "online",
  };
}

function unexpired(release: ExternalRelease, now = Date.now()) {
  if (!release.endAt) return false;
  const end = Date.parse(release.endAt);
  return Number.isFinite(end) && end > now;
}

function cachedReleases(now = Date.now()) {
  return cacheEntry?.result.releases.filter((release) =>
    unexpired(release, now),
  ) ?? [];
}

function sortReleases(releases: ExternalRelease[]) {
  return releases.sort((left, right) => {
    const dateOrder = left.releaseDate.localeCompare(right.releaseDate);
    if (dateOrder) return dateOrder;
    const timeOrder = (left.releaseTime ?? "").localeCompare(
      right.releaseTime ?? "",
    );
    return timeOrder || left.title.localeCompare(right.title, "ko");
  });
}

function staleResult(message: string): SourceFetchResult {
  const releases = cachedReleases();
  return {
    status: "error",
    releases,
    message: cacheEntry
      ? `${message} · 이전 성공 캐시 ${releases.length}건 사용`
      : message,
  };
}

function staleFallback(message: string): SourceFetchResult {
  lastFailureMessage = message;
  retryAfter = Date.now() + KREAM_FAILURE_RETRY_MS;
  return staleResult(message);
}

async function requestKreamReleases(): Promise<SourceFetchResult> {
  try {
    const now = new Date();
    const cards = await fetchKreamCards();
    const batches = candidateBatches(cards);
    const refreshedBatchCodes = new Set<string>();
    const fresh: ExternalRelease[] = [];
    let failedBatches = 0;

    const batchChecks = await Promise.all(
      batches.map(async (batch) => ({
        batch,
        schedule: await fetchBatchSchedule(batch, now),
      })),
    );
    for (const { batch, schedule } of batchChecks) {
      if (!schedule) {
        failedBatches += 1;
        continue;
      }
      refreshedBatchCodes.add(batch.batchCode);
      for (const card of batch.cards) {
        const release = normalizeKreamDraw(card, schedule, now);
        if (release) fresh.push(release);
      }
    }

    if (!refreshedBatchCodes.size) {
      return staleFallback("KREAM 응모 상세 일정 확인 실패");
    }

    const retained = cachedReleases(now.getTime()).filter((release) => {
      const batchCode = release.styleCode?.match(KREAM_EVENT_STYLE_CODE)?.[1];
      return !batchCode || !refreshedBatchCodes.has(batchCode.toUpperCase());
    });
    const releases = sortReleases([
      ...new Map(
        [...fresh, ...retained].map((release) => [
          release.externalId,
          release,
        ]),
      ).values(),
    ]);
    const result: SourceFetchResult = {
      status: failedBatches ? "error" : "connected",
      releases,
      message: failedBatches
        ? `공식 응모 ${releases.length}건 확인 · 일부 상세 일정 확인 실패 · 30분 캐시`
        : `공식 응모 ${releases.length}건 확인 · 30분 캐시`,
    };
    cacheEntry = {
      expiresAt: Date.now() + SOURCE_CACHE_TTL_MS,
      result,
    };
    retryAfter = 0;
    lastFailureMessage = "";
    return result;
  } catch (error) {
    const reason = sourceFailureReason(error);
    console.warn("KREAM DRAW listing check failed", { reason });
    return staleFallback(`KREAM 응모 확인 실패 · ${reason}`);
  }
}

export async function fetchKreamReleases(): Promise<SourceFetchResult> {
  if (cacheEntry && cacheEntry.expiresAt > Date.now()) {
    return {
      ...cacheEntry.result,
      releases: cachedReleases(),
    };
  }

  if (retryAfter > Date.now()) {
    return staleResult(
      `${lastFailureMessage || "KREAM 응모 확인 실패"} · 잠시 후 자동 재시도`,
    );
  }

  if (!inFlight) {
    inFlight = requestKreamReleases().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
