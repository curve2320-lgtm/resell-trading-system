const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"]);

export function canonicalizeInstagramPostUrl(value: string): string | null {
  if (!value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !INSTAGRAM_HOSTS.has(url.hostname.toLowerCase())
    ) {
      return null;
    }
    const match = url.pathname.match(/^\/(p|reel)\/([A-Za-z0-9._-]+)\/?$/);
    if (!match) return null;
    return `https://www.instagram.com/${match[1]}/${match[2]}/`;
  } catch {
    return null;
  }
}

export function safeAnnouncementUrl(
  value: string | null | undefined,
): string | null {
  return value ? canonicalizeInstagramPostUrl(value) : null;
}

export function isInstagramSource(sourceKey: string | undefined): boolean {
  return sourceKey === "sns" || sourceKey === "instagramPublic";
}
