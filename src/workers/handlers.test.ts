import { describe, expect, it } from "vitest";
import { aiAnalysisResultSchema, workerSearchGroupForSource } from "./handlers";

describe("BullMQ worker handlers", () => {
  it("maps each scraper payload source to a bounded public search group", () => {
    expect(workerSearchGroupForSource("linkedin").includeDomains).toEqual(["linkedin.com"]);
    expect(workerSearchGroupForSource("alljobs").includeDomains).toContain("alljobs.co.il");
    expect(workerSearchGroupForSource("facebook").includeDomains).toEqual(["facebook.com"]);
    expect(workerSearchGroupForSource("company_careers").includeDomains).toContain("boards.greenhouse.io");
    expect(workerSearchGroupForSource("public_feed").id).toBe("web");
  });

  it("rejects malformed or over-scored AI provider output", () => {
    expect(aiAnalysisResultSchema.safeParse({
      matchScore: 101,
      matchReasons: [],
      strengths: [],
      gaps: [],
      summary: "bad",
    }).success).toBe(false);
  });

  it("accepts a bounded evidence-based AI analysis", () => {
    expect(aiAnalysisResultSchema.safeParse({
      matchScore: 82,
      matchReasons: ["Required SQL skill appears in the resume."],
      strengths: ["SQL"],
      gaps: ["No evidence of Kubernetes."],
      summary: "Good match based on the supplied resume.",
    }).success).toBe(true);
  });
});
