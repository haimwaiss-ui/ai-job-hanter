export const MAX_JSON_BODY_BYTES = 32 * 1024;
export const MAX_RESUME_REQUEST_BYTES = 10 * 1024 * 1024 + 64 * 1024;

export type LimitedBodyRead =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "too_large" | "unreadable" };

export type LimitedTextRead =
  | { ok: true; text: string }
  | { ok: false; reason: "too_large" | "unreadable" | "invalid_utf8" };

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

/**
 * Reads a request body while enforcing the limit against actual streamed bytes.
 * Content-Length is only an early-rejection hint; it is never trusted as the
 * sole size control because it may be absent or inaccurate.
 */
export async function readRequestBodyLimited(
  request: Request,
  maxBytes: number,
): Promise<LimitedBodyRead> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("maxBytes must be a non-negative safe integer");
  }
  if (contentLengthExceeds(request, maxBytes)) {
    return { ok: false, reason: "too_large" };
  }

  if (!request.body) {
    return { ok: true, bytes: new Uint8Array(0) };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > maxBytes - totalBytes) {
        try {
          await reader.cancel("Request body limit exceeded");
        } catch {
          // The body is already being rejected; cancellation is best-effort.
        }
        return { ok: false, reason: "too_large" };
      }
      totalBytes += value.byteLength;
      chunks.push(value);
    }
  } catch {
    try {
      await reader.cancel("Request body could not be read");
    } catch {
      // Preserve the stable unreadable result.
    }
    return { ok: false, reason: "unreadable" };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A failed stream may already have released its reader.
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

export async function readRequestTextLimited(
  request: Request,
  maxBytes: number,
): Promise<LimitedTextRead> {
  const result = await readRequestBodyLimited(request, maxBytes);
  if (!result.ok) return result;

  try {
    return {
      ok: true,
      text: new TextDecoder("utf-8", { fatal: true }).decode(result.bytes),
    };
  } catch {
    return { ok: false, reason: "invalid_utf8" };
  }
}
