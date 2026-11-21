import { describe, expect, it, vi } from "vitest";
import { aiAnalysisResultSchema, createTenantApplicationWithAiAnalysis, submissionAdapterResultSchema, workerSearchGroupForSource } from "./handlers";

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

  it("requires explicit success confirmation from a submission adapter", () => {
    expect(submissionAdapterResultSchema.safeParse({ submitted: true }).success).toBe(true);
    expect(submissionAdapterResultSchema.safeParse({ submitted: false }).success).toBe(false);
    expect(submissionAdapterResultSchema.safeParse({ submitted: true, accessToken: "secret" }).success).toBe(false);
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
  it("uses only tenant ownership columns on INSERT, then writes AI fields through UPDATE", async () => {
    const userId = "10000000-0000-4000-8000-000000000001";
    const jobId = "30000000-0000-4000-8000-000000000003";
    const resumeId = "40000000-0000-4000-8000-000000000004";
    const applicationId = "20000000-0000-4000-8000-000000000002";
    const insertBuilder = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: applicationId }, error: null }),
    };
    let updateFilterCount = 0;
    let updateBuilder: {
      update: ReturnType<typeof vi.fn>;
      eq: ReturnType<typeof vi.fn>;
    };
    updateBuilder = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn(() => {
        updateFilterCount += 1;
        return updateFilterCount === 2 ? Promise.resolve({ error: null }) : updateBuilder;
      }),
    };
    const supabase = {
      from: vi.fn()
        .mockReturnValueOnce(insertBuilder)
        .mockReturnValueOnce(updateBuilder),
    };

    const patch = {
      match_score: 86,
      match_reasons: ["Required experience is present."],
      ai_analysis: { provider: "openai" },
      updated_at: "2026-11-21T00:00:00.000Z",
    };
    await createTenantApplicationWithAiAnalysis(supabase as never, {
      userId,
      jobId,
      resumeId,
      nextStatus: "matched",
      patch,
    });

    expect(insertBuilder.insert).toHaveBeenCalledWith({ user_id: userId, job_id: jobId, resume_id: resumeId });
    expect(insertBuilder.insert.mock.calls[0][0]).not.toHaveProperty("match_score");
    expect(updateBuilder.update).toHaveBeenCalledWith({ ...patch, status: "matched" });
    expect(updateBuilder.eq).toHaveBeenNthCalledWith(1, "id", applicationId);
    expect(updateBuilder.eq).toHaveBeenNthCalledWith(2, "user_id", userId);
  });

});
