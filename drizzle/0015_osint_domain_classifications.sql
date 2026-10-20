ALTER TYPE "public"."osint_source_type" ADD VALUE 'academic';--> statement-breakpoint
ALTER TYPE "public"."osint_source_type" ADD VALUE 'archive';--> statement-breakpoint
ALTER TYPE "public"."osint_source_type" ADD VALUE 'resolver';--> statement-breakpoint
CREATE TABLE "osint_domain_classifications" (
	"domain" text PRIMARY KEY NOT NULL,
	"type" "osint_source_type" NOT NULL,
	"source" text NOT NULL,
	"classified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "osint_domain_classifications_source_check" CHECK (source IN ('registry', 'model', 'manual'))
);
