CREATE TABLE "brief_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"ord" integer NOT NULL,
	CONSTRAINT "brief_attachments_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "brief_attachments_brief_ord_unique" UNIQUE("brief_id","ord"),
	CONSTRAINT "brief_attachments_mime_check" CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "brief_attachments_size_check" CHECK (size > 0 AND size <= 10485760),
	CONSTRAINT "brief_attachments_ord_check" CHECK (ord >= 0 AND ord < 10)
);
--> statement-breakpoint
CREATE TABLE "daily_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief_date" date NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"author_id" text DEFAULT 'admin' NOT NULL,
	"index_status" text DEFAULT 'none' NOT NULL,
	"index_progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "daily_briefs_brief_date_unique" UNIQUE("brief_date"),
	CONSTRAINT "daily_briefs_body_length_check" CHECK (char_length(body) <= 200000),
	CONSTRAINT "daily_briefs_status_check" CHECK (status IN ('draft', 'published')),
	CONSTRAINT "daily_briefs_index_status_check" CHECK (index_status IN ('none', 'queued', 'processing', 'ready', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "chunks" ALTER COLUMN "document_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "brief_id" uuid;--> statement-breakpoint
ALTER TABLE "brief_attachments" ADD CONSTRAINT "brief_attachments_brief_id_daily_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."daily_briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brief_attachments_brief_idx" ON "brief_attachments" USING btree ("brief_id");--> statement-breakpoint
CREATE INDEX "daily_briefs_status_date_idx" ON "daily_briefs" USING btree ("status","brief_date");--> statement-breakpoint
CREATE INDEX "daily_briefs_title_trgm_idx" ON "daily_briefs" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "daily_briefs_body_trgm_idx" ON "daily_briefs" USING gin ("body" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_brief_id_daily_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."daily_briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunks_brief_idx" ON "chunks" USING btree ("brief_id");--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_brief_ord_unique" UNIQUE("brief_id","ord");--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_source_check" CHECK ((document_id IS NOT NULL AND brief_id IS NULL) OR (document_id IS NULL AND brief_id IS NOT NULL));