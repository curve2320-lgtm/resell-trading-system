export type SourceTier = "first_party" | "aggregator" | "announcement";
import { expandedSourceCatalog } from "../expanded-sources.ts";
import {isRetiredReleaseSource} from "./source-policy.ts";

const AGGREGATOR_SOURCES = new Set([
  "shoeprize",
  "grandstage",
  "musinsa",
  "soldout",
  "worksout",
  "kasina",
  "kream",
  "tune",
]);

export function sourceTier(sourceKey: string): SourceTier {
  if (sourceKey === "sns" || sourceKey === "instagramPublic") return "announcement";
  if (expandedSourceCatalog.some((source) => source.key === sourceKey && source.parser === "atom")) return "announcement";
  if (AGGREGATOR_SOURCES.has(sourceKey)) return "aggregator";
  return "first_party";
}

export function sourceTierRank(sourceKey: string): number {
  if (isRetiredReleaseSource(sourceKey)) return 0;
  return { announcement: 1, aggregator: 2, first_party: 3 }[
    sourceTier(sourceKey)
  ];
}

export function isAnnouncementSource(sourceKey: string): boolean {
  return sourceTier(sourceKey) === "announcement";
}

