CREATE TABLE IF NOT EXISTS "memory_extraction_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"binding_id" uuid NOT NULL,
	"binding_key" text NOT NULL,
	"operation_type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"source_agent_id" uuid,
	"source_issue_id" uuid,
	"source_project_id" uuid,
	"source_goal_id" uuid,
	"source_heartbeat_run_id" uuid,
	"hook_kind" text,
	"provider_job_id" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"attribution_mode" text DEFAULT 'untracked' NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"result_summary" text,
	"error_code" text,
	"error" text,
	"source_kind" text NOT NULL,
	"source_ref_json" jsonb,
	"retry_of_job_id" uuid,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"dispatcher_kind" text DEFAULT 'in_process' NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"usage_json" jsonb,
	"result_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS "issues_open_routine_execution_uq";--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "origin_fingerprint" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "routine_runs" ADD COLUMN IF NOT EXISTS "dispatch_fingerprint" text;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'memory_extraction_jobs_company_id_companies_id_fk'
		  AND conrelid = 'memory_extraction_jobs'::regclass
	) THEN
		ALTER TABLE "memory_extraction_jobs" ADD CONSTRAINT "memory_extraction_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'memory_extraction_jobs_source_agent_id_agents_id_fk'
		  AND conrelid = 'memory_extraction_jobs'::regclass
	) THEN
		ALTER TABLE "memory_extraction_jobs" ADD CONSTRAINT "memory_extraction_jobs_source_agent_id_agents_id_fk" FOREIGN KEY ("source_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'memory_extraction_jobs_source_issue_id_issues_id_fk'
		  AND conrelid = 'memory_extraction_jobs'::regclass
	) THEN
		ALTER TABLE "memory_extraction_jobs" ADD CONSTRAINT "memory_extraction_jobs_source_issue_id_issues_id_fk" FOREIGN KEY ("source_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'memory_extraction_jobs_source_project_id_projects_id_fk'
		  AND conrelid = 'memory_extraction_jobs'::regclass
	) THEN
		ALTER TABLE "memory_extraction_jobs" ADD CONSTRAINT "memory_extraction_jobs_source_project_id_projects_id_fk" FOREIGN KEY ("source_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'memory_extraction_jobs_source_goal_id_goals_id_fk'
		  AND conrelid = 'memory_extraction_jobs'::regclass
	) THEN
		ALTER TABLE "memory_extraction_jobs" ADD CONSTRAINT "memory_extraction_jobs_source_goal_id_goals_id_fk" FOREIGN KEY ("source_goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'memory_extraction_jobs_source_heartbeat_run_id_heartbeat_runs_id_fk'
		  AND conrelid = 'memory_extraction_jobs'::regclass
	) THEN
		ALTER TABLE "memory_extraction_jobs" ADD CONSTRAINT "memory_extraction_jobs_source_heartbeat_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("source_heartbeat_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'memory_extraction_jobs_retry_of_job_id_memory_extraction_jobs_id_fk'
		  AND conrelid = 'memory_extraction_jobs'::regclass
	) THEN
		ALTER TABLE "memory_extraction_jobs" ADD CONSTRAINT "memory_extraction_jobs_retry_of_job_id_memory_extraction_jobs_id_fk" FOREIGN KEY ("retry_of_job_id") REFERENCES "public"."memory_extraction_jobs"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_extraction_jobs_company_status_submitted_idx" ON "memory_extraction_jobs" USING btree ("company_id","status","submitted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_extraction_jobs_company_binding_submitted_idx" ON "memory_extraction_jobs" USING btree ("company_id","binding_key","submitted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_extraction_jobs_company_operation_submitted_idx" ON "memory_extraction_jobs" USING btree ("company_id","operation_type","submitted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_extraction_jobs_company_issue_submitted_idx" ON "memory_extraction_jobs" USING btree ("company_id","source_issue_id","submitted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_extraction_jobs_company_run_submitted_idx" ON "memory_extraction_jobs" USING btree ("company_id","source_heartbeat_run_id","submitted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_extraction_jobs_company_status_lease_expires_idx" ON "memory_extraction_jobs" USING btree ("company_id","status","lease_expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_extraction_jobs_retry_of_job_idx" ON "memory_extraction_jobs" USING btree ("retry_of_job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routine_runs_dispatch_fingerprint_idx" ON "routine_runs" USING btree ("routine_id","dispatch_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "issues_open_routine_execution_uq" ON "issues" USING btree ("company_id","origin_kind","origin_id","origin_fingerprint") WHERE "issues"."origin_kind" = 'routine_execution'
          and "issues"."origin_id" is not null
          and "issues"."hidden_at" is null
          and "issues"."execution_run_id" is not null
          and "issues"."status" in ('backlog', 'todo', 'in_progress', 'in_review', 'blocked');
