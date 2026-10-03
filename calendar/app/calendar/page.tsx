import { ReleasePage } from "../release-page";

export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  const initialDate =
    date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;

  return <ReleasePage view="calendar" initialDate={initialDate} />;
}
