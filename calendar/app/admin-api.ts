import type { ChatGPTUser } from "./chatgpt-auth.ts";
import {
  ReviewResolutionError,
  type CachedRelease,
  type CollectionRepository,
  type ResolveReviewInput,
  type ReviewItem,
  type SourceHealth,
} from "./collection/repository.ts";
import type { CollectionSummary } from "./collection/run.ts";
import type { ReviewReason } from "./collection/types.ts";
import { safeRetailerUrl } from "./release-links.ts";
import { requestHasAllowedOrigin } from "./request-origin.ts";
import { AdminAccessError } from "./admin-auth.ts";

export { ReviewResolutionError };

export type AdminReviewValueDto = {
  title: string;
  releaseDate: string;
  releaseTime: string | null;
};

export type AdminReviewCandidateDto = AdminReviewValueDto & {
  retailer: string;
  productUrl: string | null;
  sourceUrl: string | null;
};

export type AdminReviewDto = {
  id: number;
  sourceKey: string;
  externalId: string;
  reason: ReviewReason;
  previous: AdminReviewValueDto | null;
  candidate: AdminReviewCandidateDto;
};

export type AdminMergeTargetDto = {
  id: string;
  title: string;
  releaseDate: string;
};

export type AdminSourceHealthDto = {
  sourceKey: string;
  status: SourceHealth["status"];
  statusLabel: "Connected" | "Error" | "Manual";
  operatorMessage: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  sourceCount: number;
  newCount: number;
  mergedCount: number;
  reviewCount: number;
};

export type AdminDashboardData = {
  pendingCount: number;
  reviews: AdminReviewDto[];
  sourceHealth: AdminSourceHealthDto[];
  mergeTargets: AdminMergeTargetDto[];
};

type AdminApiDependencies = {
  requireAdmin(): Promise<ChatGPTUser>;
  repository: CollectionRepository;
  configuredSourceKeys: readonly string[];
  collectSource(sourceKey: string): Promise<CollectionSummary>;
};

type ReviewActionPayload =
  | { action: "approve" }
  | { action: "ignore" }
  | { action: "merge"; releaseId: string }
  | {
      action: "edit";
      releaseDate: string;
      releaseTime: string | null;
      title: string;
    };

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
};

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return Response.json(body, {
    status,
    headers: RESPONSE_HEADERS,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function validIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function validTitle(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 200 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function validDate(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function validTime(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))
  );
}

function validReviewId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function parseReviewAction(value: unknown): ReviewActionPayload | null {
  if (!isRecord(value) || typeof value.action !== "string") return null;

  if (
    (value.action === "approve" || value.action === "ignore") &&
    hasExactKeys(value, ["action"])
  ) {
    return { action: value.action };
  }
  if (
    value.action === "merge" &&
    hasExactKeys(value, ["action", "releaseId"]) &&
    validIdentifier(value.releaseId)
  ) {
    return { action: "merge", releaseId: value.releaseId };
  }
  if (
    value.action === "edit" &&
    hasExactKeys(value, [
      "action",
      "releaseDate",
      "releaseTime",
      "title",
    ]) &&
    validTitle(value.title) &&
    validDate(value.releaseDate) &&
    validTime(value.releaseTime)
  ) {
    return {
      action: "edit",
      title: value.title,
      releaseDate: value.releaseDate,
      releaseTime: value.releaseTime,
    };
  }
  return null;
}

async function requestPayload(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function safeText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeNullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function projectReview(
  item: ReviewItem,
  cachedByCanonicalKey: ReadonlyMap<string, CachedRelease>,
): AdminReviewDto {
  let payload: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(item.payloadJson);
    if (isRecord(parsed)) payload = parsed;
  } catch {
    // Keep a visible, inert exception row without exposing the raw payload.
  }
  const release = isRecord(payload.release) ? payload.release : {};
  const previous = cachedByCanonicalKey.get(
    safeText(payload.canonicalKey),
  );

  return {
    id: item.id,
    sourceKey: item.sourceKey,
    externalId: item.externalId,
    reason: item.reason,
    previous: previous
      ? {
          title: previous.title,
          releaseDate: previous.releaseDate,
          releaseTime: previous.releaseTime,
        }
      : null,
    candidate: {
      title: safeText(release.title),
      releaseDate: safeText(release.releaseDate),
      releaseTime: safeNullableText(release.releaseTime),
      retailer: safeText(release.retailer),
      productUrl: safeRetailerUrl(safeNullableText(release.productUrl)),
      sourceUrl: safeRetailerUrl(safeNullableText(release.sourceUrl)),
    },
  };
}

function projectSourceHealth(
  health: SourceHealth,
): AdminSourceHealthDto {
  const presentation = {
    connected: {
      statusLabel: "Connected",
      operatorMessage: "Collection completed successfully.",
    },
    error: {
      statusLabel: "Error",
      operatorMessage:
        "Collection failed. Refresh this source or inspect worker logs.",
    },
    manual: {
      statusLabel: "Manual",
      operatorMessage: "This source requires manual collection.",
    },
  } as const;

  return {
    sourceKey: health.sourceKey,
    status: health.status,
    ...presentation[health.status],
    lastSuccessAt: health.lastSuccessAt,
    lastFailureAt: health.lastFailureAt,
    consecutiveFailures: health.consecutiveFailures,
    sourceCount: health.sourceCount,
    newCount: health.newCount,
    mergedCount: health.mergedCount,
    reviewCount: health.reviewCount,
  };
}

export async function readAdminDashboardData(
  repository: CollectionRepository,
): Promise<AdminDashboardData> {
  const [reviewItems, sourceHealth, cachedReleases] = await Promise.all([
    repository.listReviewItems(),
    repository.listSourceHealth(),
    repository.listCachedReleases(),
  ]);
  const cachedByCanonicalKey = new Map(
    cachedReleases.map((release) => [release.canonicalKey, release]),
  );

  return {
    pendingCount: reviewItems.length,
    reviews: reviewItems.map((item) =>
      projectReview(item, cachedByCanonicalKey),
    ),
    sourceHealth: sourceHealth.map(projectSourceHealth),
    mergeTargets: cachedReleases.map(({ id, title, releaseDate }) => ({
      id,
      title,
      releaseDate,
    })),
  };
}

function accessErrorResponse(error: unknown): Response | null {
  return error instanceof AdminAccessError
    ? jsonResponse({ error: error.message }, error.status)
    : null;
}

function reviewResolutionErrorResponse(error: unknown): Response | null {
  if (!(error instanceof ReviewResolutionError)) return null;
  if (error.code === "not_pending") {
    return jsonResponse(
      { error: "Review item is no longer pending." },
      409,
    );
  }
  if (error.code === "merge_target_not_found") {
    return jsonResponse({ error: "Merge target was not found." }, 404);
  }
  return jsonResponse({ error: "Review item payload is invalid." }, 422);
}

export function createAdminApiHandlers(
  dependencies: AdminApiDependencies,
) {
  async function GET(): Promise<Response> {
    try {
      await dependencies.requireAdmin();
      return jsonResponse(
        await readAdminDashboardData(dependencies.repository),
      );
    } catch (error) {
      return (
        accessErrorResponse(error) ??
        jsonResponse(
          { error: "Administration data is temporarily unavailable." },
          500,
        )
      );
    }
  }

  async function POST(request: Request): Promise<Response> {
    try {
      await dependencies.requireAdmin();
    } catch (error) {
      return (
        accessErrorResponse(error) ??
        jsonResponse(
          { error: "Administration is temporarily unavailable." },
          500,
        )
      );
    }
    if (!requestHasAllowedOrigin(request)) {
      return jsonResponse({ error: "Request origin is not allowed." }, 403);
    }

    const payload = await requestPayload(request);
    if (
      !isRecord(payload) ||
      !hasExactKeys(payload, ["sourceKey"]) ||
      typeof payload.sourceKey !== "string" ||
      !dependencies.configuredSourceKeys.includes(payload.sourceKey)
    ) {
      return jsonResponse({ error: "A registered sourceKey is required." }, 400);
    }

    try {
      const summary = await dependencies.collectSource(payload.sourceKey);
      return jsonResponse({
        sourceKey: payload.sourceKey,
        sourcesRun: summary.sourcesRun,
        sourcesSucceeded: summary.sourcesSucceeded,
        sourcesFailed: summary.sourcesFailed,
        releasesCollected: summary.releasesCollected,
        reviewItemsCreated: summary.reviewItemsCreated,
      });
    } catch {
      return jsonResponse(
        { error: "Source collection is temporarily unavailable." },
        500,
      );
    }
  }

  async function PATCH(request: Request, idValue: string): Promise<Response> {
    let user: ChatGPTUser;
    try {
      user = await dependencies.requireAdmin();
    } catch (error) {
      return (
        accessErrorResponse(error) ??
        jsonResponse(
          { error: "Administration is temporarily unavailable." },
          500,
        )
      );
    }
    if (!requestHasAllowedOrigin(request)) {
      return jsonResponse({ error: "Request origin is not allowed." }, 403);
    }

    const id = validReviewId(idValue);
    const action = parseReviewAction(await requestPayload(request));
    if (id === null || action === null) {
      return jsonResponse({ error: "A valid review action is required." }, 400);
    }

    const input = {
      id,
      ...action,
      resolvedBy: user.email,
    } satisfies ResolveReviewInput;
    try {
      await dependencies.repository.resolveReview(input);
      const status =
        action.action === "ignore"
          ? "ignored"
          : action.action === "merge"
            ? "merged"
            : "approved";
      return jsonResponse({ id, status });
    } catch (error) {
      return (
        reviewResolutionErrorResponse(error) ??
        jsonResponse(
          { error: "Review action is temporarily unavailable." },
          500,
        )
      );
    }
  }

  return { GET, POST, PATCH };
}
