export const MAX_JSON_BODY_BYTES = 32 * 1024;
export const MAX_RESUME_REQUEST_BYTES = 10 * 1024 * 1024 + 64 * 1024;

export function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    const expectedOrigin = process.env.APP_ORIGIN
      ? new URL(process.env.APP_ORIGIN).origin
      : new URL(request.url).origin;
    return new URL(origin).origin === expectedOrigin;
  } catch {
    return false;
  }
}

export function hasJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  return /^application\/json(?:\s*;|$)/i.test(contentType);
}

export function hasMultipartFormDataContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  return /^multipart\/form-data\s*;/i.test(contentType);
}

export function contentLengthExceeds(request: Request, maxBytes: number): boolean {
  const value = request.headers.get("content-length");
  if (value === null) return false;
  if (!/^\d+$/.test(value)) return true;
  return Number(value) > maxBytes;
}
