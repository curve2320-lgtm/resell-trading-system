export function requestHasAllowedOrigin(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  if (fetchSite !== null) {
    return (
      fetchSite === "same-origin" &&
      origin !== null &&
      isExactHttpsOrigin(origin)
    );
  }
  if (!origin) return false;

  try {
    return (
      new URL(origin).origin === origin &&
      new URL(request.url).origin === origin
    );
  } catch {
    return false;
  }
}

function isExactHttpsOrigin(value: string): boolean {
  try {
    const origin = new URL(value);
    return origin.protocol === "https:" && origin.origin === value;
  } catch {
    return false;
  }
}
