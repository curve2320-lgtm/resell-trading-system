import { safeRetailerUrl } from "./release-links.ts";
import { safeAnnouncementUrl } from "./sns-links.ts";

export type ReleaseExportChannel = {
  externalId?: string | null;
  sourceKey: string;
  retailer: string;
  releaseDate: string;
  releaseTime: string | null;
  productUrl?: string | null;
  sourceUrl?: string | null;
  priceLabel?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  announcementAt?: string | null;
  startTimeUnknown?: boolean;
  endTimeUnknown?: boolean;
};

export type ReleaseCalendarScope = { month?: string };

export type ReleaseExportInput = {
  id: number | string;
  title: string;
  category?: string;
  releaseDate: string;
  releaseTime: string | null;
  retailer?: string | null;
  channel?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  productUrl?: string | null;
  priceLabel?: string | null;
  note?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  announcementAt?: string | null;
  startTimeUnknown?: boolean;
  endTimeUnknown?: boolean;
  channels?: ReleaseExportChannel[];
};

type Moment = { day: string; instant: number | null };
type CalendarEvent = {
  uid: string;
  title: string;
  moment: Moment;
  description: string;
  url: string | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const OFFSET_INSTANT = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;

function validDay(day: string): boolean {
  if (!DAY.test(day)) return false;
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

function koreaDay(instant: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function scheduledMoment(day: string, time: string | null): Moment | null {
  if (!validDay(day)) return null;
  if (!time) return { day, instant: null };
  if (!TIME.test(time)) return null;
  return { day, instant: Date.parse(`${day}T${time}:00+09:00`) };
}

function explicitMoment(value: string | null | undefined, timeUnknown = false): Moment | null {
  if (!value) return null;
  if (DAY.test(value)) return validDay(value) ? { day: value, instant: null } : null;
  if (!OFFSET_INSTANT.test(value) || !validDay(value.slice(0, 10))) return null;
  // ISO offsets are bounded at 14:00, not 14:59.
  if (/[+-]14:(?!00)/.test(value)) return null;
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return null;
  return { day: koreaDay(instant), instant: timeUnknown ? null : instant };
}

function safeExportUrl(value: string | null | undefined): string | null {
  if (value && /[\u0000-\u001F\u007F]/.test(value)) return null;
  return safeRetailerUrl(value) ?? safeAnnouncementUrl(value);
}

function eventUrl(input: { productUrl?: string | null; sourceUrl?: string | null }): string | null {
  return safeExportUrl(input.productUrl) ?? safeExportUrl(input.sourceUrl);
}

function descriptionFor(release: ReleaseExportInput, moment: Moment): string {
  return [
    moment.instant === null ? "시간 미정 · 종일 표시" : "한국 시간(KST) 기준",
    release.priceLabel ? `발매가: ${release.priceLabel}` : null,
    release.note || null,
    ...(release.channels?.length ? release.channels : [{
      retailer: release.retailer || release.channel || release.sourceName || "",
      productUrl: release.productUrl, sourceUrl: release.sourceUrl, priceLabel: release.priceLabel,
    }]).map((channel) => [
      channel.retailer,
      channel.priceLabel,
      eventUrl(channel),
    ].filter(Boolean).join(" · ")),
  ].filter(Boolean).join("\n");
}

function channelIdentity(channel: ReleaseExportChannel): string {
  const identity = channel.externalId?.trim()
    ? `id:${channel.externalId.trim()}`
    : JSON.stringify([eventUrl(channel), channel.releaseDate, channel.releaseTime,
        channel.startAt ?? null, channel.endAt ?? null, channel.announcementAt ?? null]);
  return `channel:${channel.sourceKey}:${channel.retailer}:${identity}`;
}

function calendarEvents(releases: readonly ReleaseExportInput[], options: ReleaseCalendarScope = {}): CalendarEvent[] {
  if (options.month !== undefined && !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(options.month)) {
    throw new RangeError("내보낼 월은 YYYY-MM 형식이어야 합니다.");
  }
  const result = new Map<string, CalendarEvent>();
  for (const release of releases) {
    const push = (marker: string, title: string, moment: Moment | null, url = eventUrl(release)) => {
      if (!moment || (options.month && !moment.day.startsWith(`${options.month}-`))) return;
      const uid = `${encodeURIComponent(String(release.id))}.${encodeURIComponent(marker)}@calendar.curve-corp.com`;
      result.set(uid, { uid, title, moment, description: descriptionFor(release, moment), url });
    };
    const entry = release.category === "응모";
    if (release.channels?.length) {
      for (const [index, channel] of release.channels.entries()) {
        const marker = channelIdentity(channel);
        const title = `${release.title} · ${channel.retailer}`;
        // Older responses put only the primary retailer's metadata on the release.
        const start = channel.startAt ?? (index === 0 ? release.startAt : undefined);
        const end = channel.endAt ?? (index === 0 ? release.endAt : undefined);
        const startUnknown = channel.startTimeUnknown ?? (index === 0 ? release.startTimeUnknown : undefined);
        const endUnknown = channel.endTimeUnknown ?? (index === 0 ? release.endTimeUnknown : undefined);
        const opening = entry ? explicitMoment(start, startUnknown) : null;
        const closing = entry ? explicitMoment(end, endUnknown) : null;
        const url = eventUrl(channel);
        if (opening || closing) {
          push(`${marker}:entry-open`, `${title} · 응모 시작`, opening, url);
          push(`${marker}:entry-close`, `${title} · 응모 마감`, closing, url);
        } else {
          push(marker, `${title}${entry ? " 응모 일정" : ""}`, scheduledMoment(channel.releaseDate, channel.releaseTime), url);
        }
        const announcement = channel.announcementAt ?? (index === 0 ? release.announcementAt : undefined);
        push(`${marker}:announcement`, `${title} · 당첨 발표`, explicitMoment(announcement), url);
      }
    } else {
      const opening = entry ? explicitMoment(release.startAt, release.startTimeUnknown) : null;
      const closing = entry ? explicitMoment(release.endAt, release.endTimeUnknown) : null;
      if (opening || closing) {
        push("entry-open", `${release.title} · 응모 시작`, opening);
        push("entry-close", `${release.title} · 응모 마감`, closing);
      } else {
        push("release", `${release.title}${entry ? " · 응모 일정" : ""}`, scheduledMoment(release.releaseDate, release.releaseTime));
      }
      push("announcement", `${release.title} · 당첨 발표`, explicitMoment(release.announcementAt));
    }
  }
  return [...result.values()];
}

export function releaseCalendarEventCount(releases: readonly ReleaseExportInput[], options: ReleaseCalendarScope = {}): number {
  return calendarEvents(releases, options).length;
}

function escapeText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;").replace(/,/g, "\\,");
}

function foldLine(value: string): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let current = "";
  let bytes = 0;
  for (const character of value) {
    const length = encoder.encode(character).length;
    if (bytes + length > 75) {
      lines.push(current);
      current = " ";
      bytes = 1;
    }
    current += character;
    bytes += length;
  }
  lines.push(current);
  return lines.join("\r\n");
}

function utcStamp(instant: number): string {
  return new Date(instant).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

/** An .ics download is a snapshot. No reminder or subscription is implied. */
export function createReleaseCalendar(
  releases: readonly ReleaseExportInput[],
  options: ReleaseCalendarScope & { generatedAt?: string | Date; calendarName?: string } = {},
): string {
  const generated = options.generatedAt instanceof Date
    ? options.generatedAt.getTime()
    : options.generatedAt === undefined
      ? Date.now()
      : explicitMoment(options.generatedAt)?.instant;
  if (generated == null || !Number.isFinite(generated)) throw new TypeError("내보내기 시각이 올바르지 않습니다.");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CURVE//Release Calendar//KO",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(options.calendarName ?? "리셀하는 유과장 발매달력")}`,
    "X-WR-TIMEZONE:Asia/Seoul",
  ];
  for (const event of calendarEvents(releases, options)) {
    lines.push("BEGIN:VEVENT", `UID:${event.uid}`, `DTSTAMP:${utcStamp(generated)}`);
    if (event.moment.instant === null) {
      lines.push(`DTSTART;VALUE=DATE:${event.moment.day.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${nextDay(event.moment.day)}`);
    } else {
      lines.push(`DTSTART:${utcStamp(event.moment.instant)}`);
    }
    lines.push(`SUMMARY:${escapeText(event.title)}`, `DESCRIPTION:${escapeText(event.description)}`);
    if (event.url) lines.push(`URL:${event.url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

export function downloadReleaseCalendar(releases: readonly ReleaseExportInput[], filename: string, options: ReleaseCalendarScope = {}): void {
  const text = createReleaseCalendar(releases, options);
  const objectUrl = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = `${filename.replace(/[^a-zA-Z0-9_-]/g, "-")}.ics`;
  document.body.appendChild(anchor);
  try { anchor.click(); } finally {
    anchor.remove();
    // Safari may not consume the Blob until after the click handler returns.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}
