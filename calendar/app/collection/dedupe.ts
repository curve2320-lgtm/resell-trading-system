import {
  canonicalReleaseKey,
  normalizeReleaseText,
  normalizeStyleCode,
} from "./normalize.ts";
import type { CollectedRelease, ReviewReason } from "./types.ts";
import { sourceTierRank } from "./source-tier.ts";
import { expandedSourceRegion } from "../expanded-sources.ts";

export type ReleaseGroup = {
  canonicalKey: string;
  release: CollectedRelease;
  channels: CollectedRelease[];
  reviewReason: ReviewReason | null;
};

export type StoredRelease = {
  releaseDate: string;
  releaseTime: string | null;
  priceLabel: string | null;
  productUrl: string;
};

type ChangedField = {
  field: "releaseDate" | "releaseTime" | "priceLabel" | "productUrl";
  previousValue: string | null;
  nextValue: string | null;
};

function normalizedStyleCode(styleCode: string | null): string {
  return normalizeStyleCode(styleCode ?? "");
}

function stableReleaseKey(release: CollectedRelease): string {
  return JSON.stringify([
    release.sourceKey,
    release.externalId,
    release.title,
    release.brand,
    release.category,
    release.releaseKind,
    release.releaseDate,
    release.releaseTime,
    release.priceLabel,
    release.styleCode,
    release.retailer,
    release.productUrl,
    release.sourceUrl,
    release.collectedAt,
  ]);
}

function compareReleases(left: CollectedRelease, right: CollectedRelease): number {
  const leftKey = stableReleaseKey(left);
  const rightKey = stableReleaseKey(right);
  return leftKey === rightKey ? 0 : leftKey < rightKey ? -1 : 1;
}

function hasDegenerateIdentity(release: CollectedRelease): boolean {
  return !normalizedStyleCode(release.styleCode) && !normalizeReleaseText(release.title);
}

function groupingKey(release: CollectedRelease): string {
  if (hasDegenerateIdentity(release)) {
    return `degenerate:${stableReleaseKey(release)}`;
  }

  const canonicalKey = canonicalReleaseKey(release);
  return normalizedStyleCode(release.styleCode)
    ? `${canonicalKey}:${release.releaseDate.trim()}`
    : canonicalKey;
}

function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .normalize("NFKC")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  );
}

function officialPokemonProductId(release: CollectedRelease): string | null {
  if (release.sourceKey !== "pokemonCard") return null;
  const id = release.externalId.match(/^pokemon:(\d+)$/)?.[1];
  if (!id) return null;
  for (const value of [release.sourceUrl, release.productUrl]) {
    try {
      const url = new URL(value ?? "");
      if (url.protocol !== "https:" || url.host !== "pokemoncard.co.kr" ||
          url.username || url.password || url.pathname !== `/card/${id}`) return null;
    } catch { return null; }
  }
  return id;
}

function hasSimilarTitle(left: CollectedRelease, right: CollectedRelease): boolean {
  const leftProductId = officialPokemonProductId(left);
  const rightProductId = officialPokemonProductId(right);
  // The official catalog identifies separate variants even when their titles share most words.
  if (leftProductId && rightProductId && leftProductId !== rightProductId) return false;
  if (
    normalizedStyleCode(left.styleCode) ||
    normalizedStyleCode(right.styleCode) ||
    normalizeReleaseText(left.region || expandedSourceRegion(left.sourceKey) || "한국") !== normalizeReleaseText(right.region || expandedSourceRegion(right.sourceKey) || "한국") ||
    left.releaseDate.trim() !== right.releaseDate.trim() ||
    normalizeReleaseText(left.brand ?? "") !== normalizeReleaseText(right.brand ?? "")
  ) {
    return false;
  }

  const leftTokens = titleTokens(left.title);
  const rightTokens = titleTokens(right.title);
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const total = new Set([...leftTokens, ...rightTokens]).size;

  return total > 0 && shared / total >= 0.6;
}

function scheduleIdentityKey(release: CollectedRelease): string | null {
  return hasDegenerateIdentity(release) ? null : canonicalReleaseKey(release);
}

function scheduleStage(release: CollectedRelease): "online" | "raffle" | "offline" {
  if (release.releaseKind === "raffle") return "raffle";
  if (release.releaseKind === "offline") return "offline";
  return "online";
}

export function releasesHaveConflictingSchedule(
  left: CollectedRelease,
  right: CollectedRelease,
): boolean {
  if (
    left.sourceKey === right.sourceKey ||
    scheduleStage(left) !== scheduleStage(right)
  ) {
    return false;
  }

  const leftIdentity = scheduleIdentityKey(left);
  const rightIdentity = scheduleIdentityKey(right);
  if (!leftIdentity || leftIdentity !== rightIdentity) return false;

  const leftDate = left.releaseDate.trim();
  const rightDate = right.releaseDate.trim();
  if (leftDate !== rightDate) return true;

  const leftTime = left.releaseTime?.trim();
  const rightTime = right.releaseTime?.trim();
  return Boolean(leftTime && rightTime && leftTime !== rightTime);
}

function releaseIdentity(release: CollectedRelease): string {
  return JSON.stringify([release.sourceKey, release.externalId]);
}

function conflictingReleaseIdentities(
  releases: CollectedRelease[],
): ReadonlySet<string> {
  const conflicts = new Set<string>();
  for (let left = 0; left < releases.length; left += 1) {
    for (let right = left + 1; right < releases.length; right += 1) {
      if (!releasesHaveConflictingSchedule(releases[left], releases[right])) {
        continue;
      }
      const leftRank = sourceTierRank(releases[left].sourceKey);
      const rightRank = sourceTierRank(releases[right].sourceKey);
      if (leftRank === rightRank) {
        conflicts.add(releaseIdentity(releases[left]));
        conflicts.add(releaseIdentity(releases[right]));
      } else if (leftRank < rightRank) {
        conflicts.add(releaseIdentity(releases[left]));
      } else {
        conflicts.add(releaseIdentity(releases[right]));
      }
    }
  }
  return conflicts;
}

export function groupCollectedReleases(releases: CollectedRelease[]): ReleaseGroup[] {
  const grouped = new Map<string, CollectedRelease[]>();
  const conflictingIdentities = conflictingReleaseIdentities(releases);

  for (const release of releases) {
    const key = groupingKey(release);
    const channels = grouped.get(key) ?? [];
    channels.push(release);
    grouped.set(key, channels);
  }

  const groups = [...grouped.entries()].flatMap<ReleaseGroup & {matchingKey:string}>(([key, channels]) => {
    const sortedChannels = [...channels].sort(compareReleases);
    const degenerate = hasDegenerateIdentity(sortedChannels[0]);
    if (degenerate) {
      return [{
        canonicalKey: key,
        release: sortedChannels[0],
        channels: sortedChannels,
        reviewReason: "possible_duplicate" as const,
        matchingKey: key,
      }];
    }

    const accepted = sortedChannels.filter(
      (release) => !conflictingIdentities.has(releaseIdentity(release)),
    );
    const conflictingByIdentity = new Map<string, CollectedRelease[]>();
    for (const release of sortedChannels) {
      const identity = releaseIdentity(release);
      if (!conflictingIdentities.has(identity)) continue;
      const matching = conflictingByIdentity.get(identity) ?? [];
      matching.push(release);
      conflictingByIdentity.set(identity, matching);
    }

    return [
      ...(accepted.length === 0
        ? []
        : [{
            canonicalKey: canonicalReleaseKey(accepted[0]),
            release: accepted[0],
            channels: accepted,
            reviewReason: null,
            matchingKey: `${key}:accepted`,
          }]),
      ...[...conflictingByIdentity.entries()].map(
        ([identity, matchingChannels]) => ({
          canonicalKey: canonicalReleaseKey(matchingChannels[0]),
          release: matchingChannels[0],
          channels: matchingChannels,
          reviewReason: "conflicting_schedule" as const,
          matchingKey: `${key}:conflict:${identity}`,
        }),
      ),
    ];
  });

  for (let index = 0; index < groups.length; index += 1) {
    for (let candidate = index + 1; candidate < groups.length; candidate += 1) {
      if (hasSimilarTitle(groups[index].release, groups[candidate].release)) {
        if (groups[index].reviewReason === null) {
          groups[index].reviewReason = "possible_duplicate";
        }
        if (groups[candidate].reviewReason === null) {
          groups[candidate].reviewReason = "possible_duplicate";
        }
      }
    }
  }

  return groups
    .sort((left, right) => {
      const dateComparison = left.release.releaseDate.localeCompare(right.release.releaseDate);
      return (
        dateComparison ||
        left.release.title.localeCompare(right.release.title) ||
        left.matchingKey.localeCompare(right.matchingKey)
      );
    })
    .map(({ matchingKey: _matchingKey, ...group }) => group);
}

export function changedFields(
  previous: StoredRelease,
  next: CollectedRelease,
): ChangedField[] {
  const fields: ChangedField["field"][] = [
    "releaseDate",
    "releaseTime",
    "priceLabel",
    "productUrl",
  ];

  return fields.flatMap((field) =>
    previous[field] === next[field]
      ? []
      : [{ field, previousValue: previous[field], nextValue: next[field] }],
  );
}
