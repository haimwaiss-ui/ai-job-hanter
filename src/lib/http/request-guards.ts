export const MAX_JSON_BODY_BYTES = 32 * 1024;
export const MAX_RESUME_REQUEST_BYTES = 10 * 1024 * 1024 + 64 * 1024;

export type LimitedJsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "invalid" | "too_large" };

/** Read JSON incrementally so a missing or dishonest Content-Length cannot bypass the body limit. */
export async function readJsonBodyLimited(
  request: Request,
  maxBytes: number,
): Promise<LimitedJsonBodyResult> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null &&
      (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)) {
    return { ok: false, reason: "too_large" };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, reason: "invalid" };

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }

    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(combined);
    return { ok: true, value: JSON.parse(decoded) as unknown };
  } catch {
    return { ok: false, reason: "invalid" };
  } finally {
    reader.releaseLock();
  }
}

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
