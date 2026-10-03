import { expandedSourceDomains } from "./expanded-sources.ts";

export const approvedRetailerHostnames = [
  "shoeprize.com",
  "nike.com",
  "adidas.co.kr",
  "adidas.com",
  "a-rt.com",
  "nbkorea.com",
  "musinsa.com",
  "soldout.co.kr",
  "worksout.co.kr",
  "kasina.co.kr",
  "kream.co.kr",
  "converse.co.kr",
  "fila.co.kr",
  "thenorthfacekorea.co.kr",
  "palaceskateboards.seoul.kr",
  "salomon.co.kr",
  "asics.co.kr",
  "tune.kr",
  ...expandedSourceDomains,
] as const;

export function safeRetailerUrl(
  value: string | null | undefined,
): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port
    ) {
      return null;
    }
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    const approved = approvedRetailerHostnames.some(
      (allowed) =>
        hostname === allowed || hostname.endsWith(`.${allowed}`),
    );
    if (!approved) return null;
    return value.trim();
  } catch {
    return null;
  }
}

export function releaseDestination(release: {
  productUrl?: string | null;
  sourceUrl?: string | null;
}): string | null {
  return (
    safeRetailerUrl(release.productUrl) ??
    safeRetailerUrl(release.sourceUrl)
  );
}
