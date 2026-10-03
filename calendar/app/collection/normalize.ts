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

function declaredSellerScope(release: CollectedRelease): string {
  if (!["shoeprize", "tune"].includes(release.sourceKey) || !release.productUrl) return "";
  try {
    const url = new URL(release.productUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if ((host === "tune.kr" || host === "www.tune.kr") && /^\/products\/[^/]+\/?$/.test(url.pathname)) {
      return ":seller:tune.kr";
    }
    if (release.sourceKey === "shoeprize" && (host === "hoopcity.co.kr" || host === "www.hoopcity.co.kr") && /^\/product-detail\/\d+\/?$/.test(url.pathname)) {
      return ":seller:hoopcity.co.kr";
    }
  } catch { /* Unverified purchase URLs retain the existing product identity. */ }
  return "";
}

export function canonicalReleaseKey(release: CollectedRelease): string {
  const styleCode = release.styleCode && normalizeStyleCode(release.styleCode);
  const region = release.region || expandedSourceRegion(release.sourceKey);
  const seller = declaredSellerScope(release);
  // These declared Korean sellers arrive as 한국 from SHOEPRIZE and 대한민국 from TUNE.
  // Keep the source's public country label while matching the same seller identity.
  const domesticSeller = Boolean(seller) && (region === "한국" || region === "대한민국");
  const market = region && region !== "한국" && !domesticSeller ? `:market:${normalizeReleaseText(region)}` : "";

  if (styleCode) {
    return `style:${styleCode}${market}${seller}`;
  }

  return [
    "release",
    normalizeReleaseText(release.brand ?? ""),
    normalizeReleaseText(release.title),
    release.releaseDate.trim(),
  ].join(":") + market + seller;
}
