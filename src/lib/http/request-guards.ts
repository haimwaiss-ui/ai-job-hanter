export const MAX_JSON_BODY_BYTES = 32 * 1024;
export const MAX_RESUME_REQUEST_BYTES = 10 * 1024 * 1024 + 64 * 1024;

export type LimitedJsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "too_large" | "invalid_json" };

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
 * Enforce a byte limit while reading the stream. Content-Length alone is not
 * sufficient because chunked requests may omit that header.
 */
export async function readJsonBodyLimited(
  request: Request,
  maxBytes: number,
): Promise<LimitedJsonBodyResult> {
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, reason: "invalid_json" };

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(source) as unknown };
  } catch {
    await reader.cancel().catch(() => undefined);
    return { ok: false, reason: "invalid_json" };
  } finally {
    reader.releaseLock();
  }
}
