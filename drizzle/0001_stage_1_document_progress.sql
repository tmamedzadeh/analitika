ALTER TABLE "documents" ADD COLUMN "step" text DEFAULT 'queued' NOT NULL;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "progress" jsonb DEFAULT '{}'::jsonb NOT NULL;
