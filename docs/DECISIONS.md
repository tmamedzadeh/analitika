# Decisions and accepted risks

## v1.1 implementation decisions

- Analytics answers use medium thinking, a 4,096-token initial ceiling and 6,144-token validation retry ceiling. Only validated final output is published; structural/excerpt/numeric checks do not prove semantic entailment.
- The application shell lives in a pathless route layout. Search history polling stops when there are no queued or running jobs.
- Briefs are always published when saved. Existing brief rows are migrated to `published`; briefs without a ready index are queued for reindexing.
- Upload preparation returns user-scoped temporary keys and signed PUT URLs without database drafts. Save reads bounded bytes, verifies size/MIME/signature and writes separate server-only committed objects before metadata and indexing. Temporary PUT reuse and discard cannot mutate committed images. Daily cleanup removes unreferenced objects older than 24 hours.
- Rate limits are stored in Postgres using atomic fixed-window upserts. Worker concurrency is capped per Inngest function.
- Full-text search uses up to twelve sanitized Unicode tokens joined with OR, plus prefix matching for tokens longer than five characters. The `chunks.text` trigram branch and GIN index remain until an evaluation can establish that removing them does not reduce recall.
- The database pool defaults to three connections and allows a validated `DATABASE_POOL_MAX` override. Recent document rows read a stored `chunk_count`; indexing updates it and the migration backfills existing documents.
- Inngest uses the SDK request-signature verifier for GET, registration, and execution. Unauthenticated sync is disabled for the production serve handler.
- Analytics SSE streams send comment keepalives every 15 seconds; the browser aborts a stalled search after 100 seconds. The Vercel analytics function gets a 120-second maximum runtime.
- Application access uses individual accounts and database-backed sessions. Vercel Deployment Protection remains a separate platform setting.
- Migration 0022 enables RLS and revokes client/PUBLIC grants on all 15 app tables. The trusted server DB role retains access; application guards remain required. Native drift after 0023 passed.
- Analytics history stores query and answer text for `ANALYTICS_HISTORY_DAYS` (90 days by default). Only the author and administrators can view a record; record and source access are checked again when it is opened.
- Document content access always applies the hard clearance ceiling `open < secret < top_secret < special`. Ownership and administrator role do not grant access above the user's clearance. Individual document sharing is not part of the MVP. Management permissions are evaluated separately. Uploads cannot exceed the uploader's clearance.
- Migration `0014` mapped existing documents, briefs, and legacy source runs to the earliest-created administrator before adding owner foreign keys. Migration `0017` retires the source-run schema. When multiple administrators exist, the earliest `created_at` wins.
- Migration `0018` removes information requests, individual document-user sharing, and tag metadata. Search-history rows are retained; only legacy `tag` and `tags` filter keys are stripped.
- `drizzle/meta/0013_snapshot.json` records the schema already represented by migration journal entry `0013_auth_users_sessions`; only new schema changes are added in later migrations.

## Accepted risks and deferred work

- External AI is open-only by default. Without a separate V1 question classification field, the question uses the live user's clearance; higher-clearance questions stay in lexical retrieval unless an approved external policy permits them. Document/source checks alone are insufficient.
- Gemini gateway owns quota/Retry-After attempts; SDK automatic retries are disabled. A generation timeout includes queueing, retries and waits. Concurrency remains process-local.
- Real production revision, cloud event processing and scheduled recovery require post-deployment evidence. Local HTTP/controlled provider checks cannot establish those facts.
- Detailed operational logging remains deferred. Error details are currently redacted in worker logs to avoid exposing user content.
- The in-process Gemini concurrency limiter is best-effort across multiple server instances.
- The seeded retrieval comparison completed on 2026-10-18 after explicit user authorization to send the test query and retrieved fragments to Gemini. The evaluator and overlap diagnostic logged only aggregate metrics. Against the `main` implementation, full-text plus trigram returned 10 sources with both expected kinds and 9/10 source-level overlap (0.90 recall relative to baseline). A temporary full-text plus vector run without trigram also had 9/10 overlap. Since the comparison lost one baseline source, keep the trigram branch and GIN index. This is a single-query seeded comparison, not a broad relevance benchmark.
- One generated answer per path measured 16 words/one cited source/valid citations for baseline, 14 words/no cited sources/invalid citations for full-text plus trigram, and 17 words/one cited source/valid citations without trigram. These single-run generation metrics vary and all answers were below the requested 150–400 word target; they are not the retrieval recall measure.
