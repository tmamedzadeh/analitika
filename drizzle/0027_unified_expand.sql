-- Fail closed. This check never changes a bulletin's classification.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.daily_briefs WHERE classification IS DISTINCT FROM 'open') THEN
    RAISE EXCEPTION 'Non-open bulletins exist. Stop rollout and review; automatic declassification is forbidden.';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "source_reliability" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "source_reliability" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "info_credibility" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "info_credibility" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "image_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "brief_attachments" ADD COLUMN "image_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "daily_briefs" ADD CONSTRAINT "daily_briefs_open_only" CHECK (classification = 'open');