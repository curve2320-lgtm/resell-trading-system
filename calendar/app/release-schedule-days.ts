export type DayScheduledRelease = {
  releaseDate: string;
  category?: string;
  releaseMethod?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  startTimeUnknown?: boolean;
  endTimeUnknown?: boolean;
};

const DAY_MS = 86_400_000;
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const VISIBLE_CALENDAR_DAY_LIMIT = 42;

function utcDayStart(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const instant = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === day ? instant : null;
}

function explicitInstant(value: string | null | undefined, timeUnknown = false): number | null {
  if (!value) return null;
  if (timeUnknown && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const dayStart = utcDayStart(value);
    // This is an internal date boundary; the original source still has no known clock time.
    return dayStart === null ? null : dayStart - SEOUL_OFFSET_MS;
  }
  const match = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match || utcDayStart(match[1]) === null) return null;
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}

function confirmedRange(release: DayScheduledRelease): readonly [number, number] | null {
  const explicitFirstCome = /^(?:선착순|first[- ]come(?:[- ]first[- ]served)?)$/i.test(release.releaseMethod?.trim() ?? "");
  if (release.category !== "응모" && (!explicitFirstCome || ["정보", "루머", "수강"].includes(release.category ?? ""))) return null;
  const start = explicitInstant(release.startAt, release.startTimeUnknown === true);
  const end = explicitInstant(release.endAt, release.endTimeUnknown === true);
  return start !== null && end !== null && end >= start ? [start, end] : null;
}

function appears(release: DayScheduledRelease, day: string, utcStart: number, range: readonly [number, number] | null): boolean {
  if (release.releaseDate === day) return true;
  if (!range) return false;
  const seoulStart = utcStart - SEOUL_OFFSET_MS;
  return range[0] < seoulStart + DAY_MS && range[1] >= seoulStart;
}

/** Confirmed opening and closing dates include the closing day, even if its clock time is unknown. */
export function releaseAppearsOnDate<T extends DayScheduledRelease>(release: T, day: string): boolean {
  const utcStart = utcDayStart(day);
  return utcStart !== null && appears(release, day, utcStart, confirmedRange(release));
}

/** Index only visible cells, preserving unique product identity and input order in every cell. */
export function indexReleasesForDays<T extends DayScheduledRelease>(releases: readonly T[], days: readonly string[]): Record<string, T[]> {
  const visibleDays = [...new Set(days.slice(0, VISIBLE_CALENDAR_DAY_LIMIT))].flatMap(day => {
    const utcStart = utcDayStart(day);
    return utcStart === null ? [] : [{ day, utcStart }];
  });
  const indexed: Record<string, T[]> = Object.fromEntries(visibleDays.map(({ day }) => [day, []]));
  for (const release of releases) {
    const range = confirmedRange(release);
    for (const { day, utcStart } of visibleDays) {
      if (appears(release, day, utcStart, range)) indexed[day].push(release);
    }
  }
  return indexed;
}
