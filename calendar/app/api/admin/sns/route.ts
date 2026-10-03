import { AdminAccessError, requireAdmin } from "../../../admin-auth.ts";
import {
  createCollectionRepository,
  type CollectionRepository,
} from "../../../collection/repository.ts";
import {
  normalizeSnsIntake,
  type SnsIntakeInput,
} from "../../../collection/sns-intake.ts";
import { requestHasAllowedOrigin } from "../../../request-origin.ts";

function response(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function text(value: unknown, max = 200): string | null {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return null;
  }
  return value.trim();
}

function date(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? value
    : null;
}

function time(value: unknown): string | null {
  if (value === null || value === "") return null;
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? value
    : null;
}

function inputFrom(value: unknown): SnsIntakeInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  const postUrl = text(payload.postUrl, 500);
  const handle = text(payload.handle, 80);
  const title = text(payload.title, 200);
  const brand = text(payload.brand, 100);
  const category = payload.category;
  const releaseDate = date(payload.releaseDate);
  const releaseTime = time(payload.releaseTime);
  const styleCode = payload.styleCode === "" || payload.styleCode === null
    ? null
    : text(payload.styleCode, 80);
  const kind = payload.kind;
  if (
    !postUrl ||
    !handle ||
    !title ||
    !brand ||
    (category !== "sneakers" && category !== "fashion" && category !== "lifestyle") ||
    (kind !== "drop" && kind !== "raffle" && kind !== "restock" && kind !== "announcement") ||
    (payload.releaseDate !== null && payload.releaseDate !== "" && !releaseDate) ||
    (payload.releaseTime !== null && payload.releaseTime !== "" && !releaseTime) ||
    (payload.styleCode !== null && payload.styleCode !== "" && !styleCode)
  ) {
    return null;
  }
  return {
    postUrl,
    handle,
    title,
    brand,
    category,
    releaseDate,
    releaseTime,
    kind,
    styleCode,
  };
}

function accessError(error: unknown): Response | null {
  return error instanceof AdminAccessError
    ? response({ error: error.message }, error.status)
    : null;
}

export async function createSnsPostHandler(
  dependencies: {
    requireAdmin: typeof requireAdmin;
    repository: CollectionRepository;
  } = { requireAdmin, repository: createCollectionRepository() },
) {
  return async function POST(request: Request): Promise<Response> {
    let user;
    try {
      user = await dependencies.requireAdmin();
    } catch (error) {
      return accessError(error) ?? response({ error: "Administration is temporarily unavailable." }, 500);
    }
    if (!requestHasAllowedOrigin(request)) {
      return response({ error: "Request origin is not allowed." }, 403);
    }
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return response({ error: "A valid SNS payload is required." }, 400);
    }
    const input = inputFrom(payload);
    if (!input) return response({ error: "SNS fields are invalid." }, 400);
    const collectedAt = new Date().toISOString();
    const normalized = normalizeSnsIntake(input, collectedAt);
    if (normalized.kind === "reject") {
      const status = normalized.reason === "disabled" ? 403 : 400;
      return response({ error: normalized.reason }, status);
    }
    if (
      !dependencies.repository.persistManualSnsRelease ||
      !dependencies.repository.createManualSnsReview
    ) {
      return response({ error: "SNS intake is temporarily unavailable." }, 503);
    }
    if (normalized.kind === "review") {
      const outcome = await dependencies.repository.createManualSnsReview(
        normalized,
        collectedAt,
      );
      return response({ ...outcome, status: "review", reason: normalized.reason }, 202);
    }
    const outcome = await dependencies.repository.persistManualSnsRelease(
      normalized,
      collectedAt,
    );
    return response({ ...outcome, status: "published", submittedBy: user.email }, 201);
  };
}

export const POST = await createSnsPostHandler();
