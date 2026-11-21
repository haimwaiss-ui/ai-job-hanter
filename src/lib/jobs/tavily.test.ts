import { describe, expect, it } from "vitest";
import { JOB_SEARCH_GROUPS, normalizeJobUrl } from "./tavily";

describe("shared Tavily search helpers", () => {
  it("keeps the existing public source groups available", () => {
    expect(JOB_SEARCH_GROUPS.map((group) => group.id)).toEqual([
      "job_boards", "linkedin", "facebook", "x", "web",
    ]);
  });

  it("normalizes tracking parameters without changing the destination", () => {
    expect(normalizeJobUrl("https://jobs.example/role/1?utm_source=x&ref=careers#apply"))
      .toBe("https://jobs.example/role/1?ref=careers");
  });

  it("rejects non-web, credentialed, and local-network URLs", () => {
    expect(normalizeJobUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeJobUrl("https://user:pass@jobs.example/")).toBeNull();
    expect(normalizeJobUrl("http://127.0.0.1/admin")).toBeNull();
    expect(normalizeJobUrl("http://[::1]/admin")).toBeNull();
    expect(normalizeJobUrl("http://service.internal/")).toBeNull();
  });
});
