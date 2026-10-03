export type SavedReleaseControllerStatus =
  | "disabled"
  | "idle"
  | "loading"
  | "ready"
  | "error"
  | "unauthorized";

export type SavedReleaseControllerState = {
  status: SavedReleaseControllerStatus;
  savedReleaseIds: ReadonlySet<string>;
  pendingReleaseIds: ReadonlySet<string>;
  errors: ReadonlyMap<string, string>;
  listError: string | null;
};

export type SavedReleaseController = {
  getSnapshot(): SavedReleaseControllerState;
  subscribe(listener: () => void): () => void;
  load(): Promise<void>;
  toggle(releaseId: string): Promise<boolean>;
  reset(authenticated: boolean): void;
};

type SavedReleaseControllerDependencies = {
  authenticated: boolean;
  request?: typeof fetch;
};

const LIST_ERROR = "관심 발매 목록을 불러오지 못했습니다.";
const MUTATION_ERROR =
  "관심 발매 변경을 저장하지 못했습니다. 다시 시도해 주세요.";

function initialState(
  authenticated: boolean,
): SavedReleaseControllerState {
  return {
    status: authenticated ? "idle" : "disabled",
    savedReleaseIds: new Set(),
    pendingReleaseIds: new Set(),
    errors: new Map(),
    listError: null,
  };
}

function parsedReleaseIds(payload: unknown): Set<string> | null {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("releaseIds" in payload)
  ) {
    return null;
  }
  const releaseIds = (payload as { releaseIds?: unknown }).releaseIds;
  if (
    !Array.isArray(releaseIds) ||
    !releaseIds.every((releaseId) => typeof releaseId === "string")
  ) {
    return null;
  }
  return new Set(releaseIds);
}

export function savedReleaseRequest(
  releaseId: string,
  save: boolean,
): { url: string; init: RequestInit } {
  if (save) {
    return {
      url: "/api/saved-releases",
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ releaseId }),
      },
    };
  }

  const query = new URLSearchParams({ releaseId });
  return {
    url: `/api/saved-releases?${query}`,
    init: { method: "DELETE" },
  };
}

export function savedReleaseButtonView(
  state: SavedReleaseControllerState,
  releaseId: string,
): {
  saved: boolean;
  pending: boolean;
  disabled: boolean;
  error: string | null;
} {
  const pending = state.pendingReleaseIds.has(releaseId);
  return {
    saved: state.savedReleaseIds.has(releaseId),
    pending,
    disabled: state.status !== "ready" || pending,
    error: state.errors.get(releaseId) ?? null,
  };
}

export function savedReleaseUiAvailable(
  state: SavedReleaseControllerState,
  signedIn: boolean,
): boolean {
  return (
    signedIn &&
    state.status !== "disabled" &&
    state.status !== "unauthorized"
  );
}

export function createSavedReleaseController({
  authenticated,
  request = fetch,
}: SavedReleaseControllerDependencies): SavedReleaseController {
  let state = initialState(authenticated);
  let generation = 0;
  let listVersion = 0;
  let loadingPromise: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const operationVersions = new Map<string, number>();
  const localRevisions = new Map<string, number>();

  function publish(next: SavedReleaseControllerState) {
    state = next;
    for (const listener of listeners) listener();
  }

  function bumpLocalRevision(releaseId: string) {
    localRevisions.set(
      releaseId,
      (localRevisions.get(releaseId) ?? 0) + 1,
    );
  }

  function replaceSaved(
    releaseId: string,
    saved: boolean,
  ): ReadonlySet<string> {
    const next = new Set(state.savedReleaseIds);
    if (saved) next.add(releaseId);
    else next.delete(releaseId);
    return next;
  }

  function withoutPending(
    releaseId: string,
  ): ReadonlySet<string> {
    const next = new Set(state.pendingReleaseIds);
    next.delete(releaseId);
    return next;
  }

  function withoutError(
    releaseId: string,
  ): ReadonlyMap<string, string> {
    const next = new Map(state.errors);
    next.delete(releaseId);
    return next;
  }

  function unauthorized() {
    generation += 1;
    listVersion += 1;
    loadingPromise = null;
    operationVersions.clear();
    localRevisions.clear();
    publish({
      status: "unauthorized",
      savedReleaseIds: new Set(),
      pendingReleaseIds: new Set(),
      errors: new Map(),
      listError: null,
    });
  }

  function isCurrentOperation(
    releaseId: string,
    operationVersion: number,
    operationGeneration: number,
  ) {
    return (
      generation === operationGeneration &&
      operationVersions.get(releaseId) === operationVersion &&
      state.pendingReleaseIds.has(releaseId)
    );
  }

  function mergeAuthoritative(
    authoritative: Set<string>,
    revisionsAtRequest: ReadonlyMap<string, number>,
    resolvingReleaseId?: string,
  ): ReadonlySet<string> {
    const merged = new Set(authoritative);
    for (const [releaseId, revision] of localRevisions) {
      if (releaseId === resolvingReleaseId) continue;
      if (
        revision !== revisionsAtRequest.get(releaseId) ||
        state.pendingReleaseIds.has(releaseId)
      ) {
        if (state.savedReleaseIds.has(releaseId)) merged.add(releaseId);
        else merged.delete(releaseId);
      }
    }
    return merged;
  }

  async function authoritativeIds(): Promise<{
    response: Response;
    releaseIds: Set<string> | null;
  }> {
    const response = await request("/api/saved-releases", {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return { response, releaseIds: null };
    const releaseIds = parsedReleaseIds(await response.json());
    return { response, releaseIds };
  }

  async function load(): Promise<void> {
    if (
      state.status === "disabled" ||
      state.status === "unauthorized" ||
      state.pendingReleaseIds.size > 0
    ) {
      return;
    }
    if (loadingPromise) return loadingPromise;

    const operationGeneration = generation;
    const operationListVersion = ++listVersion;
    const revisionsAtRequest = new Map(localRevisions);
    publish({ ...state, status: "loading", listError: null });

    loadingPromise = (async () => {
      try {
        const { response, releaseIds } = await authoritativeIds();
        if (
          generation !== operationGeneration ||
          listVersion !== operationListVersion
        ) {
          return;
        }
        if (response.status === 401) {
          unauthorized();
          return;
        }
        if (!response.ok || !releaseIds) {
          publish({ ...state, status: "error", listError: LIST_ERROR });
          return;
        }
        publish({
          ...state,
          status: "ready",
          savedReleaseIds: mergeAuthoritative(
            releaseIds,
            revisionsAtRequest,
          ),
          listError: null,
        });
      } catch {
        if (
          generation === operationGeneration &&
          listVersion === operationListVersion
        ) {
          publish({ ...state, status: "error", listError: LIST_ERROR });
        }
      } finally {
        if (
          generation === operationGeneration &&
          listVersion === operationListVersion
        ) {
          loadingPromise = null;
        }
      }
    })();
    return loadingPromise;
  }

  function settleMutation(
    releaseId: string,
    saved: boolean,
    error: string | null,
  ) {
    bumpLocalRevision(releaseId);
    const errors = new Map(withoutError(releaseId));
    if (error) errors.set(releaseId, error);
    publish({
      ...state,
      savedReleaseIds: replaceSaved(releaseId, saved),
      pendingReleaseIds: withoutPending(releaseId),
      errors,
    });
  }

  async function reconcile(
    releaseId: string,
    previousSaved: boolean,
    operationVersion: number,
    operationGeneration: number,
  ): Promise<boolean> {
    const revisionsAtRequest = new Map(localRevisions);
    try {
      const { response, releaseIds } = await authoritativeIds();
      if (
        !isCurrentOperation(
          releaseId,
          operationVersion,
          operationGeneration,
        )
      ) {
        return false;
      }
      if (response.status === 401) {
        unauthorized();
        return false;
      }
      if (!response.ok || !releaseIds) {
        settleMutation(releaseId, previousSaved, MUTATION_ERROR);
        return false;
      }

      bumpLocalRevision(releaseId);
      publish({
        ...state,
        savedReleaseIds: mergeAuthoritative(
          releaseIds,
          revisionsAtRequest,
          releaseId,
        ),
        pendingReleaseIds: withoutPending(releaseId),
        errors: withoutError(releaseId),
      });
      return true;
    } catch {
      if (
        isCurrentOperation(
          releaseId,
          operationVersion,
          operationGeneration,
        )
      ) {
        settleMutation(releaseId, previousSaved, MUTATION_ERROR);
      }
      return false;
    }
  }

  async function toggle(releaseId: string): Promise<boolean> {
    if (
      state.status !== "ready" ||
      state.pendingReleaseIds.has(releaseId)
    ) {
      return false;
    }

    const previousSaved = state.savedReleaseIds.has(releaseId);
    const nextSaved = !previousSaved;
    const operationGeneration = generation;
    const operationVersion =
      (operationVersions.get(releaseId) ?? 0) + 1;
    operationVersions.set(releaseId, operationVersion);
    bumpLocalRevision(releaseId);

    const pendingReleaseIds = new Set(state.pendingReleaseIds);
    pendingReleaseIds.add(releaseId);
    publish({
      ...state,
      savedReleaseIds: replaceSaved(releaseId, nextSaved),
      pendingReleaseIds,
      errors: withoutError(releaseId),
    });

    let response: Response;
    try {
      const mutation = savedReleaseRequest(releaseId, nextSaved);
      response = await request(mutation.url, mutation.init);
    } catch {
      return reconcile(
        releaseId,
        previousSaved,
        operationVersion,
        operationGeneration,
      );
    }

    if (
      !isCurrentOperation(
        releaseId,
        operationVersion,
        operationGeneration,
      )
    ) {
      return false;
    }
    if (response.status === 401) {
      unauthorized();
      return false;
    }
    if (response.ok) {
      settleMutation(releaseId, nextSaved, null);
      return true;
    }
    if (response.status >= 500) {
      return reconcile(
        releaseId,
        previousSaved,
        operationVersion,
        operationGeneration,
      );
    }

    settleMutation(releaseId, previousSaved, MUTATION_ERROR);
    return false;
  }

  function reset(nextAuthenticated: boolean) {
    generation += 1;
    listVersion += 1;
    loadingPromise = null;
    operationVersions.clear();
    localRevisions.clear();
    publish(initialState(nextAuthenticated));
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load,
    toggle,
    reset,
  };
}
