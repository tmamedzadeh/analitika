# Decisions and accepted risks

## v1.1 implementation decisions

- Analytics answers use a medium thinking level by default, a 1,200-token output ceiling, and normalize grouped or ranged citations before rendering the final answer. The streamed draft remains unmodified until the final event.
- The application shell lives in a pathless route layout. Search history polling stops when there are no queued or running jobs.
- Briefs are always published when saved. Existing brief rows are migrated to `published`; briefs without a ready index are queued for reindexing.
- Upload preparation returns identifiers and signed storage URLs without creating database drafts. Save verifies size, MIME type, and file signature before persisting metadata and starting indexing. A daily job removes unreferenced uploads older than 24 hours.
- Rate limits are stored in Postgres using atomic fixed-window upserts. OSINT runs with the same cache key are deduplicated. Worker concurrency is capped per Inngest function.
- OSINT heartbeats are written with progress updates. A run stale for more than four minutes is closed by reads and a fifteen-minute cron; starting, running, and reading a run never depend on the cron. Runs with saved sources keep a partial result; runs without sources fail.
- Full-text search uses up to twelve sanitized Unicode tokens joined with OR, plus prefix matching for tokens longer than five characters. The `chunks.text` trigram branch and GIN index remain until an evaluation can establish that removing them does not reduce recall.
- The database pool defaults to three connections and allows a validated `DATABASE_POOL_MAX` override. Recent document rows read a stored `chunk_count`; indexing updates it and the migration backfills existing documents.
- Inngest uses the SDK request-signature verifier for GET, registration, and execution. Unauthenticated sync is disabled for the production serve handler.
- HTML decoding honors a supported response-header charset first, then an HTML charset declaration in the first 4 KiB, then UTF-8. Pinned DNS lookup supports both Node single-address and `{ all: true }` callback shapes.
- Analytics SSE streams send comment keepalives every 15 seconds; the browser aborts a stalled search after 100 seconds. The Vercel analytics function gets a 120-second maximum runtime.
- Application access uses individual accounts and database-backed sessions. Vercel Deployment Protection remains a separate platform setting.
- Deleting a document sets `info_requests.answer_document_id` to null so the request record survives.
- `app_users` and `app_sessions` live in `public` without RLS in v1. The project's Data API must stay disabled until v2 adds database-side policies.
- Analytics history stores query and answer text for `ANALYTICS_HISTORY_DAYS` (90 days by default). Only the author and administrators can view a record; record and source access are checked again when it is opened.
- Document access always applies the clearance hierarchy `open < secret < top_secret < special`, with an additional allow path for document ACL members and the document owner. Uploads cannot exceed the uploader's clearance.
- Migration `0014` maps existing documents, briefs, and OSINT runs to the earliest-created administrator before adding owner foreign keys. When multiple administrators exist, the earliest `created_at` wins.
- `drizzle/meta/0013_snapshot.json` records the schema already represented by migration journal entry `0013_auth_users_sessions`; only new schema changes are added in later migrations.

## Accepted risks and deferred work

- Supabase row-level security is deferred to v2; current access filtering remains application-enforced.
- Detailed operational logging remains deferred. Error details are currently redacted in worker logs to avoid exposing user content.
- The model for final OSINT synthesis remains a deployment choice and is not fixed by this change.
- The in-process Gemini concurrency limiter is best-effort across multiple server instances.
- The seeded retrieval comparison completed on 2026-10-18 after explicit user authorization to send the test query and retrieved fragments to Gemini. The evaluator and overlap diagnostic logged only aggregate metrics. Against the `main` implementation, full-text plus trigram returned 10 sources with both expected kinds and 9/10 source-level overlap (0.90 recall relative to baseline). A temporary full-text plus vector run without trigram also had 9/10 overlap. Since the comparison lost one baseline source, keep the trigram branch and GIN index. This is a single-query seeded comparison, not a broad relevance benchmark.
- One generated answer per path measured 16 words/one cited source/valid citations for baseline, 14 words/no cited sources/invalid citations for full-text plus trigram, and 17 words/one cited source/valid citations without trigram. These single-run generation metrics vary and all answers were below the requested 150–400 word target; they are not the retrieval recall measure.
