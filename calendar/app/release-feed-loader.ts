export type ReleaseCollectionState = {
  status: "current" | "stale" | "failed";
  message: string | null;
  pendingSources?: number;
};

export type ReleaseFeedPayload<TRelease, TSourceHealth> = {
  releases: TRelease[];
  sources?: TSourceHealth;
  collection: ReleaseCollectionState;
};

type LoaderOptions<TRelease, TSourceHealth> = {
  month?: string;
  request: (url: string, init?: RequestInit) => Promise<Response>;
  onResponse: (payload: ReleaseFeedPayload<TRelease, TSourceHealth>) => void;
  onError: (error: unknown) => void;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
  schedule?: (callback: () => void, delay: number) => unknown;
  cancel?: (handle: unknown) => void;
};

export function releaseFeedCountLabel(count: number, confirmed: boolean, pad = false): string {
  if (count === 0 && !confirmed) return "—";
  return pad ? String(count).padStart(2, "0") : String(count);
}

function parsePayload<TRelease, TSourceHealth>(value: unknown): ReleaseFeedPayload<TRelease, TSourceHealth> {
  if (!value || typeof value !== "object" || !Array.isArray((value as { releases?: unknown }).releases)) {
    throw new Error("Invalid release response");
  }
  const data = value as { releases: TRelease[]; sources?: TSourceHealth; collection?: unknown };
  let collection: ReleaseCollectionState = { status: "current", message: null };
  if (data.collection !== undefined) {
    if (!data.collection || typeof data.collection !== "object") throw new Error("Invalid collection status");
    const state = data.collection as { status?: unknown; message?: unknown; pendingSources?: unknown };
    if (state.status !== "current" && state.status !== "stale" && state.status !== "failed") {
      throw new Error("Invalid collection status");
    }
    collection = {
      status: state.status,
      message: typeof state.message === "string" ? state.message : null,
      ...(Number.isInteger(state.pendingSources) && (state.pendingSources as number) >= 0 ? { pendingSources: state.pendingSources as number } : {}),
    };
  }
  return { releases: data.releases, ...(data.sources && typeof data.sources === "object" ? { sources: data.sources } : {}), collection };
}

/** A pending collection keeps polling; successful cached responses never get replaced by a failure. */
export function createReleaseFeedLoader<TRelease = unknown, TSourceHealth = unknown>(options: LoaderOptions<TRelease, TSourceHealth>) {
  // Native browser fetch must not receive our options object as its receiver.
  const request = options.request;
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let started = false;
  let stopped = false;
  let pollTimer: unknown;
  let requestTimer: unknown;
  let requestController: AbortController | null = null;
  let cancelRequest: (() => void) | null = null;
  let lastCollection: ReleaseCollectionState | null = null;
  let consecutiveFailures = 0;

  async function load() {
    if (stopped) return;
    requestController = new AbortController();
    const signal = requestController.signal;
    const deadline = new Promise<never>((_resolve, reject) => {
      cancelRequest = () => reject(new Error("Release request cancelled"));
      requestTimer = schedule(() => {
        const error = new Error("Release request timed out");
        error.name = "TimeoutError";
        reject(error);
        requestController?.abort();
      }, options.requestTimeoutMs ?? 15_000);
    });
    try {
      const response = await Promise.race([
        (async () => {
          const url = options.month && /^\d{4}-\d{2}$/.test(options.month) ? `/api/releases?month=${options.month}` : "/api/releases";
          const result = await request(url, { signal, cache: "no-store" });
          if (!result.ok && result.status !== 503) throw new Error("Release request failed");
          const payload = parsePayload<TRelease, TSourceHealth>(await result.json());
          if (!result.ok && !(payload.collection.status === "failed" && payload.collection.pendingSources === 0)) {
            throw new Error("Release request failed");
          }
          return payload;
        })(),
        deadline,
      ]);
      if (stopped) return;
      lastCollection = response.collection;
      consecutiveFailures = 0;
      options.onResponse(response);
    } catch (error) {
      if (!stopped) { consecutiveFailures++; options.onError(error); }
    } finally {
      if (requestTimer !== undefined) cancel(requestTimer);
      requestTimer = undefined;
      requestController = null;
      cancelRequest = null;
    }
    const needsPolling = !lastCollection || lastCollection.status === "stale" || (lastCollection.status === "failed" && (lastCollection.pendingSources ?? 0) > 0);
    if (!stopped && needsPolling) {
      const baseDelay = options.pollIntervalMs ?? 4_000;
      const delay = Math.min(baseDelay * 2 ** Math.max(0, Math.min(consecutiveFailures - 1, 3)), 30_000);
      pollTimer = schedule(() => { pollTimer = undefined; void load(); }, delay);
    }
  }

  return {
    start() { if (!started && !stopped) { started = true; void load(); } },
    stop() {
      stopped = true;
      if (pollTimer !== undefined) cancel(pollTimer);
      if (requestTimer !== undefined) cancel(requestTimer);
      requestController?.abort();
      cancelRequest?.();
    },
  };
}
