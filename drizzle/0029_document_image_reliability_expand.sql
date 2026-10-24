CREATE TABLE "document_creations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"creation_key" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"state" text DEFAULT 'saved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_creations_document_id_unique" UNIQUE("document_id"),
	CONSTRAINT "document_creations_actor_key_unique" UNIQUE("actor_id","creation_key"),
	CONSTRAINT "document_creations_state_check" CHECK (state in ('saved','deleted'))
);
--> statement-breakpoint
ALTER TABLE "document_creations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "document_image_uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"client_file_id" uuid NOT NULL,
	"uploader_id" text NOT NULL,
	"ord" integer NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"staging_key" text NOT NULL,
	"error_code" text,
	"lease_id" uuid,
	"lease_until" timestamp with time zone,
	"signed_until" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_image_uploads_client_unique" UNIQUE("document_id","client_file_id"),
	CONSTRAINT "document_image_uploads_ord_unique" UNIQUE("document_id","ord"),
	CONSTRAINT "document_image_uploads_limits" CHECK (ord between 0 and 9 and size between 1 and 10485760 and generation > 0 and mime in ('image/jpeg','image/png','image/webp')),
	CONSTRAINT "document_image_uploads_state_check" CHECK (state in ('pending','uploading','checking','ready','failed','cancelled','expired'))
);
--> statement-breakpoint
ALTER TABLE "document_image_uploads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "image_upload_objects" (
	"key" text PRIMARY KEY NOT NULL,
	"upload_id" uuid,
	"generation" integer NOT NULL,
	"state" text DEFAULT 'protected' NOT NULL,
	"protect_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "image_upload_objects_state_check" CHECK (state in ('protected','published','deleting'))
);
--> statement-breakpoint
ALTER TABLE "image_upload_objects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_creations" ADD CONSTRAINT "document_creations_actor_id_app_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_image_uploads" ADD CONSTRAINT "document_image_uploads_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_image_uploads" ADD CONSTRAINT "document_image_uploads_uploader_id_app_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_upload_objects" ADD CONSTRAINT "image_upload_objects_upload_id_document_image_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."document_image_uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_image_uploads_expiry_idx" ON "document_image_uploads" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "document_image_uploads_uploader_idx" ON "document_image_uploads" USING btree ("uploader_id");--> statement-breakpoint
CREATE INDEX "image_upload_objects_expiry_idx" ON "image_upload_objects" USING btree ("protect_until");
--> statement-breakpoint
-- Trusted server connections only; no client role may use upload receipts or storage keys.
REVOKE ALL ON public.document_creations, public.document_image_uploads, public.image_upload_objects FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE client_role text; BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=client_role) THEN
      EXECUTE format('REVOKE ALL ON public.document_creations, public.document_image_uploads, public.image_upload_objects FROM %I', client_role);
    END IF;
  END LOOP;
END $$;
