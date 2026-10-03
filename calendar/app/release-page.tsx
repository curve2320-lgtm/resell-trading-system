import { getChatGPTUser } from "./chatgpt-auth";
import { ReleaseBoard } from "./release-board";

export type ReleasePageView = "today" | "calendar";

function seoulSnapshot() {
  const now = new Date();
  const todayIso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const updatedAtLabel = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(now);

  return {
    todayIso,
    updatedAtLabel,
    currentTimeIso: now.toISOString(),
  };
}

export async function ReleasePage({
  view,
  initialDate,
  initialDailyScope,
}: {
  view: ReleasePageView;
  initialDate?: string;
  initialDailyScope?: "today" | "tomorrow";
}) {
  const user = await getChatGPTUser();
  const snapshot = seoulSnapshot();

  return (
    <ReleaseBoard
      view={view}
      initialDate={initialDate}
      initialDailyScope={initialDailyScope}
      todayIso={snapshot.todayIso}
      updatedAtLabel={snapshot.updatedAtLabel}
      currentTimeIso={snapshot.currentTimeIso}
      userName={user?.displayName ?? "수강생"}
      signedIn={Boolean(user)}
    />
  );
}
