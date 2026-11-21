import { isIP } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type SubmissionFailureClass =
  | "captcha"
  | "site_blocked"
  | "authentication_required"
  | "manual_required"
  | "permanent_validation"
  | "transient_network"
  | "unknown";

export class PermanentSubmissionError extends Error {
  readonly code = "SUBMISSION_VALIDATION_FAILED";

  constructor() {
    super("Submission cannot continue because required form data is invalid");
    this.name = "PermanentSubmissionError";
  }
}

export class ManualAssistRequiredError extends Error {
  readonly code: string;

  constructor(readonly classification: "captcha" | "site_blocked" | "authentication_required" | "manual_required") {
    super("Automated submission paused for human assistance");
    this.name = "ManualAssistRequiredError";
    this.code = classification === "captcha"
      ? "CAPTCHA_DETECTED"
      : classification === "site_blocked"
        ? "SITE_BLOCKED"
        : classification === "manual_required"
          ? "MANUAL_ASSIST_REQUIRED"
          : "AUTH_REQUIRED";
  }
}

/**
 * External page text is untrusted evidence only. It is never interpreted as
 * instructions, and the classifier never attempts to solve or bypass a block.
 */
export function classifySubmissionFailure(error: unknown): SubmissionFailureClass {
  const message = error instanceof Error ? error.message : "";
  const status = typeof error === "object" && error !== null && "status" in error
    ? String((error as { status?: unknown }).status)
    : "";
  const evidence = (message + " " + status).toLowerCase();

  if (/captcha|recaptcha|hcaptcha|verify (that )?you are human|robot check|challenge-platform/.test(evidence)) {
    return "captcha";
  }
  if (/access denied|site blocked|unusual traffic|automated requests|cloudflare ray|http 403|status 403|status 429/.test(evidence)) {
    return "site_blocked";
  }
  if (/login required|sign in required|session expired|authentication required/.test(evidence)) {
    return "authentication_required";
  }
  if (/invalid form|missing required field|unsupported application/.test(evidence)) {
    return "permanent_validation";
  }
  if (/timeout|timed out|econnreset|etimedout|eai_again|network error|socket hang up/.test(evidence)) {
    return "transient_network";
  }
  return "unknown";
}

export function buildManualAssistPatch(input: {
  applicationUrl: string;
  existingTailoredResumePath: string | null;
  sourceResumePath: string | null;
}) {
  return {
    status: "manual_assist" as const,
    manual_assist_required: true,
    manual_assist_url: validateExternalApplicationUrl(input.applicationUrl),
    manual_assist_resume_storage_path:
      input.existingTailoredResumePath ?? input.sourceResumePath ?? null,
    last_error: "Automated submission stopped; complete this application manually.",
    updated_at: new Date().toISOString(),
  };
}

export function validateExternalApplicationUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Manual-assist application URL is invalid");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Manual-assist application URL must use HTTP or HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Manual-assist application URL cannot contain credentials");
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    (isIP(host) === 4 && (
      host.startsWith("10.") ||
      host.startsWith("127.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ))
  ) {
    throw new Error("Manual-assist URL points to a private network");
  }

  return parsed.toString();
}

export async function markSubmissionManualAssist(
  supabase: SupabaseClient<Database>,
  userId: string,
  applicationId: string,
): Promise<{ applicationUrl: string; resumeStoragePath: string | null }> {
  const { data: application, error: applicationError } = await supabase
    .from("applications")
    .select("id,user_id,job_id,resume_id,tailored_resume_storage_path")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .single();

  if (applicationError || !application) {
    throw new Error("Application not found for authenticated tenant");
  }

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("application_url,source_url")
    .eq("id", application.job_id)
    .eq("user_id", userId)
    .single();

  if (jobError || !job) throw new Error("Job reference is unavailable");

  let sourceResumePath: string | null = null;
  if (application.resume_id) {
    const { data: resume, error: resumeError } = await supabase
      .from("resumes")
      .select("storage_path")
      .eq("id", application.resume_id)
      .eq("user_id", userId)
      .single();
    if (resumeError || !resume) throw new Error("Resume reference is unavailable");
    sourceResumePath = resume.storage_path;
  }

  const applicationUrl = job.application_url || job.source_url;
  const patch = buildManualAssistPatch({
    applicationUrl,
    existingTailoredResumePath: application.tailored_resume_storage_path,
    sourceResumePath,
  });

  const { error: updateError } = await supabase
    .from("applications")
    .update(patch)
    .eq("id", applicationId)
    .eq("user_id", userId);

  if (updateError) throw new Error("Unable to persist manual-assist state");

  return {
    applicationUrl: patch.manual_assist_url,
    resumeStoragePath: patch.manual_assist_resume_storage_path,
  };
}

/**
 * Wrap a real submission adapter. CAPTCHA, site blocks, and expired login
 * sessions become Manual Assist; there is intentionally no bypass/retry path.
 */
export async function executeSubmissionWithFallback(
  supabase: SupabaseClient<Database>,
  input: {
    userId: string;
    applicationId: string;
    signal: AbortSignal;
    submit: (signal: AbortSignal) => Promise<void>;
  },
): Promise<void> {
  try {
    await input.submit(input.signal);
  } catch (error) {
    const classification = classifySubmissionFailure(error);
    if (
      classification === "captcha" ||
      classification === "site_blocked" ||
      classification === "authentication_required"
    ) {
      await markSubmissionManualAssist(supabase, input.userId, input.applicationId);
      throw new ManualAssistRequiredError(classification);
    }
    if (classification === "permanent_validation") {
      throw new PermanentSubmissionError();
    }
    throw error;
  }
}
