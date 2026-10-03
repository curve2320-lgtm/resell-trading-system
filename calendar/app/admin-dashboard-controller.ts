import type {
  AdminDashboardData,
  AdminReviewDto,
} from "./admin-api.ts";
import type { SnsIntakeInput } from "./collection/sns-intake.ts";

export type AdminReviewAction =
  | { action: "approve" }
  | { action: "ignore" }
  | { action: "merge"; releaseId: string }
  | {
      action: "edit";
      releaseDate: string;
      releaseTime: string | null;
      title: string;
    };

export type AdminDashboardState = {
  data: AdminDashboardData;
  loading: boolean;
  pendingReviewIds: ReadonlySet<number>;
  pendingSourceKeys: ReadonlySet<string>;
  error: string | null;
};

export type AdminDashboardController = {
  getSnapshot(): AdminDashboardState;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<boolean>;
  resolveReview(id: number, action: AdminReviewAction): Promise<boolean>;
  collectSource(sourceKey: string): Promise<boolean>;
  submitSns(input: SnsIntakeInput): Promise<boolean>;
};

type AdminDashboardControllerDependencies = {
  initialData: AdminDashboardData;
  request?: typeof fetch;
};

function validReview(value: unknown): value is AdminReviewDto {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "number" &&
    "sourceKey" in value &&
    typeof value.sourceKey === "string" &&
    "candidate" in value &&
    typeof value.candidate === "object" &&
    value.candidate !== null
  );
}

function validSourceHealth(value: unknown): boolean {
  if (
    typeof value !== "object" ||
    value === null ||
    !("status" in value) ||
    (value.status !== "connected" &&
      value.status !== "error" &&
      value.status !== "manual")
  ) {
    return false;
  }
  const presentation = {
    connected: [
      "Connected",
      "Collection completed successfully.",
    ],
    error: [
      "Error",
      "Collection failed. Refresh this source or inspect worker logs.",
    ],
    manual: [
      "Manual",
      "This source requires manual collection.",
    ],
  } as const;
  const [statusLabel, operatorMessage] = presentation[value.status];
  const record = value as Record<string, unknown>;
  const countFields = [
    "consecutiveFailures",
    "sourceCount",
    "newCount",
    "mergedCount",
    "reviewCount",
  ];
  return (
    typeof record.sourceKey === "string" &&
    record.sourceKey.length > 0 &&
    record.statusLabel === statusLabel &&
    record.operatorMessage === operatorMessage &&
    (record.lastSuccessAt === null ||
      typeof record.lastSuccessAt === "string") &&
    (record.lastFailureAt === null ||
      typeof record.lastFailureAt === "string") &&
    countFields.every(
      (field) =>
        typeof record[field] === "number" &&
        Number.isSafeInteger(record[field]) &&
        (record[field] as number) >= 0,
    ) &&
    Object.keys(record).every((key) =>
      [
        "sourceKey",
        "status",
        "statusLabel",
        "operatorMessage",
        "lastSuccessAt",
        "lastFailureAt",
        ...countFields,
      ].includes(key),
    )
  );
}

function validDashboardData(value: unknown): value is AdminDashboardData {
  return (
    typeof value === "object" &&
    value !== null &&
    "pendingCount" in value &&
    typeof value.pendingCount === "number" &&
    "reviews" in value &&
    Array.isArray(value.reviews) &&
    value.reviews.every(validReview) &&
    "sourceHealth" in value &&
    Array.isArray(value.sourceHealth) &&
    value.sourceHealth.every(validSourceHealth) &&
    "mergeTargets" in value &&
    Array.isArray(value.mergeTargets)
  );
}

async function responseError(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
    ) {
      return payload.error;
    }
  } catch {
    // Use the generic message for malformed server responses.
  }
  return "The administration request failed.";
}

export function createAdminDashboardController({
  initialData,
  request = fetch,
}: AdminDashboardControllerDependencies): AdminDashboardController {
  let state: AdminDashboardState = {
    data: initialData,
    loading: false,
    pendingReviewIds: new Set(),
    pendingSourceKeys: new Set(),
    error: null,
  };
  const listeners = new Set<() => void>();
  const reviewPromises = new Map<number, Promise<boolean>>();
  const sourcePromises = new Map<string, Promise<boolean>>();
  let refreshPromise: Promise<boolean> | null = null;
  let mutationRefreshPromise: Promise<boolean> | null = null;
  let refreshGeneration = 0;
  let appliedRefreshGeneration = 0;
  let mutationGeneration = 0;
  let appliedMutationGeneration = 0;
  let activeMutations = 0;
  const mutationSettledListeners = new Set<() => void>();

  function publish(next: AdminDashboardState) {
    state = next;
    for (const listener of listeners) listener();
  }

  function withoutReview(id: number): ReadonlySet<number> {
    const next = new Set(state.pendingReviewIds);
    next.delete(id);
    return next;
  }

  function withoutSource(sourceKey: string): ReadonlySet<string> {
    const next = new Set(state.pendingSourceKeys);
    next.delete(sourceKey);
    return next;
  }

  function mutationStarted() {
    activeMutations += 1;
  }

  function mutationFinished(successful: boolean) {
    if (successful) mutationGeneration += 1;
    activeMutations -= 1;
    if (activeMutations === 0) {
      for (const listener of mutationSettledListeners) listener();
      mutationSettledListeners.clear();
    }
  }

  function waitForMutationsToSettle(): Promise<void> {
    if (activeMutations === 0) return Promise.resolve();
    return new Promise((resolve) => {
      mutationSettledListeners.add(resolve);
    });
  }

  function refresh(): Promise<boolean> {
    if (refreshPromise) return refreshPromise;
    const currentRefreshGeneration = ++refreshGeneration;
    const capturedMutationGeneration = mutationGeneration;
    publish({ ...state, loading: true, error: null });
    let operation!: Promise<boolean>;
    operation = (async () => {
      try {
        const response = await request("/api/admin/reviews", {
          method: "GET",
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        if (!response.ok) {
          if (currentRefreshGeneration >= appliedRefreshGeneration) {
            publish({
              ...state,
              loading: false,
              error: await responseError(response),
            });
          }
          return false;
        }
        const data: unknown = await response.json();
        if (!validDashboardData(data)) {
          if (currentRefreshGeneration >= appliedRefreshGeneration) {
            publish({
              ...state,
              loading: false,
              error: "The administration response was invalid.",
            });
          }
          return false;
        }
        if (currentRefreshGeneration >= appliedRefreshGeneration) {
          appliedRefreshGeneration = currentRefreshGeneration;
          appliedMutationGeneration = Math.max(
            appliedMutationGeneration,
            capturedMutationGeneration,
          );
          publish({ ...state, data, loading: false, error: null });
        }
        return true;
      } catch {
        if (currentRefreshGeneration >= appliedRefreshGeneration) {
          publish({
            ...state,
            loading: false,
            error: "The administration request failed.",
          });
        }
        return false;
      } finally {
        if (refreshPromise === operation) refreshPromise = null;
      }
    })();
    refreshPromise = operation;
    return operation;
  }

  function refreshAfterMutations(): Promise<boolean> {
    if (mutationRefreshPromise) return mutationRefreshPromise;
    let operation: Promise<boolean>;
    operation = (async () => {
      while (true) {
        await waitForMutationsToSettle();
        if (refreshPromise) await refreshPromise;
        await waitForMutationsToSettle();
        if (appliedMutationGeneration >= mutationGeneration) return true;
        if (!(await refresh())) return false;
      }
    })().finally(() => {
      if (mutationRefreshPromise === operation) {
        mutationRefreshPromise = null;
      }
    });
    mutationRefreshPromise = operation;
    return operation;
  }

  function resolveReview(
    id: number,
    action: AdminReviewAction,
  ): Promise<boolean> {
    const existing = reviewPromises.get(id);
    if (existing) return existing;

    const pendingReviewIds = new Set(state.pendingReviewIds);
    pendingReviewIds.add(id);
    publish({ ...state, pendingReviewIds, error: null });
    const operation = (async () => {
      try {
        let successful = false;
        mutationStarted();
        try {
          const response = await request(`/api/admin/reviews/${id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(action),
          });
          if (!response.ok) {
            publish({ ...state, error: await responseError(response) });
            return false;
          }
          successful = true;
        } catch {
          publish({ ...state, error: "The review action failed." });
          return false;
        } finally {
          mutationFinished(successful);
        }

        return await refreshAfterMutations();
      } finally {
        publish({
          ...state,
          pendingReviewIds: withoutReview(id),
        });
        reviewPromises.delete(id);
      }
    })();
    reviewPromises.set(id, operation);
    return operation;
  }

  function collectSource(sourceKey: string): Promise<boolean> {
    const existing = sourcePromises.get(sourceKey);
    if (existing) return existing;

    const pendingSourceKeys = new Set(state.pendingSourceKeys);
    pendingSourceKeys.add(sourceKey);
    publish({ ...state, pendingSourceKeys, error: null });
    const operation = (async () => {
      try {
        let successful = false;
        mutationStarted();
        try {
          const response = await request("/api/admin/collect", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sourceKey }),
          });
          if (!response.ok) {
            publish({ ...state, error: await responseError(response) });
            return false;
          }
          successful = true;
        } catch {
          publish({ ...state, error: "Source collection failed." });
          return false;
        } finally {
          mutationFinished(successful);
        }

        return await refreshAfterMutations();
      } finally {
        publish({
          ...state,
          pendingSourceKeys: withoutSource(sourceKey),
        });
        sourcePromises.delete(sourceKey);
      }
    })();
    sourcePromises.set(sourceKey, operation);
    return operation;
  }

  function submitSns(input: SnsIntakeInput): Promise<boolean> {
    const operation = (async () => {
      let successful = false;
      mutationStarted();
      try {
        const response = await request("/api/admin/sns", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!response.ok) {
          publish({ ...state, error: await responseError(response) });
          return false;
        }
        successful = true;
      } catch {
        publish({ ...state, error: "SNS submission failed." });
        return false;
      } finally {
        mutationFinished(successful);
      }
      return await refreshAfterMutations();
    })();
    return operation;
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    resolveReview,
    collectSource,
    submitSns,
  };
}
