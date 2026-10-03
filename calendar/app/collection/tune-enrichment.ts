import { normalizeStyleCode } from "./normalize.ts";
import type {
  ReleaseSourceAdapter,
  SourceCollectionResult,
} from "./registry.ts";

type ConfirmedSchedule = {
  releaseDate: string;
  releaseTime: string | null;
};

function confirmedSchedules(
  adapters: readonly ReleaseSourceAdapter[],
  settled: readonly PromiseSettledResult<SourceCollectionResult>[],
) {
  const candidates = new Map<
    string,
    Map<string, Set<string | null>>
  >();

  settled.forEach((result, index) => {
    if (
      result.status !== "fulfilled" ||
      result.value.status !== "connected" ||
      adapters[index]?.key === "tune"
    ) {
      return;
    }

    for (const release of result.value.releases) {
      try {
        const styleCode = normalizeStyleCode(release.styleCode ?? "");
        const releaseDate = release.releaseDate.trim();
        if (!styleCode || !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) continue;

        const dates = candidates.get(styleCode) ?? new Map();
        const times = dates.get(releaseDate) ?? new Set();
        times.add(release.releaseTime);
        dates.set(releaseDate, times);
        candidates.set(styleCode, dates);
      } catch {
        // Existing preparation converts malformed source rows to source errors.
      }
    }
  });

  const confirmed = new Map<string, ConfirmedSchedule>();
  for (const [styleCode, dates] of candidates) {
    if (dates.size !== 1) continue;
    const [[releaseDate, times]] = dates;
    confirmed.set(styleCode, {
      releaseDate,
      releaseTime: times.size === 1 ? [...times][0] : null,
    });
  }
  return confirmed;
}

export function enrichUndatedTuneResults(
  adapters: readonly ReleaseSourceAdapter[],
  settled: readonly PromiseSettledResult<SourceCollectionResult>[],
): PromiseSettledResult<SourceCollectionResult>[] {
  const schedules = confirmedSchedules(adapters, settled);

  return settled.map((result, index) => {
    if (
      result.status !== "fulfilled" ||
      result.value.status !== "connected" ||
      adapters[index]?.key !== "tune"
    ) {
      return result;
    }

    let releases: SourceCollectionResult["releases"];
    try {
      const existingChannels = new Set(
        result.value.releases
          .filter(({ releaseDate }) => releaseDate.trim())
          .map(({ styleCode, releaseDate }) => {
            const normalized = normalizeStyleCode(styleCode ?? "");
            return normalized ? `${normalized}:${releaseDate.trim()}` : "";
          })
          .filter(Boolean),
      );
      releases = result.value.releases.flatMap((release) => {
        if (release.releaseDate.trim()) return [release];
        const styleCode = normalizeStyleCode(release.styleCode ?? "");
        const schedule = styleCode ? schedules.get(styleCode) : undefined;
        if (!schedule) return [release];

        const channelKey = `${styleCode}:${schedule.releaseDate}`;
        if (existingChannels.has(channelKey)) return [];
        existingChannels.add(channelKey);
        return [
          {
            ...release,
            releaseDate: schedule.releaseDate,
            releaseTime: schedule.releaseTime,
          },
        ];
      });
    } catch {
      return result;
    }

    return {
      status: "fulfilled",
      value: {
        ...result.value,
        releases,
      },
    };
  });
}
