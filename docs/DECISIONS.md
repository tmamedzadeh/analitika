# Decisions and accepted risks

## Current V1 implementation decisions (2026-10-22)

- Analytics answers use medium thinking, a 4,096-token initial ceiling and 6,144-token validation retry ceiling. Only validated final output is published; publication checks validate completion, nonempty output and authorized citation membership; they do not establish semantic entailment. Executive reasoning instructions and limitations are documented in [analytics-v1.md](analytics-v1.md).
- The application shell lives in a pathless route layout. Analytics history polling runs while a search is active.
- Briefs are always published when saved. Existing brief rows are migrated to `published`; briefs without a ready index are queued for reindexing.
- Upload preparation returns user-scoped temporary keys and signed PUT URLs without database drafts. Save reads bounded bytes, verifies size/MIME/signature and writes separate server-only committed objects before metadata and indexing. Temporary PUT reuse and discard cannot mutate committed images. Daily cleanup removes unreferenced objects older than 24 hours.
- Rate limits are stored in Postgres using atomic fixed-window upserts. Worker concurrency is capped per Inngest function.
- [Shared lexical search](search-v1.md) handles Azerbaijani normalization, bounded variants/prefixes/typos and country anchors. Bulletin and document catalogs require all groups and call no LLM. Analitika keeps hybrid retrieval, lexical OR recall, vectors, trigram and RRF; ranking and indexes are unchanged by executive hardening.
- The database pool defaults to three connections and allows a validated `DATABASE_POOL_MAX` override. Recent document rows read a stored `chunk_count`; indexing updates it and the migration backfills existing documents.
- Inngest uses the SDK request-signature verifier for GET, registration, and execution. Unauthenticated sync is disabled for the production serve handler.
- Analytics SSE streams send comment keepalives every 15 seconds; the server budget is 105 seconds from request start and the browser budget is 115 seconds, allowing terminal SSE delivery. The Vercel analytics function gets a 120-second maximum runtime.
- Application access uses individual accounts and database-backed sessions. Vercel Deployment Protection remains a separate platform setting.
- Migration 0022 enables RLS and revokes client/PUBLIC grants on all 15 app tables. The trusted server DB role retains access; application guards remain required. Native drift after 0023 passed.
- Analytics history stores query and answer text for `ANALYTICS_HISTORY_DAYS` (90 days by default). Only the author and administrators can view a record; record and source access are checked again when it is opened.
- Document content access always applies the hard clearance ceiling `open < secret < top_secret < special`. Ownership and administrator role do not grant access above the user's clearance. Individual document sharing is not part of the MVP. Management permissions are evaluated separately. Uploads cannot exceed the uploader's clearance.
- Migration `0014` mapped existing documents, briefs, and legacy source runs to the earliest-created administrator before adding owner foreign keys. Migration `0017` retires the source-run schema. When multiple administrators exist, the earliest `created_at` wins.
- Migration `0018` removes information requests, individual document-user sharing, and tag metadata. Search-history rows are retained; only legacy `tag` and `tags` filter keys are stripped.
- `drizzle/meta/0013_snapshot.json` records the schema already represented by migration journal entry `0013_auth_users_sessions`; only new schema changes are added in later migrations.

## Accepted risks and deferred work

- The owner authorizes Gemini for user-accessible material at every classification. Runtime does not read/enforce `AI_EXTERNAL_ALLOWED_CLASSIFICATIONS` or `AI_EXTERNAL_POLICY_REFERENCE`. Active-account, role, clearance and source checks still protect read access. Query embeddings, configured reranking and generation run outside DB transactions; short authorization checks precede actual dispatches/retries/fallback and final publication. A later revocation suppresses publication but cannot recall already dispatched provider input. Live verification still needs separate authorization and corpus-preserving test isolation.
- Gemini gateway owns quota/Retry-After attempts; SDK automatic retries are disabled. A generation timeout includes queueing, retries and waits. Concurrency remains process-local.
- Real production revision, cloud event processing and scheduled recovery require post-deployment evidence. Local HTTP/controlled provider checks cannot establish those facts.
- Detailed operational logging remains deferred. Error details are currently redacted in worker logs to avoid exposing user content.
- The in-process Gemini concurrency limiter is best-effort across multiple server instances.
## Historical evaluation observations (2026-10-18)

These records describe the then-current prompts and transport, including retired length targets. They are not current answer requirements.

- The seeded retrieval comparison completed on 2026-10-18 after explicit user authorization to send the test query and retrieved fragments to Gemini. The evaluator and overlap diagnostic logged only aggregate metrics. Against the `main` implementation, full-text plus trigram returned 10 sources with both expected kinds and 9/10 source-level overlap (0.90 recall relative to baseline). A temporary full-text plus vector run without trigram also had 9/10 overlap. Since the comparison lost one baseline source, keep the trigram branch and GIN index. This is a single-query seeded comparison, not a broad relevance benchmark.
- One generated answer per path measured 16 words/one cited source/valid citations for baseline, 14 words/no cited sources/invalid citations for full-text plus trigram, and 17 words/one cited source/valid citations without trigram. These single-run generation metrics vary and all answers were below the requested 150–400 word target; they are not the retrieval recall measure.
