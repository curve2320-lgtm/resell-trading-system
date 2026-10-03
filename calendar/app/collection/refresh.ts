import type { CollectionRepository } from "./repository.ts";
import type { ReleaseSourceAdapter } from "./registry.ts";
import {
  runScheduledSourceCollection,
  sourceRefreshSlotKey,
  SOURCE_REFRESH_CLAIM_TTL_MS,
} from "./run.ts";

const REFRESH_BATCH_SIZE = 4;
const SOURCE_PRIORITY = ["nike", "lego", "atmosJP", "shoeprize", "sibna", "instagramPublic"];

export type ReleaseRefreshContext = {
  status: "current" | "stale" | "failed";
  message: string | null;
  pendingSources: number;
};

export type ReleaseRefreshInput = {
  repository: CollectionRepository;
  adapters: readonly ReleaseSourceAdapter[];
  now: Date;
  waitUntil(job: Promise<unknown>): void;
  adapterDeadlineMs?: number;
  randomUUID?: () => string;
};

/** Register a bounded batch before returning the cached API response. */
export async function startReleaseRefreshBatch(
  input: ReleaseRefreshInput,
): Promise<ReleaseRefreshContext> {
  if (!input.repository.listCollectionSlots) {
    throw new Error("Release refresh state is temporarily unavailable.");
  }
  const priority = (key: string) => {
    const index = SOURCE_PRIORITY.indexOf(key);
    return index === -1 ? SOURCE_PRIORITY.length : index;
  };
  const adapters = [...new Map(input.adapters.map((adapter) => [adapter.collectionKey ?? adapter.key, adapter])).values()]
    .sort((left,right) => priority(left.key) - priority(right.key));
  const slots = await input.repository.listCollectionSlots(
    adapters.map((adapter) => sourceRefreshSlotKey(adapter.key,input.now,adapter)),
  );
  const slotsByKey = new Map(slots.map((slot) => [slot.slotKey,slot]));
  const slotFor = (adapter: ReleaseSourceAdapter) =>
    slotsByKey.get(sourceRefreshSlotKey(adapter.key,input.now,adapter));
  const retryable = (adapter: ReleaseSourceAdapter) => {
    const slot=slotFor(adapter);
    return adapter.refreshInterval === "weekly" && slot?.status === "failed" && Date.parse(slot.startedAt) <= input.now.getTime()-5*60_000;
  };
  const pendingSources = adapters.filter((adapter) => {
    const slot = slotFor(adapter);
    return !slot || slot.status === "running" || retryable(adapter);
  }).length;
  const failedSources = adapters.filter((adapter) => slotFor(adapter)?.status === "failed").length;
  const allFailed = adapters.length > 0 && failedSources === adapters.length;
  const staleBefore = input.now.getTime() - SOURCE_REFRESH_CLAIM_TTL_MS;
  const activeSources = new Set(adapters.filter((adapter) => {
    const slot = slotFor(adapter);
    return slot?.status === "running" && Date.parse(slot.startedAt) > staleBefore;
  }).map(({key})=>key));
  const selectedSources = new Set<string>();
  const due = adapters.filter((adapter) => {
    if (activeSources.has(adapter.key) || selectedSources.has(adapter.key)) return false;
    const slot = slotFor(adapter);
    const missing = !slot || retryable(adapter) || (slot.status === "running" && Date.parse(slot.startedAt) <= staleBefore);
    if (missing) selectedSources.add(adapter.key);
    return missing;
  }).slice(0,REFRESH_BATCH_SIZE);

  if (due.length > 0) {
    const jobs = due.map((adapter) => runScheduledSourceCollection({
      repository:input.repository,
      adapter,
      now:input.now,
      randomUUID:input.randomUUID,
      adapterDeadlineMs:input.adapterDeadlineMs,
    }));
    input.waitUntil(Promise.allSettled(jobs));
  }
  return {
    status: pendingSources > 0 ? "stale" : failedSources > 0 ? "failed" : "current",
    message: pendingSources > 0
      ? "Official release sources are refreshing."
      : allFailed ? "Release collection is temporarily unavailable."
      : failedSources > 0 ? "Some official release sources are temporarily unavailable." : null,
    pendingSources,
  };
}
