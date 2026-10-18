# Decisions and accepted risks

## v1.1 implementation decisions

- Analytics answers use a medium thinking level by default, a 1,200-token output ceiling, and normalize grouped or ranged citations before rendering the final answer. The streamed draft remains unmodified until the final event.
- The application shell lives in a pathless route layout. Search history polling stops when there are no queued or running jobs.
- Briefs are always published when saved. Existing brief rows are migrated to `published`; briefs without a ready index are queued for reindexing.
- Upload preparation returns identifiers and signed storage URLs without creating database drafts. Save verifies size, MIME type, and file signature before persisting metadata and starting indexing. A daily job removes unreferenced uploads older than 24 hours.
- Rate limits are stored in Postgres using atomic fixed-window upserts. OSINT runs with the same cache key are deduplicated. Worker concurrency is capped per Inngest function.
- OSINT heartbeats are written with progress updates. A run stale for more than four minutes is closed by reads and a five-minute cron. Runs with saved sources keep a partial result; runs without sources fail.
- Full-text search uses up to twelve sanitized Unicode tokens joined with OR, plus prefix matching for tokens longer than five characters. The `chunks.text` trigram branch and GIN index remain until an evaluation can establish that removing them does not reduce recall.
- The database pool defaults to three connections and allows a validated `DATABASE_POOL_MAX` override. Recent document rows read a stored `chunk_count`; indexing updates it and the migration backfills existing documents.
- Inngest uses the SDK request-signature verifier for GET, registration, and execution. Unauthenticated sync is disabled for the production serve handler.
- HTML decoding honors a supported response-header charset first, then an HTML charset declaration in the first 4 KiB, then UTF-8. Pinned DNS lookup supports both Node single-address and `{ all: true }` callback shapes.
- Analytics SSE streams send comment keepalives every 15 seconds; the browser aborts a stalled search after 100 seconds. The Vercel analytics function gets a 120-second maximum runtime.
- In production, missing `DEMO_BASIC_AUTH` returns 503. Credential bytes are compared with a fixed-size timing-safe comparison.
- Deleting a document sets `info_requests.answer_document_id` to null so the request record survives.

## Accepted risks and deferred work

- Supabase row-level security is deferred to v2; current access filtering remains application-enforced.
- Document classification remains deferred to v2.
- Detailed operational logging remains deferred. Error details are currently redacted in worker logs to avoid exposing user content.
- The model for final OSINT synthesis remains a deployment choice and is not fixed by this change.
- The in-process Gemini concurrency limiter is best-effort across multiple server instances.
- The requested seeded retrieval comparison could not be completed in this environment: `db:verify:search` stopped with an AI SDK retry error before producing retrieval or answer metrics. The evaluator logs only aggregate metrics. A retry would send the seeded query and retrieved database source text to the configured Gemini provider; automatic review denied that transfer, so explicit operator approval is required before retrying. The trigram path is retained pending a successful before/after evaluation.
