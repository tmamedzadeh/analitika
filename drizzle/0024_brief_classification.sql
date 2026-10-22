ALTER TABLE "daily_briefs" ADD COLUMN "classification" text DEFAULT 'open' NOT NULL;
--> statement-breakpoint
ALTER TABLE "daily_briefs" ADD CONSTRAINT "daily_briefs_classification_check" CHECK (classification IN ('open', 'secret', 'top_secret', 'special'));
