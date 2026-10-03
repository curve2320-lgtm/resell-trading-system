type JsonRecord = Record<string, unknown>;

export const SOURCE_CACHE_TTL_MS = 30 * 60 * 1000;
export const SOURCE_REQUEST_TIMEOUT_MS = 8_000;
const SOURCE_REQUEST_LIMIT = 8;
let activeSourceRequests = 0;
const waitingSourceRequests: Array<() => void> = [];

/** Hold a slot until the response body has been consumed, including on errors. */
export async function withSourceRequest<T>(operation: () => Promise<T>): Promise<T> {
  await new Promise<void>((resolve) => {
    const enter = () => { activeSourceRequests++; resolve(); };
    if (activeSourceRequests < SOURCE_REQUEST_LIMIT) enter();
    else waitingSourceRequests.push(enter);
  });
  try {
    return await operation();
  } finally {
    activeSourceRequests--;
    waitingSourceRequests.shift()?.();
  }
}

export function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replaceAll(",", ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function htmlText(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function seoulDateTime(value: string | number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";

  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

export function todayInSeoul(now = new Date()) {
  return seoulDateTime(now)?.date ?? now.toISOString().slice(0, 10);
}

export function won(value: unknown) {
  const amount = numberValue(value);
  return amount !== null && amount > 0
    ? `${new Intl.NumberFormat("ko-KR").format(amount)}원`
    : null;
}

export async function fetchSourceText(url: string) {
  return withSourceRequest(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SOURCE_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.6",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
        },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.text();
    } finally {
      clearTimeout(timeout);
    }
  });
}

export async function fetchSourceJson(url: string, options: RequestInit = {}) {
  return withSourceRequest(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SOURCE_REQUEST_TIMEOUT_MS);
    const headers = new Headers({
      Accept: "application/json",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.6",
      "User-Agent": "DROPLOGReleaseCalendar/1.0",
  });
  new Headers(options.headers).forEach((value, key) => headers.set(key, value));

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      cache: options.cache ?? "no-store",
      signal: options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timeout);
  }
  });
}
