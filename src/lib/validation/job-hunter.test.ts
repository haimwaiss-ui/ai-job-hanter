import { describe, expect, it } from "vitest";
import {
  createApplicationSchema,
  jobScanRequestSchema,
  tavilySearchResponseSchema,
  createJobSchema,
  preferencesUpdateSchema,
  profileUpdateSchema,
  resumeMetadataSchema,
  updateApplicationSchema,
} from "./job-hunter";

const userId = "11111111-1111-4111-8111-111111111111";
const objectId = "22222222-2222-4222-8222-222222222222";

describe("tenant API schemas", () => {
  it("rejects client-controlled profile ownership and email", () => {
    expect(profileUpdateSchema.safeParse({ full_name: "Test", onboarding_completed: true }).success).toBe(true);
    expect(profileUpdateSchema.safeParse({ user_id: userId }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ email: "attacker@example.com" }).success).toBe(false);
  });

  it("accepts canonical PDF metadata and rejects arbitrary object paths", () => {
    const valid = {
      name: "Resume",
      storage_path: userId + "/" + objectId + ".pdf",
      original_filename: "resume.pdf",
      file_size_bytes: 1024,
      mime_type: "application/pdf",
    };
    expect(resumeMetadataSchema.safeParse(valid).success).toBe(true);
    expect(resumeMetadataSchema.safeParse({ ...valid, storage_path: userId + "/../../other.pdf" }).success).toBe(false);
    expect(resumeMetadataSchema.safeParse({ ...valid, file_size_bytes: 20 * 1024 * 1024 }).success).toBe(false);
  });

  it("validates job URLs and salary ranges", () => {
    expect(createJobSchema.safeParse({
      title: "Developer",
      company_name: "Example",
      application_url: "https://example.com/jobs/1",
    }).success).toBe(true);
    expect(createJobSchema.safeParse({
      title: "Developer",
      company_name: "Example",
      application_url: "javascript:alert(1)",
    }).success).toBe(false);
    expect(createJobSchema.safeParse({
      title: "Developer",
      company_name: "Example",
      salary_min: 20000,
      salary_max: 10000,
    }).success).toBe(false);
  });

  it("rejects malformed job-scan input and tenant-controlled fields", () => {
    expect(jobScanRequestSchema.safeParse({}).success).toBe(true);
    expect(jobScanRequestSchema.safeParse({ query: "  Backend Engineer  " }).data?.query).toBe("Backend Engineer");
    expect(jobScanRequestSchema.safeParse({ query: "x".repeat(241) }).success).toBe(false);
    expect(jobScanRequestSchema.safeParse({ query: "jobs\u0000 hidden" }).success).toBe(false);
    expect(jobScanRequestSchema.safeParse({ query: "developer", user_id: userId }).success).toBe(false);
    expect(jobScanRequestSchema.safeParse("developer").success).toBe(false);
  });

  it("validates external search results before they can be persisted", () => {
    const valid = {
      results: [{
        title: "Backend Engineer",
        url: "https://careers.example.com/jobs/1",
        content: "Build services",
        score: 0.92,
        published_date: "2026-11-19",
        raw_content: "provider-only field",
      }],
      response_time: 0.4,
    };
    const parsed = tavilySearchResponseSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("raw_content" in parsed.data.results[0]).toBe(false);
    }
    expect(tavilySearchResponseSchema.safeParse({
      results: [{ title: "Bad URL", url: "javascript:alert(1)" }],
    }).success).toBe(false);
    expect(tavilySearchResponseSchema.safeParse({
      results: [{ title: "Credential URL", url: "https://user:pass@example.com/job" }],
    }).success).toBe(false);
    expect(tavilySearchResponseSchema.safeParse({
      results: [{ title: "Bad score", url: "https://example.com", score: 4 }],
    }).success).toBe(false);
  });

  it("validates timezone and application status without accepting tenant ids", () => {
    expect(preferencesUpdateSchema.safeParse({ timezone: "Asia/Jerusalem", scan_time: "08:00" }).success).toBe(true);
    expect(preferencesUpdateSchema.safeParse({ timezone: "Mars/Nope" }).success).toBe(false);
    expect(updateApplicationSchema.safeParse({ id: objectId, status: "submitted" }).success).toBe(true);
    expect(updateApplicationSchema.safeParse({ id: objectId, status: "submitted", user_id: userId }).success).toBe(false);
    expect(createApplicationSchema.safeParse({ job_id: objectId }).success).toBe(true);
  });
});
