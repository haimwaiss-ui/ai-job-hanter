import { afterEach, describe, expect, it } from "vitest";
import {
  contentLengthExceeds,
  hasJsonContentType,
  hasMultipartFormDataContentType,
  isSameOriginMutation,
  readRequestBodyLimited,
  readRequestTextLimited,
} from "./request-guards";

afterEach(() => {
  delete process.env.APP_ORIGIN;
});

describe("request guards", () => {
  it("accepts only the configured same origin", () => {
    process.env.APP_ORIGIN = "https://app.example";
    const same = new Request("https://app.example/api/profile", {
      method: "PATCH",
      headers: { origin: "https://app.example" },
    });
    const other = new Request("https://app.example/api/profile", {
      method: "PATCH",
      headers: { origin: "https://evil.example" },
    });
    expect(isSameOriginMutation(same)).toBe(true);
    expect(isSameOriginMutation(other)).toBe(false);
  });

  it("rejects missing or invalid origins", () => {
    const missing = new Request("https://app.example/api/profile", { method: "PATCH" });
    const invalid = new Request("https://app.example/api/profile", {
      method: "PATCH",
      headers: { origin: "null" },
    });
    expect(isSameOriginMutation(missing)).toBe(false);
    expect(isSameOriginMutation(invalid)).toBe(false);
  });

  it("checks content type and declared body size", () => {
    const json = new Request("https://app.example/api", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", "content-length": "20" },
    });
    const multipart = new Request("https://app.example/api", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=abc" },
    });
    expect(hasJsonContentType(json)).toBe(true);
    expect(hasMultipartFormDataContentType(multipart)).toBe(true);
    expect(contentLengthExceeds(json, 10)).toBe(true);
    expect(contentLengthExceeds(multipart, 10)).toBe(false);
  });

  it("enforces the byte limit against the actual stream when Content-Length is absent", async () => {
    const request = new Request("https://app.example/api", {
      method: "POST",
      body: "123456",
    });
    expect(request.headers.has("content-length")).toBe(false);

    await expect(readRequestBodyLimited(request, 5)).resolves.toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("accepts a body exactly at the configured byte limit", async () => {
    const request = new Request("https://app.example/api", {
      method: "POST",
      body: "12345",
    });
    const result = await readRequestBodyLimited(request, 5);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new TextDecoder().decode(result.bytes)).toBe("12345");
    }
  });

  it("rejects a declared oversized body before reading it", async () => {
    const request = new Request("https://app.example/api", {
      method: "POST",
      headers: { "content-length": "11" },
      body: "12345678901",
    });
    await expect(readRequestBodyLimited(request, 10)).resolves.toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("rejects invalid UTF-8 rather than silently replacing bytes", async () => {
    const request = new Request("https://app.example/api", {
      method: "POST",
      body: new Uint8Array([0xff, 0xfe]),
    });
    await expect(readRequestTextLimited(request, 10)).resolves.toEqual({
      ok: false,
      reason: "invalid_utf8",
    });
  });

  it("returns an empty body for requests without a body", async () => {
    const request = new Request("https://app.example/api", { method: "POST" });
    await expect(readRequestBodyLimited(request, 10)).resolves.toEqual({
      ok: true,
      bytes: new Uint8Array(0),
    });
  });
});
