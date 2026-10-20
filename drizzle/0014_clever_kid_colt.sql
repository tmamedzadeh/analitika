CREATE TYPE "public"."analytics_query_status" AS ENUM('running', 'done', 'incomplete', 'failed', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."osint_run_status" ADD VALUE 'partial' BEFORE 'failed';--> statement-breakpoint
CREATE TABLE "analytics_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by" text NOT NULL,
	"query" text NOT NULL,
	"filters" jsonb NOT NULL,
	"status" "analytics_query_status" DEFAULT 'running' NOT NULL,
	"answer" text,
	"sources" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"max_classification" text DEFAULT 'open' NOT NULL,
	"model" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "osint_query_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"result" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DROP INDEX "osint_runs_active_cache_key_unique_idx";--> statement-breakpoint
ALTER TABLE "daily_briefs" ALTER COLUMN "author_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "owner_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "osint_sources" ALTER COLUMN "summary" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "osint_sources" ALTER COLUMN "summary" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_briefs" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "osint_runs" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "osint_runs" ADD COLUMN "cloned_from_run_id" uuid;--> statement-breakpoint
DO $$
DECLARE
	admin_id text;
BEGIN
	SELECT id INTO admin_id
	FROM app_users
	WHERE role = 'admin'
	ORDER BY created_at, id
	LIMIT 1;

	IF admin_id IS NULL AND (
		EXISTS (SELECT 1 FROM documents)
		OR EXISTS (SELECT 1 FROM daily_briefs)
		OR EXISTS (SELECT 1 FROM osint_runs)
	) THEN
		RAISE EXCEPTION 'An administrator account is required to assign existing records.';
	END IF;

	IF admin_id IS NOT NULL THEN
		UPDATE documents
		SET owner_id = admin_id
		WHERE owner_id = 'admin'
			OR NOT EXISTS (SELECT 1 FROM app_users WHERE app_users.id = documents.owner_id);

		UPDATE daily_briefs
		SET author_id = admin_id
		WHERE author_id = 'admin'
			OR NOT EXISTS (SELECT 1 FROM app_users WHERE app_users.id = daily_briefs.author_id);

		UPDATE daily_briefs
		SET updated_by = author_id
		WHERE updated_by IS NULL;

		UPDATE osint_runs SET created_by = admin_id;
	END IF;

	DELETE FROM document_acl
	WHERE NOT EXISTS (SELECT 1 FROM app_users WHERE app_users.id = document_acl.user_id);
END $$;--> statement-breakpoint
ALTER TABLE "osint_runs" ALTER COLUMN "created_by" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "analytics_queries" ADD CONSTRAINT "analytics_queries_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_queries_created_user_idx" ON "analytics_queries" USING btree ("created_by","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "analytics_queries_created_at_idx" ON "analytics_queries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "osint_query_cache_expires_idx" ON "osint_query_cache" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "daily_briefs" ADD CONSTRAINT "daily_briefs_author_id_app_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_briefs" ADD CONSTRAINT "daily_briefs_updated_by_app_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acl" ADD CONSTRAINT "document_acl_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "osint_runs" ADD CONSTRAINT "osint_runs_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "osint_runs_created_by_idx" ON "osint_runs" USING btree ("created_by","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "osint_runs_active_cache_user_unique_idx" ON "osint_runs" USING btree ("cache_key","created_by") WHERE cache_key IS NOT NULL AND status IN ('queued', 'running');
