import { afterEach, describe, expect, it } from "vitest";
import {
  contentLengthExceeds,
  hasJsonContentType,
  hasMultipartFormDataContentType,
  isSameOriginMutation,
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
});
