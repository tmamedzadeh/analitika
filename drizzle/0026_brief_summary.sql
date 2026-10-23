ALTER TABLE "daily_briefs" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "daily_briefs" ADD CONSTRAINT "daily_briefs_summary_length_check" CHECK (char_length(summary) <= 400);