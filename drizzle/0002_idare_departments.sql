ALTER TABLE "documents" ADD COLUMN "department" text;--> statement-breakpoint
CREATE INDEX "documents_department_idx" ON "documents" USING btree ("department");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_department_check" CHECK (department IS NULL OR department IN ('d1', 'd2', 'd3', 'd4', 'd5'));--> statement-breakpoint
UPDATE "info_requests"
SET "department" = CASE "department"
  WHEN 'İdarə 1' THEN 'd1'
  WHEN 'İdarə 2' THEN 'd2'
  WHEN 'İdarə 3' THEN 'd3'
  WHEN 'İdarə 4' THEN 'd4'
  WHEN 'İdarə 5' THEN 'd5'
  ELSE "department"
END;--> statement-breakpoint
ALTER TABLE "info_requests" ADD CONSTRAINT "info_requests_department_check" CHECK (department IN ('d1', 'd2', 'd3', 'd4', 'd5'));
