ALTER TABLE "osint_page_cache" ADD COLUMN IF NOT EXISTS "original_language" text;--> statement-breakpoint
ALTER TABLE "osint_sources" ADD COLUMN IF NOT EXISTS "original_language" text;
