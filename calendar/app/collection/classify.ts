import type {
  AdapterReleaseInput,
  Classification,
  ReleaseKind,
} from "./types.ts";

const KOREAN_COLLABORATION_MARKER = /협업/iu;
const ENGLISH_COLLABORATION_SEPARATOR = /(?<![\p{L}\p{N}])[\p{L}][\p{L}\d.'&-]*\s+x\s+[\p{L}][\p{L}\d.'&-]*(?![\p{L}\p{N}])/iu;
const MODEL_OR_SIZE_SEPARATOR = /\b(?:model|size)\s+x\b/iu;
const RAFFLE_MARKER = /(?:raffle|래플|추첨)/iu;

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

function canonicalAllowedHostname(domain: string): string | null {
  try {
    const declaration = domain.includes("://") ? domain : `https://${domain}`;
    return normalizeHostname(new URL(declaration).hostname) || null;
  } catch {
    return null;
  }
}

function matchesAllowedDomain(urlValue: string | null, allowedDomains: string[]): boolean {
  if (!urlValue) return false;
  try {
    const url = new URL(urlValue);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }

    const hostname = normalizeHostname(url.hostname);
    return allowedDomains.some((domain) => {
      const allowedHostname = canonicalAllowedHostname(domain);
      return Boolean(
        allowedHostname &&
          (hostname === allowedHostname || hostname.endsWith(`.${allowedHostname}`)),
      );
    });
  } catch {
    return false;
  }
}

function releaseKindFor(input: AdapterReleaseInput): ReleaseKind {
  if (input.releaseKindHint) {
    return input.releaseKindHint;
  }

  if (RAFFLE_MARKER.test(input.title)) {
    return "raffle";
  }

  if (
    KOREAN_COLLABORATION_MARKER.test(input.title) ||
    (ENGLISH_COLLABORATION_SEPARATOR.test(input.title) &&
      !MODEL_OR_SIZE_SEPARATOR.test(input.title))
  ) {
    return "collab";
  }

  return "general";
}

export function classifyRelease(input: AdapterReleaseInput): Classification {
  if (!input.releaseDate.trim()) {
    return { release: null, reviewReason: "missing_date" };
  }

  if (!matchesAllowedDomain(input.productUrl, input.allowedDomains)) {
    return { release: null, reviewReason: "invalid_source_url" };
  }

  const { allowedDomains: _allowedDomains, categoryHint, releaseKindHint, ...release } = input;
  return {
    release: {
      ...release,
      category: categoryHint ?? "sneakers",
      releaseKind: releaseKindFor(input),
    },
    reviewReason: null,
  };
}
