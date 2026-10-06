/** Removed reference aggregators cannot publish again through old cache or jobs. */
export function isRetiredReleaseSource(sourceKey: string): boolean {
  return typeof sourceKey === "string" && sourceKey.trim().toLowerCase() === "sibna";
}

export function isRetiredReleaseChannel(channel: {
  sourceKey: string;
  sourceUrl?: string | null;
  productUrl?: string | null;
}): boolean {
  if (isRetiredReleaseSource(channel.sourceKey)) return true;
  return [channel.sourceUrl, channel.productUrl].some((value) => {
    if (!value) return false;
    try {
      const host = new URL(value).hostname.toLowerCase().replace(/\.$/, "");
      return host === "sibna.kr" || host.endsWith(".sibna.kr");
    } catch { return false; }
  });
}
