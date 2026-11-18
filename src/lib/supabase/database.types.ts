export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      applications: {
        Row: {
          ai_analysis: Json
          applied_at: string | null
          cover_letter: string | null
          created_at: string
          external_application_id: string | null
          id: string
          job_id: string
          last_error: string | null
          last_status_sync_at: string | null
          manual_assist_required: boolean
          manual_assist_resume_storage_path: string | null
          manual_assist_url: string | null
          match_reasons: Json
          match_score: number | null
          notes: string | null
          resume_id: string | null
          retry_count: number
          status: Database["public"]["Enums"]["application_status"]
          submission_method: string | null
          tailored_resume_storage_path: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_analysis?: Json
          applied_at?: string | null
          cover_letter?: string | null
          created_at?: string
          external_application_id?: string | null
          id?: string
          job_id: string
          last_error?: string | null
          last_status_sync_at?: string | null
          manual_assist_required?: boolean
          manual_assist_resume_storage_path?: string | null
          manual_assist_url?: string | null
          match_reasons?: Json
          match_score?: number | null
          notes?: string | null
          resume_id?: string | null
          retry_count?: number
          status?: Database["public"]["Enums"]["application_status"]
          submission_method?: string | null
          tailored_resume_storage_path?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_analysis?: Json
          applied_at?: string | null
          cover_letter?: string | null
          created_at?: string
          external_application_id?: string | null
          id?: string
          job_id?: string
          last_error?: string | null
          last_status_sync_at?: string | null
          manual_assist_required?: boolean
          manual_assist_resume_storage_path?: string | null
          manual_assist_url?: string | null
          match_reasons?: Json
          match_score?: number | null
          notes?: string | null
          resume_id?: string | null
          retry_count?: number
          status?: Database["public"]["Enums"]["application_status"]
          submission_method?: string | null
          tailored_resume_storage_path?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_job_fk"
            columns: ["user_id", "job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "applications_resume_fk"
            columns: ["user_id", "resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      candidate_public_profiles: {
        Row: {
          full_name: string | null
          headline: string | null
          location: string | null
          skills: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          full_name?: string | null
          headline?: string | null
          location?: string | null
          skills?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          full_name?: string | null
          headline?: string | null
          location?: string | null
          skills?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      employer_applications: {
        Row: {
          candidate_user_id: string
          cover_letter: string | null
          created_at: string
          employer_job_id: string
          employer_user_id: string
          id: string
          status: string
          updated_at: string
        }
        Insert: {
          candidate_user_id: string
          cover_letter?: string | null
          created_at?: string
          employer_job_id: string
          employer_user_id: string
          id?: string
          status?: string
          updated_at?: string
        }
        Update: {
          candidate_user_id?: string
          cover_letter?: string | null
          created_at?: string
          employer_job_id?: string
          employer_user_id?: string
          id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employer_applications_candidate_profile_fk"
            columns: ["candidate_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "employer_applications_candidate_public_profile_fk"
            columns: ["candidate_user_id"]
            isOneToOne: false
            referencedRelation: "candidate_public_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "employer_applications_employer_job_id_fkey"
            columns: ["employer_job_id"]
            isOneToOne: false
            referencedRelation: "employer_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      employer_jobs: {
        Row: {
          company_name: string | null
          created_at: string
          department: string | null
          description: string
          employer_user_id: string
          employment_type: string
          id: string
          location: string | null
          salary_range: string | null
          status: string
          title: string
          updated_at: string
          workplace_type: string
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          department?: string | null
          description?: string
          employer_user_id: string
          employment_type?: string
          id?: string
          location?: string | null
          salary_range?: string | null
          status?: string
          title: string
          updated_at?: string
          workplace_type?: string
        }
        Update: {
          company_name?: string | null
          created_at?: string
          department?: string | null
          description?: string
          employer_user_id?: string
          employment_type?: string
          id?: string
          location?: string | null
          salary_range?: string | null
          status?: string
          title?: string
          updated_at?: string
          workplace_type?: string
        }
        Relationships: []
      }
      employer_profiles: {
        Row: {
          company_description: string | null
          company_name: string
          company_website: string | null
          contact_name: string | null
          created_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_description?: string | null
          company_name: string
          company_website?: string | null
          contact_name?: string | null
          created_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_description?: string | null
          company_name?: string
          company_website?: string | null
          contact_name?: string | null
          created_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      execution_logs: {
        Row: {
          application_id: string | null
          attempt_number: number
          created_at: string
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          execution_type: Database["public"]["Enums"]["execution_type"]
          fallback_reason: string | null
          id: string
          job_id: string | null
          metadata: Json
          operation: string | null
          service_name: string | null
          status: Database["public"]["Enums"]["execution_status"]
          user_id: string
        }
        Insert: {
          application_id?: string | null
          attempt_number?: number
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          execution_type: Database["public"]["Enums"]["execution_type"]
          fallback_reason?: string | null
          id?: string
          job_id?: string | null
          metadata?: Json
          operation?: string | null
          service_name?: string | null
          status?: Database["public"]["Enums"]["execution_status"]
          user_id: string
        }
        Update: {
          application_id?: string | null
          attempt_number?: number
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          execution_type?: Database["public"]["Enums"]["execution_type"]
          fallback_reason?: string | null
          id?: string
          job_id?: string | null
          metadata?: Json
          operation?: string | null
          service_name?: string | null
          status?: Database["public"]["Enums"]["execution_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_logs_application_fk"
            columns: ["user_id", "application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "execution_logs_job_fk"
            columns: ["user_id", "job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      gmail_connections: {
        Row: {
          connected_at: string
          refresh_token_ciphertext: string
          refresh_token_iv: string
          refresh_token_tag: string
          scopes: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          connected_at?: string
          refresh_token_ciphertext: string
          refresh_token_iv: string
          refresh_token_tag: string
          scopes?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          connected_at?: string
          refresh_token_ciphertext?: string
          refresh_token_iv?: string
          refresh_token_tag?: string
          scopes?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      jobs: {
        Row: {
          application_url: string | null
          company_name: string
          company_website: string | null
          country_code: string | null
          created_at: string
          description: string | null
          employment_type: Database["public"]["Enums"]["employment_type"] | null
          experience_level: string | null
          expires_at: string | null
          external_id: string | null
          id: string
          is_active: boolean
          location: string | null
          pre_filter_passed: boolean
          pre_filter_reasons: Json
          pre_filter_score: number | null
          preferred_skills: string[]
          published_at: string | null
          raw_metadata: Json
          remote: boolean
          required_skills: string[]
          salary_currency: string | null
          salary_max: number | null
          salary_min: number | null
          scraped_at: string
          source: string
          source_url: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          application_url?: string | null
          company_name: string
          company_website?: string | null
          country_code?: string | null
          created_at?: string
          description?: string | null
          employment_type?:
            | Database["public"]["Enums"]["employment_type"]
            | null
          experience_level?: string | null
          expires_at?: string | null
          external_id?: string | null
          id?: string
          is_active?: boolean
          location?: string | null
          pre_filter_passed?: boolean
          pre_filter_reasons?: Json
          pre_filter_score?: number | null
          preferred_skills?: string[]
          published_at?: string | null
          raw_metadata?: Json
          remote?: boolean
          required_skills?: string[]
          salary_currency?: string | null
          salary_max?: number | null
          salary_min?: number | null
          scraped_at?: string
          source?: string
          source_url?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          application_url?: string | null
          company_name?: string
          company_website?: string | null
          country_code?: string | null
          created_at?: string
          description?: string | null
          employment_type?:
            | Database["public"]["Enums"]["employment_type"]
            | null
          experience_level?: string | null
          expires_at?: string | null
          external_id?: string | null
          id?: string
          is_active?: boolean
          location?: string | null
          pre_filter_passed?: boolean
          pre_filter_reasons?: Json
          pre_filter_score?: number | null
          preferred_skills?: string[]
          published_at?: string | null
          raw_metadata?: Json
          remote?: boolean
          required_skills?: string[]
          salary_currency?: string | null
          salary_max?: number | null
          salary_min?: number | null
          scraped_at?: string
          source?: string
          source_url?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          headline: string | null
          linkedin_url: string | null
          location: string | null
          min_salary: number | null
          onboarding_completed: boolean
          phone: string | null
          portfolio_url: string | null
          preferred_employment_types: Database["public"]["Enums"]["employment_type"][]
          preferred_locations: string[]
          professional_summary: string | null
          remote_preference: boolean | null
          salary_currency: string | null
          skills: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          headline?: string | null
          linkedin_url?: string | null
          location?: string | null
          min_salary?: number | null
          onboarding_completed?: boolean
          phone?: string | null
          portfolio_url?: string | null
          preferred_employment_types?: Database["public"]["Enums"]["employment_type"][]
          preferred_locations?: string[]
          professional_summary?: string | null
          remote_preference?: boolean | null
          salary_currency?: string | null
          skills?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          headline?: string | null
          linkedin_url?: string | null
          location?: string | null
          min_salary?: number | null
          onboarding_completed?: boolean
          phone?: string | null
          portfolio_url?: string | null
          preferred_employment_types?: Database["public"]["Enums"]["employment_type"][]
          preferred_locations?: string[]
          professional_summary?: string | null
          remote_preference?: boolean | null
          salary_currency?: string | null
          skills?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      resumes: {
        Row: {
          created_at: string
          file_size_bytes: number | null
          id: string
          is_ai_generated: boolean
          is_default: boolean
          mime_type: string
          name: string
          original_filename: string | null
          parsed_data: Json
          parsed_text: string | null
          skills: string[]
          source_resume_id: string | null
          storage_bucket: string
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_size_bytes?: number | null
          id?: string
          is_ai_generated?: boolean
          is_default?: boolean
          mime_type?: string
          name: string
          original_filename?: string | null
          parsed_data?: Json
          parsed_text?: string | null
          skills?: string[]
          source_resume_id?: string | null
          storage_bucket?: string
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_size_bytes?: number | null
          id?: string
          is_ai_generated?: boolean
          is_default?: boolean
          mime_type?: string
          name?: string
          original_filename?: string | null
          parsed_data?: Json
          parsed_text?: string | null
          skills?: string[]
          source_resume_id?: string | null
          storage_bucket?: string
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resumes_source_fk"
            columns: ["user_id", "source_resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      user_activity_events: {
        Row: {
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: string
          payload: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          id?: string
          payload?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          id?: string
          payload?: Json
          user_id?: string
        }
        Relationships: []
      }
      user_insights: {
        Row: {
          confidence: number
          generated_at: string
          learned_preferences: Json
          next_best_actions: Json
          user_id: string
        }
        Insert: {
          confidence?: number
          generated_at?: string
          learned_preferences?: Json
          next_best_actions?: Json
          user_id: string
        }
        Update: {
          confidence?: number
          generated_at?: string
          learned_preferences?: Json
          next_best_actions?: Json
          user_id?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          auto_submit_enabled: boolean
          min_match_score: number
          require_approval: boolean
          scan_enabled: boolean
          scan_frequency: string
          scan_sources: string[]
          scan_time: string
          submission_mode: string
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_submit_enabled?: boolean
          min_match_score?: number
          require_approval?: boolean
          scan_enabled?: boolean
          scan_frequency?: string
          scan_sources?: string[]
          scan_time?: string
          submission_mode?: string
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_submit_enabled?: boolean
          min_match_score?: number
          require_approval?: boolean
          scan_enabled?: boolean
          scan_frequency?: string
          scan_sources?: string[]
          scan_time?: string
          submission_mode?: string
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      worker_operations: {
        Row: {
          attempt_count: number
          completed_at: string | null
          created_at: string
          id: string
          idempotency_key: string
          last_error_code: string | null
          last_error_message: string | null
          lease_until: string | null
          operation_id: string
          queue_name: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key: string
          last_error_code?: string | null
          last_error_message?: string | null
          lease_until?: string | null
          operation_id: string
          queue_name: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string
          last_error_code?: string | null
          last_error_message?: string | null
          lease_until?: string | null
          operation_id?: string
          queue_name?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      worker_provisioning_locks: {
        Row: {
          created_at: string
          lease_until: string
          lock_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          lease_until: string
          lock_token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          lease_until?: string
          lock_token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      worker_sessions: {
        Row: {
          auth_session_id: string
          created_at: string
          provisioned_at: string | null
          revoked_at: string | null
          token_vault_ref: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auth_session_id: string
          created_at?: string
          provisioned_at?: string | null
          revoked_at?: string | null
          token_vault_ref: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auth_session_id?: string
          created_at?: string
          provisioned_at?: string | null
          revoked_at?: string | null
          token_vault_ref?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acquire_worker_provisioning_lock: {
        Args: {
          p_lease_seconds?: number
          p_lock_token: string
          p_user_id: string
        }
        Returns: boolean
      }
      claim_worker_operation: {
        Args: {
          p_idempotency_key: string
          p_operation_id: string
          p_queue_name: string
        }
        Returns: boolean
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      release_worker_provisioning_lock: {
        Args: { p_lock_token: string; p_user_id: string }
        Returns: boolean
      }
      worker_current_context: {
        Args: never
        Returns: {
          user_id: string
          worker_enabled: boolean
        }[]
      }
    }
    Enums: {
      application_status:
        | "discovered"
        | "analyzing"
        | "matched"
        | "pending_approval"
        | "approved"
        | "generating_resume"
        | "ready_to_submit"
        | "submitting"
        | "submitted"
        | "interviewing"
        | "offer_received"
        | "rejected"
        | "withdrawn"
        | "manual_assist"
        | "failed"
      employment_type:
        | "full_time"
        | "part_time"
        | "contract"
        | "freelance"
        | "internship"
        | "temporary"
        | "other"
      execution_status:
        | "pending"
        | "running"
        | "success"
        | "failed"
        | "fallback"
        | "retrying"
      execution_type:
        | "scraping"
        | "pre_filtering"
        | "ai_matching"
        | "resume_generation"
        | "pdf_generation"
        | "email_submission"
        | "form_submission"
        | "manual_assist"
        | "status_sync"
        | "system"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      application_status: [
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
      ],
      employment_type: [
        "full_time",
        "part_time",
        "contract",
        "freelance",
        "internship",
        "temporary",
        "other",
      ],
      execution_status: [
        "pending",
        "running",
        "success",
        "failed",
        "fallback",
        "retrying",
      ],
      execution_type: [
        "scraping",
        "pre_filtering",
        "ai_matching",
        "resume_generation",
        "pdf_generation",
        "email_submission",
        "form_submission",
        "manual_assist",
        "status_sync",
        "system",
      ],
    },
  },
} as const
