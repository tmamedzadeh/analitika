# ZIRVƏ reliability, explicit search and classified bulletins

2026-10-22, Asia/Baku. Based on main `567c3219d3a3873d369ddae6fd09fa16d8b00e0a`. Production acceptance is pending actual deployed-revision and runtime checks.

## Gemini incident and policy

For request `0ba183f6-3bbb-4ca8-909c-b05aa2ccce5f`, the supplied evidence establishes two primary HTTP 503s and a third attempt starting. There is no retained terminal provider chain here proving whether that attempt timed out, failed again or was cancelled. The code did permit three primary attempts inside a shared 60-second generation/fallback signal; expiry aborted the whole route before fallback could continue. This is a confirmed code-level failure mechanism, not a reconstructed terminal diagnosis for that historical request.

An explicit 503 now permits at most one same-model retry, with delay at most 1 second and more than delay + 5 seconds left. Otherwise it immediately yields to the next distinct configured model: primary → light → optional backup. Provider Retry-After above the short unavailable-retry bound skips the retry. 429 Retry-After, daily quota cooldown and terminal billing/auth/request policy remain intact; 503 is never a quota error. SDK retries remain disabled, model IDs are deduplicated, and routing terminates after the configured models. Aborting the user request prevents further provider calls.

Analytics generation has no additional fixed 60-second cap. Retrieval, history setup, generation, retry waits, fallback and the single validation retry share **105 seconds from request start**. Client remains **115 seconds**, Vercel analytics function remains **120 seconds**. A pending reasoning call can use the entire remainder; absence of tokens does not trigger fallback. This intentionally cannot guarantee another model after a genuinely long call exhausts the deadline. Longer requests require an asynchronous execution design, outside this change.

Other callers that explicitly set both `timeoutMs` and `deadlineAt` get a model-local timeout signal separate from the overall signal, allowing another model within the remaining deadline. Legacy callers setting only `timeoutMs` keep their total request timeout. Safe diagnostics retain correlation ID, model, provider status, attempt/retry/fallback metadata, timeout scope and actual completing model. No prompts, source bodies, API keys or raw provider responses are logged. Exhausted 503 routes produce the localized provider-unavailable message only in generation; source-access/validation failures retain their own stage and generic error. SSE terminal and history status protections remain.

## Catalog submission

Both `/` and `/senedler` use draft/submitted state and a native search form. Enter and Axtar submit trimmed text; typing and clearing do not submit. Filters use the last submitted query, and query-key changes reset pagination for the new search. Duplicate submissions keep the existing query, without duplicate calls. The shared lexical core is unchanged. Existing document status polling remains independent.

## Schema, preservation and release order

`drizzle/0024_brief_classification.sql`, snapshot `0024`, and journal entry 24 add `daily_briefs.classification TEXT NOT NULL DEFAULT 'open'` plus the four-value CHECK. Applied migrations 0000–0023 were not edited or reapplied. The owner confirmed a current backup before application.

**Migration: APPLIED** through `bun run db:migrate`. [Preflight](BRIEF_CLASSIFICATION_PREFLIGHT.json) verifies matching configured runtime/migration targets, all 24 historical journal hashes, native schema/RLS and TEMP-table legacy/default/null/invalid-value tests. [Post-application evidence](BRIEF_CLASSIFICATION_MIGRATION.json) verifies all 25 journal entries and the migrated schema. All **10 existing bulletins are open**, zero invalid classifications; the digest of every other bulletin column is identical before/after. Counts remain **14 documents, 108 chunks, 0 bulletin attachments**. No corpus reset, reseed or reindex occurred.

Schema was deployed before application code; the additive migration gives old runtimes only open existing rows. Do not introduce real restricted content or classify existing real content until the deployed reader/attachment/API revision is verified. Integration fixtures are invented and scoped to their own IDs. During rollback, retain the additive column and roll forward with a corrected application. An old application without classification checks may be used only after confirming every bulletin is open and classified writers are disabled; do not drop the column or automatically declassify data to roll back.

## Enforced access paths

`briefAccessFilter` delegates to the existing shared classification predicate, reading active status and clearance from the DB in the data query. Hierarchy is open < secret < top_secret < special. Admin and author roles do not raise that ceiling. Document RBAC is unchanged.

- Bulletin catalog, lexical search, pagination, photo counts and cover IDs.
- Direct UUID details, highlighted chunks and previous/next navigation.
- Private attachment HTTP routes: both document and bulletin reads hold user/source share locks while buffering bounded files, then return private/no-store responses.
- Analitika vector, FTS and trigram candidates, candidate recheck before rerank, and attachment counts.
- Source rechecks before prompts and publication; actual current classification is propagated into previews and snapshots.
- History list metadata and detail/answer/source/chunk previews. Current brief restrictions also hide legacy open snapshots after a clearance downgrade or classification upgrade.
- Upload preparation and save validate live active clearance and current author/admin authority; locks protect role/clearance and source reads within transactions. Save retains optimistic version checks. Lowering a bulletin's classification is admin-only and still requires access to its current classification.
- Delete requires live admin authority and the same clearance ceiling. Trusted background indexing keeps system access.

Editor choices come from the live account; new records default to open, existing records retain their classification, previews/cards/details share document labels and badge styling. Classification-only edits preserve index state/chunks and emit no indexing request. Access changes immediately through the parent row without waiting for reindexing.

Historical policy note: this report originally recorded authorization limited to the test corpus. The owner subsequently authorized Gemini for user-accessible materials at all classifications in Phase 2a. Current policy and transaction boundaries are documented in [Executive Analytics V1](../analytics-v1.md). Original integration evidence below records its own execution time and does not establish current production readiness.

## Validation and production boundary

The exact release tree passes **313 tests in 55 files**, TypeScript and ESLint (zero errors, one pre-existing `ui/button.tsx` Fast Refresh warning), and a production build. [Database integration](CLASSIFIED_BRIEFS_INTEGRATION.json) verifies the four-level user/admin matrix, actual create/save, stale authority, classification-only edits, source/history revocation, deactivation and direct photo denial. [Desktop/mobile browser evidence](EXPLICIT_SEARCH_BROWSER.json) covers both catalogs at 1440px/390px, Enter/Axtar/clear/duplicate behavior and classification editor/preview/save/detail. The integration script injects vectors and disables rerank: it makes no external AI calls. All fixtures use newly generated IDs and exact cleanup; real corpus rows are never removed.

`src/routes/_app.axtaris.tsx` had unrelated local edits on arrival and changed further during this task; a separate `src/components/ui/button.tsx` style edit appeared during final review. Both remain untouched and excluded from the release. The analytics draft's removed synthesis heading causes one existing layout test to fail in the combined worktree, and its indentation causes five formatting errors there. Release gates were therefore run in an isolated copy containing the original main versions of those files plus this task's exact changes: all 313 tests and all gates pass there. The original workspace retains the user's edits.

Before Production GO, verify the actual Vercel revision and deployed environment, current Gemini generation/fallback, SSE terminal/history metadata and long-answer behavior, classified catalog/direct-photo/history access, and trusted worker registration/runtime. A successful build, push or Vercel check alone is insufficient. No live historical provider logs or authenticated Vercel deployment inspection were available in this task.
