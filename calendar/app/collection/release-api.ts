import {
  createCollectionRepository,
  readReleaseApiPayload,
  type ReleaseApiPayload,
} from "./repository.ts";
import { configuredReleaseSourceKeys, enabledReleaseSourceAdapters } from "./registry.ts";
import { startReleaseRefreshBatch, type ReleaseRefreshContext } from "./refresh.ts";
import {
  type CollectionAttemptOutcome,
} from "./run.ts";

const CACHE_HEADERS = { "Cache-Control": "private, max-age=60" };
const COLLECTION_ERROR_MESSAGE =
  "Release collection is temporarily unavailable.";
const COLLECTION_TIMEOUT_MESSAGE = "Release collection timed out.";
const CACHE_ERROR_MESSAGE = "Release cache is temporarily unavailable.";

export type ReleaseCollectionContext = {
  status: "current" | "stale" | "failed";
  message: string | null;
  pendingSources?: number;
};

export type ReleaseApiResponsePayload = ReleaseApiPayload & {
  collection: ReleaseCollectionContext;
};

export type ReleaseGetDependencies = {
  ensureCurrentSlotCollected(): Promise<CollectionAttemptOutcome>;
  readReleaseApiPayload(): Promise<ReleaseApiPayload>;
  configuredSourceKeys: readonly string[];
};

function allConfiguredSourcesFailed(
  payload: ReleaseApiPayload,
  configuredSourceKeys: readonly string[],
): boolean {
  return (
    configuredSourceKeys.length > 0 &&
    configuredSourceKeys.every(
      (sourceKey) => payload.sources[sourceKey]?.status === "error",
    )
  );
}

function publicCollectionErrorMessage(error: unknown): string {
  return error instanceof Error && error.name === "TimeoutError"
    ? COLLECTION_TIMEOUT_MESSAGE
    : COLLECTION_ERROR_MESSAGE;
}

export function createReleaseGetHandler(
  dependencies: ReleaseGetDependencies,
): () => Promise<Response> {
  return async () => {
    let attempt: CollectionAttemptOutcome | undefined;
    let collectionAttemptFailed = false;
    let collectionAttemptError: unknown;
    try {
      attempt = await dependencies.ensureCurrentSlotCollected();
    } catch (error) {
      collectionAttemptFailed = true;
      collectionAttemptError = error;
    }

    let payload: ReleaseApiPayload;
    try {
      payload = await dependencies.readReleaseApiPayload();
    } catch {
      return Response.json(
        { error: CACHE_ERROR_MESSAGE },
        {
          status: 500,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    const hasCachedReleases = payload.releases.length > 0;
    let collection: ReleaseCollectionContext;
    if (collectionAttemptFailed) {
      collection = {
        status: hasCachedReleases ? "stale" : "failed",
        message: publicCollectionErrorMessage(collectionAttemptError),
      };
    } else if (attempt?.state === "in_progress") {
      collection = {
        status: hasCachedReleases ? "stale" : "failed",
        message: "Release collection is currently in progress.",
      };
    } else if (attempt?.state === "failed") {
      collection = {
        status: hasCachedReleases ? "stale" : "failed",
        message: COLLECTION_ERROR_MESSAGE,
      };
    } else {
      collection = { status: "current", message: null };
    }
    const status =
      !hasCachedReleases &&
      (collectionAttemptFailed ||
        attempt?.state !== "current" ||
        allConfiguredSourcesFailed(
          payload,
          dependencies.configuredSourceKeys,
        ))
        ? 503
        : 200;

    return Response.json(
      {
        ...payload,
        collection,
      } satisfies ReleaseApiResponsePayload,
      { status, headers: CACHE_HEADERS },
    );
  };
}

export type CachedReleaseGetDependencies = {
  startRefresh(): Promise<ReleaseRefreshContext>;
  readReleaseApiPayload(): Promise<ReleaseApiPayload>;
  configuredSourceKeys: readonly string[];
};

/** Refresh registration only awaits durable slot reads, never upstream collection. */
export function createCachedReleaseGetHandler(
  dependencies: CachedReleaseGetDependencies,
): () => Promise<Response> {
  return async () => {
    let collection: ReleaseRefreshContext;
    try {
      collection = await dependencies.startRefresh();
    } catch (error) {
      collection = {
        status: "failed",
        message: publicCollectionErrorMessage(error),
        pendingSources: 0,
      };
    }
    let payload: ReleaseApiPayload;
    try {
      payload = await dependencies.readReleaseApiPayload();
    } catch {
      return Response.json({ error: CACHE_ERROR_MESSAGE }, {
        status: 500, headers: { "Cache-Control": "no-store" },
      });
    }
    const unavailable = payload.releases.length === 0 && (
      collection.status === "failed" || (
        collection.status === "current" &&
        allConfiguredSourcesFailed(payload, dependencies.configuredSourceKeys)
      )
    );
    return Response.json({ ...payload, collection } satisfies ReleaseApiResponsePayload, {
      status: unavailable ? 503 : 200,
      headers: collection.status === "current" && !unavailable
        ? CACHE_HEADERS : { "Cache-Control": "no-store" },
    });
  };
}

export async function releaseGetResponse(): Promise<Response> {
  const sourceKeys = configuredReleaseSourceKeys();
  const repository = createCollectionRepository();
  const { waitUntil } = await import("cloudflare:workers");
  return createCachedReleaseGetHandler({
    startRefresh: () => startReleaseRefreshBatch({
      repository, adapters: enabledReleaseSourceAdapters(), now: new Date(), waitUntil,
    }),
    readReleaseApiPayload: () => readReleaseApiPayload(repository, sourceKeys),
    configuredSourceKeys: sourceKeys,
  })();
}
