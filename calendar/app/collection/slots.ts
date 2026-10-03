export const COLLECTION_SLOTS = [
  "07:30",
  "09:30",
  "13:00",
  "18:00",
  "22:30",
] as const;

const seoulDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function collectionSlotKey(now: Date): string {
  const parts = Object.fromEntries(
    seoulDateTimeFormatter
      .formatToParts(now)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}`;
  const slot = [...COLLECTION_SLOTS].reverse().find((candidate) => candidate <= time);

  if (slot) {
    return `${date}@${slot}`;
  }

  const previousDay = new Date(
    Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - 1),
  );
  const previousDate = previousDay.toISOString().slice(0, 10);
  return `${previousDate}@22:30`;
}
