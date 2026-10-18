ALTER TABLE "osint_runs" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "osint_sources" ADD COLUMN "fetch_status" text DEFAULT 'snippet_fallback' NOT NULL;--> statement-breakpoint
CREATE INDEX "osint_runs_pinned_cache_idx" ON "osint_runs" USING btree ("cache_key","created_at");--> statement-breakpoint
ALTER TABLE "osint_sources" ADD CONSTRAINT "osint_sources_fetch_status_check" CHECK (fetch_status IN ('provider_text', 'fetched_full', 'snippet_fallback', 'robots_denied', 'dns_or_network_error', 'http_error', 'non_html', 'timeout', 'invalid_url'));