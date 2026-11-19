import { z } from "zod";

const uuid = z.string().uuid();

const nullableText = (max: number) =>
  z.union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((value) => value === "" ? null : value);

const httpUrl = z.string().trim().url().max(2048).refine((value) => {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}, "Expected an HTTP(S) URL without embedded credentials");

const optionalNullableUrl = z.union([httpUrl, z.literal(""), z.null()])
  .optional()
  .transform((value) => value === "" ? null : value);

const optionalCurrency = z.union([
  z.string().regex(/^[A-Z]{3}$/),
  z.literal(""),
  z.null(),
]).optional().transform((value) => value === "" ? null : value);

const employmentType = z.enum([
  "full_time",
  "part_time",
  "contract",
  "freelance",
  "internship",
  "temporary",
  "other",
]);

const applicationStatus = z.enum([
  "discovered",
  "analyzing",
  "matched",
  "pending_approval",
  "approved",
  "generating_resume",
  "ready_to_submit",
  "submitting",
  "submitted",
  "interviewing",
  "offer_received",
  "rejected",
  "withdrawn",
  "manual_assist",
  "failed",
]);

export const profileUpdateSchema = z.object({
  full_name: nullableText(160),
  phone: nullableText(40),
  location: nullableText(160),
  linkedin_url: optionalNullableUrl,
  portfolio_url: optionalNullableUrl,
  headline: nullableText(240),
  professional_summary: nullableText(5000),
  skills: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
  preferred_locations: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
  preferred_employment_types: z.array(employmentType).max(7).optional(),
  min_salary: z.number().finite().nonnegative().max(10_000_000).nullable().optional(),
  salary_currency: optionalCurrency,
  remote_preference: z.boolean().nullable().optional(),
  onboarding_completed: z.boolean().optional(),
}).strict();

export const resumeMetadataSchema = z.object({
  name: z.string().trim().min(1).max(120),
  storage_path: z.string().regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/i,
    "Expected <user-uuid>/<uuid-v4>.pdf"
  ),
  original_filename: z.string().trim().max(255).nullable().optional(),
  file_size_bytes: z.number().int().positive().max(10 * 1024 * 1024),
  mime_type: z.literal("application/pdf"),
}).strict();

export const createApplicationSchema = z.object({
  job_id: uuid,
  resume_id: uuid.nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
}).strict();

export const updateApplicationSchema = z.object({
  id: uuid,
  status: applicationStatus,
}).strict();

export const createJobSchema = z.object({
  title: z.string().trim().min(1).max(200),
  company_name: z.string().trim().min(1).max(200),
  location: nullableText(200),
  description: nullableText(12000),
  application_url: optionalNullableUrl,
  source_url: optionalNullableUrl,
  company_website: optionalNullableUrl,
  country_code: z.union([z.string().regex(/^[A-Z]{2}$/), z.literal(""), z.null()])
    .optional().transform((value) => value === "" ? null : value),
  employment_type: employmentType.nullable().optional(),
  remote: z.boolean().optional(),
  salary_min: z.number().finite().nonnegative().max(10_000_000).nullable().optional(),
  salary_max: z.number().finite().nonnegative().max(10_000_000).nullable().optional(),
  salary_currency: optionalCurrency,
  required_skills: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
  preferred_skills: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
  experience_level: nullableText(80),
}).strict().refine(
  (value) => value.salary_min == null || value.salary_max == null || value.salary_max >= value.salary_min,
  { message: "salary_max must be greater than or equal to salary_min", path: ["salary_max"] }
);

const scanFrequency = z.enum(["daily", "weekly", "monthly"]);
const scanSource = z.enum(["manual", "linkedin", "alljobs", "facebook", "company_sites"]);
const submissionMode = z.enum(["manual", "approval", "automatic"]);

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const preferencesUpdateSchema = z.object({
  scan_frequency: scanFrequency.optional(),
  scan_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  timezone: z.string().trim().min(1).max(80).refine(isValidTimeZone).optional(),
  scan_enabled: z.boolean().optional(),
  scan_sources: z.array(scanSource).max(10).optional(),
  submission_mode: submissionMode.optional(),
  min_match_score: z.number().int().min(0).max(100).optional(),
  auto_submit_enabled: z.boolean().optional(),
  require_approval: z.boolean().optional(),
}).strict();

const safeSearchQuery = z.string().trim().max(240).refine(
  (value) => !/[\\u0000-\\u001f\\u007f]/.test(value),
  "Search query contains unsupported control characters",
);

export const jobScanRequestSchema = z.object({
  query: safeSearchQuery.optional(),
}).strict();

/** Validates untrusted provider output before any result is persisted or linked. */
export const tavilySearchResultSchema = z.object({
  title: z.string().trim().min(1).max(300),
  url: httpUrl,
  content: z.string().max(12_000).optional(),
  score: z.number().finite().min(0).max(1).optional(),
  published_date: z.string().max(80).optional(),
}).strip();

export const tavilySearchResponseSchema = z.object({
  results: z.array(tavilySearchResultSchema).max(100),
}).passthrough();

export type TavilySearchResult = z.infer<typeof tavilySearchResultSchema>;

export const activityEventSchema = z.object({
  event_type: z.enum([
    "job_opened",
    "job_saved",
    "job_dismissed",
    "job_search",
    "scan_requested",
    "application_created",
    "application_status_changed",
    "preference_updated",
    "profile_updated",
    "job_added",
    "resume_uploaded",
  ]),
  entity_type: z.enum(["job", "application", "resume"]).nullable().optional(),
  entity_id: uuid.nullable().optional(),
  payload: z.record(z.string(), z.union([
    z.string().max(2000),
    z.number().finite(),
    z.boolean(),
    z.null(),
  ])).optional(),
}).strict();

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type ResumeMetadataInput = z.infer<typeof resumeMetadataSchema>;
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;
export type CreateJobInput = z.infer<typeof createJobSchema>;
export type PreferencesUpdateInput = z.infer<typeof preferencesUpdateSchema>;
export type ActivityEventInput = z.infer<typeof activityEventSchema>;
