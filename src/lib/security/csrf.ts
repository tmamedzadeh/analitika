const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export function isUnsafeMethod(method: string): boolean {
  return !safeMethods.has(method.toUpperCase());
}

export function isSignedInngestPath(pathname: string): boolean {
  return pathname === "/api/inngest" || pathname.startsWith("/api/inngest/");
}

export function hasOriginMetadata(request: Request): boolean {
  return ["origin", "sec-fetch-site", "referer"].some((header) => request.headers.has(header));
}

export function shouldRejectMissingOrigin(request: Request, hasValidSession: boolean): boolean {
  return (
    isUnsafeMethod(request.method) &&
    !isSignedInngestPath(new URL(request.url).pathname) &&
    !hasOriginMetadata(request) &&
    !hasValidSession
  );
}
