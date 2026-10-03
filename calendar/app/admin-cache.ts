export function withAdminPageNoStore(
  request: Request,
  response: Response,
): Response {
  const pathname = new URL(request.url).pathname;
  const isAdminPage =
    pathname === "/admin" || pathname.startsWith("/admin/");
  const isAdminApi =
    pathname === "/api/admin" || pathname.startsWith("/api/admin/");
  if (!isAdminPage && !isAdminApi) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
