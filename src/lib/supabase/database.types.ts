/**
 * Generate authoritative types after applying all migrations:
 * npx supabase gen types typescript --project-id "$PROJECT_REF" --schema public > src/lib/supabase/database.types.ts
 *
 * This is a starter contract; regenerate from the actual Supabase schema.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type EmploymentType =
  | "full_time" | "part_time" | "contract" | "freelance"
  | "internship" | "temporary" | "other";

export type ApplicationStatus =
  | "discovered" | "analyzing" | "matched" | "pending_approval"
  | "approved" | "generating_resume" | "ready_to_submit"
  | "submitting" | "submitted" | "interviewing" | "offer_received"
  | "rejected" | "withdrawn" | "manual_assist" | "failed";

export type ExecutionType =
  | "scraping" | "pre_filtering" | "ai_matching" | "resume_generation"
  | "pdf_generation" | "email_submission" | "form_submission"
  | "manual_assist" | "status_sync" | "system";

export type ExecutionStatus =
  | "pending" | "running" | "success" | "failed" | "fallback" | "retrying";

type Timestamp = string;
type UUID = string;

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          user_id: UUID; full_name: string | null; email: string | null;
          phone: string | null; location: string | null; linkedin_url: string | null;
          portfolio_url: string | null; headline: string | null;
          professional_summary: string | null; skills: string[];
          preferred_locations: string[]; preferred_employment_types: EmploymentType[];
          min_salary: number | null; salary_currency: string | null;
          remote_preference: boolean | null; onboarding_completed: boolean;
          created_at: Timestamp; updated_at: Timestamp;
        };
        Insert: {
          user_id: UUID; full_name?: string | null; email?: string | null;
          phone?: string | null; location?: string | null; linkedin_url?: string | null;
          portfolio_url?: string | null; headline?: string | null;
          professional_summary?: string | null; skills?: string[];
          preferred_locations?: string[]; preferred_employment_types?: EmploymentType[];
          min_salary?: number | null; salary_currency?: string | null;
          remote_preference?: boolean | null; onboarding_completed?: boolean;
          created_at?: Timestamp; updated_at?: Timestamp;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      resumes: {
        Row: {
          id: UUID; user_id: UUID; name: string; storage_bucket: string;
          storage_path: string; original_filename: string | null; mime_type: string;
          file_size_bytes: number | null; parsed_text: string | null; parsed_data: Json;
          skills: string[]; is_default: boolean; is_ai_generated: boolean;
          source_resume_id: UUID | null; created_at: Timestamp; updated_at: Timestamp;
        };
        Insert: {
          id?: UUID; user_id: UUID; name: string; storage_bucket?: string;
          storage_path: string; original_filename?: string | null; mime_type?: string;
          file_size_bytes?: number | null; parsed_text?: string | null; parsed_data?: Json;
          skills?: string[]; is_default?: boolean; is_ai_generated?: boolean;
          source_resume_id?: UUID | null; created_at?: Timestamp; updated_at?: Timestamp;
        };
        Update: Partial<Database["public"]["Tables"]["resumes"]["Insert"]>;
        Relationships: [];
      };
      jobs: {
        Row: {
          id: UUID; user_id: UUID; external_id: string | null; source: string;
          source_url: string; company_name: string; company_website: string | null;
          title: string; description: string | null; location: string | null;
          country_code: string | null; employment_type: EmploymentType | null;
          remote: boolean; salary_min: number | null; salary_max: number | null;
          salary_currency: string | null; required_skills: string[];
          preferred_skills: string[]; experience_level: string | null;
          application_url: string | null; published_at: Timestamp | null;
          expires_at: Timestamp | null; pre_filter_score: number | null;
          pre_filter_passed: boolean; pre_filter_reasons: Json;
          raw_metadata: Json; is_active: boolean; scraped_at: Timestamp;
          created_at: Timestamp; updated_at: Timestamp;
        };
        Insert: {
          id?: UUID; user_id: UUID; external_id?: string | null; source: string;
          source_url: string; company_name: string; company_website?: string | null;
          title: string; description?: string | null; location?: string | null;
          country_code?: string | null; employment_type?: EmploymentType | null;
          remote?: boolean; salary_min?: number | null; salary_max?: number | null;
          salary_currency?: string | null; required_skills?: string[];
          preferred_skills?: string[]; experience_level?: string | null;
          application_url?: string | null; published_at?: Timestamp | null;
          expires_at?: Timestamp | null; pre_filter_score?: number | null;
          pre_filter_passed?: boolean; pre_filter_reasons?: Json;
          raw_metadata?: Json; is_active?: boolean; scraped_at?: Timestamp;
          created_at?: Timestamp; updated_at?: Timestamp;
        };
        Update: Partial<Database["public"]["Tables"]["jobs"]["Insert"]>;
        Relationships: [];
      };
      applications: {
        Row: {
          id: UUID; user_id: UUID; job_id: UUID; resume_id: UUID | null;
          status: ApplicationStatus; match_score: number | null;
          match_reasons: Json; ai_analysis: Json; tailored_resume_storage_path: string | null;
          cover_letter: string | null; submission_method: string | null;
          external_application_id: string | null; applied_at: Timestamp | null;
          last_status_sync_at: Timestamp | null; retry_count: number;
          last_error: string | null; manual_assist_required: boolean;
          manual_assist_url: string | null; manual_assist_resume_storage_path: string | null; notes: string | null;
          created_at: Timestamp; updated_at: Timestamp;
        };
        Insert: {
          id?: UUID; user_id: UUID; job_id: UUID; resume_id?: UUID | null;
          status?: ApplicationStatus; match_score?: number | null;
          match_reasons?: Json; ai_analysis?: Json;
          tailored_resume_storage_path?: string | null; cover_letter?: string | null;
          submission_method?: string | null; external_application_id?: string | null;
          applied_at?: Timestamp | null; last_status_sync_at?: Timestamp | null;
          retry_count?: number; last_error?: string | null;
          manual_assist_required?: boolean; manual_assist_url?: string | null;
          manual_assist_resume_storage_path?: string | null; notes?: string | null; created_at?: Timestamp; updated_at?: Timestamp;
        };
        Update: Partial<Database["public"]["Tables"]["applications"]["Insert"]>;
        Relationships: [];
      };
      execution_logs: {
        Row: {
          id: UUID; user_id: UUID; application_id: UUID | null; job_id: UUID | null;
          execution_type: ExecutionType; status: ExecutionStatus;
          service_name: string | null; operation: string | null; attempt_number: number;
          duration_ms: number | null; error_code: string | null; error_message: string | null;
          fallback_reason: string | null; metadata: Json; created_at: Timestamp;
        };
        Insert: {
          id?: UUID; user_id: UUID; application_id?: UUID | null; job_id?: UUID | null;
          execution_type: ExecutionType; status?: ExecutionStatus;
          service_name?: string | null; operation?: string | null; attempt_number?: number;
          duration_ms?: number | null; error_code?: string | null;
          error_message?: string | null; fallback_reason?: string | null;
          metadata?: Json; created_at?: Timestamp;
        };
        Update: Partial<Database["public"]["Tables"]["execution_logs"]["Insert"]>;
        Relationships: [];
      };
      worker_sessions: {
        Row: {
          user_id: UUID; token_vault_ref: UUID; revoked_at: Timestamp | null;
          created_at: Timestamp; updated_at: Timestamp;
        };
        Insert: {
          user_id: UUID; token_vault_ref: UUID; revoked_at?: Timestamp | null;
          created_at?: Timestamp; updated_at?: Timestamp;
        };
        Update: Partial<Database["public"]["Tables"]["worker_sessions"]["Insert"]>;
        Relationships: [];
      };
      worker_operations: {
        Row: {
          id: UUID; user_id: UUID;
          queue_name: "scraper-queue" | "ai-processing-queue" | "submission-queue";
          idempotency_key: string; operation_id: UUID;
          status: "running" | "retrying" | "completed" | "failed" | "manual_assist";
          attempt_count: number; lease_until: Timestamp | null;
          last_error_code: string | null; last_error_message: string | null;
          created_at: Timestamp; updated_at: Timestamp; completed_at: Timestamp | null;
        };
        Insert: {
          id?: UUID; user_id: UUID;
          queue_name: "scraper-queue" | "ai-processing-queue" | "submission-queue";
          idempotency_key: string; operation_id: UUID;
          status?: "running" | "retrying" | "completed" | "failed" | "manual_assist";
          attempt_count?: number; lease_until?: Timestamp | null;
          last_error_code?: string | null; last_error_message?: string | null;
          created_at?: Timestamp; updated_at?: Timestamp; completed_at?: Timestamp | null;
        };
        Update: Partial<Database["public"]["Tables"]["worker_operations"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      worker_current_context: {
        Args: Record<string, never>;
        Returns: { user_id: UUID | null; worker_enabled: boolean }[];
      };
      claim_worker_operation: {
        Args: {
          p_queue_name: "scraper-queue" | "ai-processing-queue" | "submission-queue";
          p_idempotency_key: string;
          p_operation_id: UUID;
        };
        Returns: boolean;
      };
    };
    Enums: {
      employment_type: EmploymentType;
      application_status: ApplicationStatus;
      execution_type: ExecutionType;
      execution_status: ExecutionStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
