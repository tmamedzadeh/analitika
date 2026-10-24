-- Fail closed. This check never changes a bulletin's classification.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.daily_briefs WHERE classification IS DISTINCT FROM 'open') THEN
    RAISE EXCEPTION 'Non-open bulletins exist. Stop rollout and review; automatic declassification is forbidden.';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "daily_briefs" DROP CONSTRAINT "daily_briefs_classification_check";--> statement-breakpoint
ALTER TABLE "daily_briefs" DROP CONSTRAINT "daily_briefs_open_only";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_source_reliability_check";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_info_credibility_check";--> statement-breakpoint
ALTER TABLE "daily_briefs" DROP COLUMN "classification";--> statement-breakpoint
-- Preserve unrated meaning; never promote legacy ratings.
UPDATE "documents" SET "source_reliability" = NULL WHERE "source_reliability" = 'F';
--> statement-breakpoint
UPDATE "documents" SET "info_credibility" = NULL WHERE "info_credibility" = 6;
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_source_reliability_check" CHECK (source_reliability IS NULL OR source_reliability IN ('A', 'B', 'C', 'D', 'E'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_info_credibility_check" CHECK (info_credibility IS NULL OR info_credibility BETWEEN 1 AND 5);