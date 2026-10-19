ALTER TABLE "osint_runs" ADD COLUMN "structured_report" jsonb;
--> statement-breakpoint
ALTER TABLE "osint_sources" ADD COLUMN "structured_summary" jsonb;
--> statement-breakpoint
ALTER TABLE "osint_sources" ADD COLUMN "providers" text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "osint_sources" ADD COLUMN "provider_rank" integer;
--> statement-breakpoint
ALTER TABLE "osint_sources" ADD COLUMN "affiliation" text;
--> statement-breakpoint
ALTER TYPE "osint_source_type" ADD VALUE IF NOT EXISTS 'state_media';
--> statement-breakpoint
ALTER TYPE "osint_source_type" ADD VALUE IF NOT EXISTS 'independent_media';
--> statement-breakpoint
ALTER TYPE "osint_source_type" ADD VALUE IF NOT EXISTS 'public_broadcaster';
--> statement-breakpoint
ALTER TYPE "osint_source_type" ADD VALUE IF NOT EXISTS 'international_media';
--> statement-breakpoint
ALTER TYPE "osint_source_type" ADD VALUE IF NOT EXISTS 'agency';
--> statement-breakpoint
ALTER TYPE "osint_source_type" ADD VALUE IF NOT EXISTS 'domestic_media';
--> statement-breakpoint
CREATE TABLE "osint_page_cache" (
	"normalized_url" text PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"title" text,
	"published_at" timestamp with time zone,
	"language" text,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "osint_page_cache_expires_idx" ON "osint_page_cache" USING btree ("expires_at");
--> statement-breakpoint
ALTER TABLE "osint_runs" ADD COLUMN "cache_bypass" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE "osint_search_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"language" text NOT NULL,
	"period" text NOT NULL,
	"include_domains" text[] DEFAULT '{}' NOT NULL,
	"results" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "osint_search_cache_expires_idx" ON "osint_search_cache" USING btree ("expires_at");
