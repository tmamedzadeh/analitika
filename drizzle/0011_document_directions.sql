ALTER TABLE "documents" ADD COLUMN "direction" text;
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_direction_check" CHECK (
  direction IS NULL OR direction IN (
    'HUMINT', 'OSINT', 'IMINT', 'SIGINT', 'CYBINT',
    'GEOINT', 'MASINT', 'TECHINT', 'FININT', 'TACINT_CI'
  )
);
--> statement-breakpoint
CREATE INDEX "documents_direction_idx" ON "documents" USING btree ("direction");
