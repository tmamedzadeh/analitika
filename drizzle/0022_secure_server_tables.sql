ALTER TABLE "analytics_queries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_login_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brief_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chunks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "daily_briefs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "eval_questions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "eval_results" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "eval_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "eval_sets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "query_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rate_limits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Custom application sessions use the trusted PostgreSQL server connection.
-- Supabase client roles must never access this application's tables directly.
REVOKE ALL PRIVILEGES ON TABLE
  public.analytics_queries, public.app_sessions, public.app_users,
  public.attachments, public.auth_login_attempts, public.brief_attachments,
  public.chunks, public.daily_briefs, public.documents, public.eval_questions,
  public.eval_results, public.eval_runs, public.eval_sets, public.query_logs,
  public.rate_limits FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.analytics_queries, public.app_sessions,
         public.app_users, public.attachments, public.auth_login_attempts,
         public.brief_attachments, public.chunks, public.daily_briefs, public.documents,
         public.eval_questions, public.eval_results, public.eval_runs, public.eval_sets,
         public.query_logs, public.rate_limits FROM %I', client_role
      );
    END IF;
  END LOOP;
END $$;
