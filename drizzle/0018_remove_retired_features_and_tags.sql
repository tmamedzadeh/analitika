DROP TABLE "document_acl";--> statement-breakpoint
DROP TABLE "request_attachments";--> statement-breakpoint
DROP TABLE "info_requests";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "tags";--> statement-breakpoint
UPDATE "query_logs"
SET "filters" = "filters" - 'tag' - 'tags'
WHERE "filters" ? 'tag' OR "filters" ? 'tags';
