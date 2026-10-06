import {
  createExistingAdapter,
  existingReleaseSourceAdapters,
} from "./existing-adapters.ts";
import { fetchAsicsReleases } from "../asics.ts";
import { fetchSalomonReleases } from "../salomon.ts";
import { fetchTuneReleases } from "../tune.ts";
import { expandedReleaseSourceAdapters } from "./expanded-adapters.ts";
import { instagramReleaseAdapter } from "./instagram-adapter.ts";
import { instagramPublicReleaseAdapter } from "./instagram-widget-adapter.ts";
import {officialProductAdapters} from "./official-product-adapters.ts";
import {
  sourceEnabled,
  type ReleaseSourceKey,
} from "../source-flags.ts";
import type { AdapterReleaseInput } from "./types.ts";

export interface ReleaseSourceAdapter {
  key: string;
  /** Durable work identity. Published channels always retain key. */
  collectionKey?: string;
  refreshInterval?: "weekly";
  retailer: string;
  allowedDomains: string[];
  collect(now: Date): Promise<SourceCollectionResult>;
}

export type SourceCollectionResult = {
  sourceKey: string;
  status: "connected" | "error" | "manual";
  releases: AdapterReleaseInput[];
  message: string;
  confirmedEmpty: boolean;
  authoritativeSnapshot?: boolean;
};

const newReleaseSourceAdapters: ReleaseSourceAdapter[] = [
  createExistingAdapter({
    key: "salomon",
    retailer: "Salomon Korea",
    allowedDomains: ["salomon.co.kr"],
    fetcher: fetchSalomonReleases,
  }),
  createExistingAdapter({
    key: "asics",
    retailer: "ASICS Korea",
    allowedDomains: ["asics.co.kr"],
    fetcher: fetchAsicsReleases,
  }),
  createExistingAdapter({
    key: "tune",
    retailer: "TUNE",
    allowedDomains: ["tune.kr"],
    fetcher: fetchTuneReleases,
  }),
];

export function enabledReleaseSourceAdapters(): ReleaseSourceAdapter[] {
  return [...existingReleaseSourceAdapters, ...newReleaseSourceAdapters,
    ...expandedReleaseSourceAdapters.filter(adapter=>!officialProductAdapters.some(item=>item.key===adapter.key)),
    ...officialProductAdapters,
    instagramReleaseAdapter, instagramPublicReleaseAdapter].filter(
    (adapter) => sourceEnabled(adapter.key as ReleaseSourceKey),
  );
}

export const releaseSourceAdapters = enabledReleaseSourceAdapters();

export function configuredReleaseSourceKeys(): string[] {
  return enabledReleaseSourceAdapters().map(({ key }) => key);
}

/** All production schedules come from enabled source adapters. */
export function scheduledReleaseSourceAdapters(_now: Date, _requestedMonth?: string): ReleaseSourceAdapter[] {
  return enabledReleaseSourceAdapters();
}

export function findReleaseSourceAdapter(
  sourceKey: string,
  adapters: ReleaseSourceAdapter[] = enabledReleaseSourceAdapters(),
): ReleaseSourceAdapter | null {
  return adapters.find(({ key }) => key === sourceKey) ?? null;
}
