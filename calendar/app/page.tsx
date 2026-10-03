import { ReleasePage } from "./release-page";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const { day } = await searchParams;
  const initialDailyScope = day === "tomorrow" ? "tomorrow" : "today";

  return <ReleasePage view="today" initialDailyScope={initialDailyScope} />;
}
