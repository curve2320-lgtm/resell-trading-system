import { getDb } from "../../../db";
import { releases } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";
import { releaseGetResponse } from "../../collection/release-api";

const allowedCategories = new Set(["선착순", "응모", "정보", "루머", "수강"]);

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "일정을 불러오지 못했습니다.";
  if (message.includes("no such table") || message.includes('from "releases"')) {
    return "데이터베이스 준비가 끝나지 않았습니다. 잠시 후 다시 시도해 주세요.";
  }
  return message;
}

export async function GET(request: Request) {
  return releaseGetResponse(new URL(request.url).searchParams.get("month") ?? undefined);
}

export async function POST(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    // 배포 환경에서는 Host 헤더 조작으로 로그인 검사를 우회할 수 없도록
    // 로컬 예외를 개발 모드로 한정한다.
    const isLocal =
      process.env.NODE_ENV !== "production" &&
      (requestUrl.hostname === "localhost" || requestUrl.hostname === "127.0.0.1");
    const user = await getChatGPTUser();
    if (!user && !isLocal) {
      return Response.json({ error: "로그인한 관리자만 일정을 등록할 수 있습니다." }, { status: 401 });
    }

    const payload = (await request.json()) as Record<string, unknown>;
    const title = String(payload.title ?? "").trim();
    const brand = String(payload.brand ?? "").trim();
    const category = String(payload.category ?? "정보").trim();
    const releaseDate = String(payload.releaseDate ?? "").trim();
    const releaseTime = String(payload.releaseTime ?? "").trim() || null;
    const sourceName = String(payload.sourceName ?? "").trim();
    const sourceUrl = String(payload.sourceUrl ?? "").trim() || null;

    if (!title || !brand || !releaseDate || !sourceName || !allowedCategories.has(category)) {
      return Response.json({ error: "제목, 브랜드, 발매일, 출처를 확인해 주세요." }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
      return Response.json({ error: "발매일 형식이 올바르지 않습니다." }, { status: 400 });
    }
    if (releaseTime && !/^\d{2}:\d{2}$/.test(releaseTime)) {
      return Response.json({ error: "발매시간 형식이 올바르지 않습니다." }, { status: 400 });
    }

    const [release] = await getDb()
      .insert(releases)
      .values({
        title,
        brand,
        category,
        releaseDate,
        releaseTime,
        channel: String(payload.channel ?? "온라인").trim() || "온라인",
        sourceName,
        sourceUrl,
        status: category === "루머" ? "검수중" : "예정",
        confidence: category === "루머" ? 40 : 100,
        note: String(payload.note ?? "").trim(),
        isFeatured: false,
        createdBy: user?.email ?? "local-preview",
      })
      .returning();

    return Response.json({ release }, { status: 201 });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
