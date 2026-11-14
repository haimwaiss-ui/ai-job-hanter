import { z } from "zod";

const uuid = z.string().uuid();
const boundedText = (max: number) => z.string().trim().min(1).max(max);

export const profileUpdateSchema = z.object({
  full_name: z.string().trim().max(160).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  location: z.string().trim().max(160).nullable().optional(),
  linkedin_url: z.string().url().max(2048).nullable().optional(),
  portfolio_url: z.string().url().max(2048).nullable().optional(),
  headline: z.string().trim().max(240).nullable().optional(),
  professional_summary: z.string().trim().max(5000).nullable().optional(),
  skills: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
  preferred_locations: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
  min_salary: z.number().finite().nonnegative().max(10_000_000).nullable().optional(),
  salary_currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  remote_preference: z.boolean().optional(),
}).strict();

export const resumeMetadataSchema = z.object({
  name: boundedText(120),
  storage_path: z.string().regex(
    /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/i,
    "Expected <user-uuid>/<random-uuid>.pdf"
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

export const workerJobSchema = z.object({
  jobId: uuid,
  userId: uuid,
  operationId: uuid,
  kind: z.enum(["scrape", "prefilter", "match", "tailor_resume", "submit"]),
  attempt: z.number().int().min(1).max(8),
  tokenVaultRef: z.string().min(16).max(256),
}).strict();

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type ResumeMetadataInput = z.infer<typeof resumeMetadataSchema>;
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
export type WorkerJobInput = z.infer<typeof workerJobSchema>;
