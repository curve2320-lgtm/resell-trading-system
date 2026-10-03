import type { CollectedRelease } from "./types.ts";
import { expandedSourceRegion } from "../expanded-sources.ts";

export function normalizeReleaseText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeStyleCode(styleCode: string): string {
  return styleCode
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function canonicalReleaseKey(release: CollectedRelease): string {
  const styleCode = release.styleCode && normalizeStyleCode(release.styleCode);
  const region = release.region || expandedSourceRegion(release.sourceKey);
  const market = region && region !== "한국" ? `:market:${normalizeReleaseText(region)}` : "";

  if (styleCode) {
    return `style:${styleCode}${market}`;
  }

  return [
    "release",
    normalizeReleaseText(release.brand ?? ""),
    normalizeReleaseText(release.title),
    release.releaseDate.trim(),
  ].join(":") + market;
}
