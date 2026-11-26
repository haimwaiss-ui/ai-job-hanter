import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  assertSubmissionSignalActive,
  buildManualAssistPatch,
  classifySubmissionFailure,
  executeSubmissionWithFallback,
  ManualAssistRequiredError,
  markSubmissionManualAssist,
  validateExternalApplicationUrl,
} from "./submission";

const userId = "10000000-0000-4000-8000-000000000001";
const applicationId = "20000000-0000-4000-8000-000000000002";
const jobId = "30000000-0000-4000-8000-000000000003";
const resumeId = "40000000-0000-4000-8000-000000000004";
const resumePath = userId + "/" + resumeId + ".pdf";

describe("submission safety and CAPTCHA fallback", () => {
  it("classifies CAPTCHA and site blocks as manual-assist conditions", () => {
    expect(classifySubmissionFailure(new Error("CAPTCHA challenge detected"))).toBe("captcha");
    expect(classifySubmissionFailure(new Error("Access Denied - unusual traffic"))).toBe("site_blocked");
  });

  it("uses a stable manual-assist code when no approved adapter is available", () => {
    const error = new ManualAssistRequiredError("manual_required");
    expect(error.code).toBe("MANUAL_ASSIST_REQUIRED");
  });

  it("describes ambiguous submission outcomes without prompting an unsafe resubmission", () => {
    const patch = buildManualAssistPatch({
      applicationUrl: "https://jobs.example/apply/123",
      existingTailoredResumePath: null,
      sourceResumePath: resumePath,
      outcomeUnknown: true,
    });

    expect(patch.last_error).toContain("Verify the application status before submitting again");
    expect(new ManualAssistRequiredError("outcome_unknown").code).toBe("SUBMISSION_OUTCOME_UNKNOWN");
  });

  it("converts an aborted late adapter response into manual assistance", () => {
    const controller = new AbortController();
    controller.abort();

    expect(() => assertSubmissionSignalActive(controller.signal))
      .toThrow(ManualAssistRequiredError);
  });

  it("does not downgrade an application already confirmed as submitted", async () => {
    const applicationRead = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: applicationId,
          user_id: userId,
          job_id: jobId,
          resume_id: resumeId,
          tailored_resume_storage_path: null,
          status: "submitted",
        },
        error: null,
      }),
    };
    const supabase = {
      from: vi.fn().mockReturnValue(applicationRead),
    } as unknown as SupabaseClient<Database>;

    const result = await markSubmissionManualAssist(supabase, userId, applicationId, true);

    expect(result.alreadySubmitted).toBe(true);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("preserves a private PDF storage path and direct application URL", () => {
    const patch = buildManualAssistPatch({
      applicationUrl: "https://jobs.example/apply/123",
      existingTailoredResumePath: null,
      sourceResumePath: resumePath,
    });

    expect(patch.status).toBe("manual_assist");
    expect(patch.manual_assist_required).toBe(true);
    expect(patch.manual_assist_url).toBe("https://jobs.example/apply/123");
    expect(patch.manual_assist_resume_storage_path).toBe(resumePath);
  });

  it("rejects unsafe application URLs", () => {
    expect(() => validateExternalApplicationUrl("javascript:alert(1)")).toThrow();
    expect(() => validateExternalApplicationUrl("http://127.0.0.1/admin")).toThrow();
    expect(() => validateExternalApplicationUrl("http://[::1]/admin")).toThrow();
    expect(() => validateExternalApplicationUrl("http://service.internal/")).toThrow();
  });

  it("persists an outcome-unknown state that asks the user to verify before resubmitting", async () => {
    const appRead = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: applicationId,
          user_id: userId,
          job_id: jobId,
          resume_id: resumeId,
          tailored_resume_storage_path: null,
          status: "submitting",
        },
        error: null,
      }),
    };
    const jobRead = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          application_url: "https://jobs.example/apply/123",
          source_url: "https://jobs.example/jobs/123",
        },
        error: null,
      }),
    };
    const resumeRead = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { storage_path: resumePath }, error: null }),
    };
    const appUpdate = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: applicationId }, error: null }),
    };
    let applicationReadCount = 0;
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "applications") {
          applicationReadCount += 1;
          return applicationReadCount === 1 ? appRead : appUpdate;
        }
        if (table === "jobs") return jobRead;
        if (table === "resumes") return resumeRead;
        throw new Error("Unexpected table");
      }),
    } as unknown as SupabaseClient<Database>;

    const submit = vi.fn().mockRejectedValue(new ManualAssistRequiredError("outcome_unknown"));
    await expect(executeSubmissionWithFallback(supabase, {
      userId,
      applicationId,
      signal: new AbortController().signal,
      submit,
    })).rejects.toMatchObject({ classification: "outcome_unknown" });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(appUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "manual_assist",
      manual_assist_required: true,
      manual_assist_url: "https://jobs.example/apply/123",
      manual_assist_resume_storage_path: resumePath,
      last_error: expect.stringContaining("Verify the application status before submitting again"),
    }));
  });

  it("persists Manual Assist and does not retry when CAPTCHA is detected", async () => {
    const appRead = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: applicationId,
          user_id: userId,
          job_id: jobId,
          resume_id: resumeId,
          tailored_resume_storage_path: null,
          status: "approved",
        },
        error: null,
      }),
    };
    const jobRead = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          application_url: "https://jobs.example/apply/123",
          source_url: "https://jobs.example/jobs/123",
        },
        error: null,
      }),
    };
    const resumeRead = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { storage_path: resumePath }, error: null }),
    };
    const appUpdate = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: applicationId }, error: null }),
    };

    let applicationReadCount = 0;
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "applications") {
          applicationReadCount += 1;
          return applicationReadCount === 1 ? appRead : appUpdate;
        }
        if (table === "jobs") return jobRead;
        if (table === "resumes") return resumeRead;
        throw new Error("Unexpected table");
      }),
    } as unknown as SupabaseClient<Database>;

    const submit = vi.fn().mockRejectedValue(new Error("CAPTCHA challenge detected"));
    await expect(executeSubmissionWithFallback(supabase, {
      userId,
      applicationId,
      signal: new AbortController().signal,
      submit,
    })).rejects.toBeInstanceOf(ManualAssistRequiredError);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(appUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "manual_assist",
      manual_assist_required: true,
      manual_assist_url: "https://jobs.example/apply/123",
      manual_assist_resume_storage_path: resumePath,
    }));
  });
});
