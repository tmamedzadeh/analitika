# ZIRVƏ V1 — Phase 2a

22 October 2026, Asia/Baku. Base: `main`, `8edcab6a9885d374c25db8dce25c5df29f9f8e95`, initially clean. This report covers local code and synthetic verification only. No commit, push, deployment, real database/storage operation, indexing event or live AI request was performed.

The technical changes are ready for review. Release verdict remains **NO-GO** because final-prompt semantic acceptance and the historical comparison timeout remain unresolved P1 release blockers. Phase 2b can begin only after owner approval; UX/Progress and Context Expansion were not implemented here.

| Defect / root cause | Phase 2a change | Verification / remaining boundary |
| --- | --- | --- |
| External generation, embedding and rerank callbacks were awaited inside locked DB transactions. | Query access uses a current-account read; source preparation/publication use short transactions with synchronous callbacks. AI calls execute after locks are released. Actual provider dispatches, including retries/fallback, recheck access after request-slot waiting and check abort again before SDK invocation. The live generation verifier follows the same boundaries. | Mock transport asserts transaction depth is zero during embedding, rerank and generation for all classifications. No live PostgreSQL concurrency claim. |
| Candidate authorization checked chunk existence, not its exact retrieved payload. | Shared exact-source checks validate parent, chunk UUID, text and offsets before rerank. Every supplied candidate is rechecked after rerank, including candidates outside the final ten. Final publication revalidates the original citation mapping under short locks. | Replaced/deleted/modified/moved chunks, revoked account/question clearance and changed mappings fail closed in proxy/unit tests. |
| A deadline timer could fire while an awaited driver/provider kept the HTTP/SSE operation pending. History setup began before the timer was installed. | The unchanged absolute 105-second budget covers rate-limit reads, body parsing, history initialization, retrieval, access checks, generation and terminal persistence. Abort-aware waiting rejects even when the underlying operation ignores cancellation; late resolutions/rejections are observed and cannot publish. Error cleanup retains the deadline while waiting for history and closes SSE. | Fake-timer tests cover stalled rate-limit/retrieval/provider/history calls, 75-second reasoning, cancellation, validation retries and terminal events. Client/function budgets remain 115/120 seconds; embedding/rerank budgets and provider routing are unchanged. |
| A late history insert could miss its terminal update; disconnect could race a published final response. | Terminal persistence is ordered after initialization, attempted once, and retains the outcome of an already enqueued final event. Existing running-only update predicates and nondecreasing classification remain intact. | Delayed initialization, stalled persistence and final/disconnect races tested. Persistence remains best-effort after DB outage or process termination; this change does not promise post-termination recovery. |
| Internal M-codes were supplied to the model despite a prompt instruction not to echo them. | Replaced M-labels with the existing citation numbers for fragments of the same typed parent. No citation numbers are added or renumbered. Existing absence-versus-capability, causality, official-status, language and non-boilerplate instructions were retained. | Prompt/context tests and full mocked RAG pass. These tests do not establish semantic correctness of real Gemini answers. |
| An old retrieval verifier expected rerank to be suppressed for secret clearance. Active documentation limited approval to test data. | Verifier now expects enabled rerank. Current docs record owner authorization for all user-accessible classifications while preserving authentication, live role/clearance, per-source filtering and history checks. No runtime classification gate was introduced or removed, because none existed. | Real adapters/search/endpoint run through mock embedding, enabled rerank and generation for open/secret/top_secret/special. No extra AI calls are added. |
| Removed export, ambiguous test query, script typing drift and formatting failures. | Removed the obsolete briefSearchLabel assertion/import while retaining route/embedding assertions; scoped the bulletin badge query; fixed script index-signature access, UUID-array typing and missing fixture classification; formatted the two original lint errors. Vitest alias now uses an ESM-safe URL. Unit setup rejects unmocked fetch. | Main/scripts typechecks pass; lint has no errors and one pre-existing Fast Refresh warning. |
| Historic bulletin browser scenario recorded a combined create/edit/search failure without enough local diagnostics to identify its exact failing operation. | Added isolated real-route create/edit/detail tests with synthetic services. Existing catalog tests cover explicit query submission and empty/search behavior. No UI code was changed to guess at the historical failure. | Mock route checks pass. Shared-DB/S3 browser/E2E and its exact historical root cause remain NOT VERIFIED. |

Authorization remains a point-in-time decision before dispatch. A later revocation cannot recall text already sent to a provider. Fresh guards prevent subsequent attempts when revocation is observed; locked final checks suppress the response. Failed revocation outcomes clear saved answer/source snapshots. History reads retain their existing live authorization and exact-current-chunk checks. Ownership/admin status does not increase clearance.

| Check | Result |
| --- | --- |
| `bun --no-env-file run scripts/test.ts --no-cache --configLoader runner --maxWorkers 2` | PASS: 60 suites, 409 tests in the final full run |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.json` | PASS |
| Same command with `-p tsconfig.eval.json` | PASS; all ten previously reported verification-script errors fixed |
| `node node_modules/eslint/bin/eslint.js . --no-cache` | PASS, 0 errors; existing `src/components/ui/button.tsx` Fast Refresh warning |
| Repository references / final Git diff checks | PASS: 362 files, 201 relative Markdown links, 681 local imports, no reference failures; `git diff --check` passes |
| Live Gemini / provider latency | NOT VERIFIED; explicitly not authorized in Phase 2a |
| Database concurrency, integration, storage and full browser/E2E | NOT VERIFIED; no shared-corpus writes or service calls were made |
| Production build / desktop-mobile visual QA | Deferred to the appropriate later phase; not executed in Phase 2a |
| Vercel and Inngest production verification | **ПРОВЕРЯЕТ ВЛАДЕЛЕЦ / OWNER VERIFICATION REQUIRED** |

No database digest was computed: no real DB was read or written. Existing documents, bulletins, chunks, embeddings and history were never used as write-test targets. Future shared-DB tests still require isolated synthetic open fixtures, controlled worker/storage effects, exact cleanup and equal before/after corpus digests. Fixing a verification script's types does not authorize its execution. Historical release JSON/semantic outputs were preserved; the prior classification report only gained an explicit policy-supersession note.

Remaining release blockers:

- **P1 — semantic acceptance:** the current prompt still needs a separately authorized bounded synthetic C/E check and editorial source-by-source review. Removing M-labels and passing prompt tests do not close the historical grounding, official-status or Azerbaijani-quality findings.
- **P1 — comparison latency:** historical D exhausted 105 seconds. Deadline/cancellation/fallback mechanics are covered locally; the precise provider delay and a successful real comparison remain unverified. Models, routes and time budgets were not changed to hide this result.
- **P2 — historical bulletin E2E:** create/edit mocks pass, but the old live failure is not closed by mocks. A safe browser run needs proven isolation before authorization.
- Production state remains owner responsibility. No Production GO is declared.

Changed files are listed below; all changes belong to Phase 2a.

- [README.md](../../README.md)
- [docs/AUTHENTICATION.md](../../docs/AUTHENTICATION.md)
- [docs/DECISIONS.md](../../docs/DECISIONS.md)
- [docs/WORK_SESSION_HANDOFF.md](../../docs/WORK_SESSION_HANDOFF.md)
- [docs/analytics-v1.md](../../docs/analytics-v1.md)
- [docs/release/RELEASE_RUNBOOK.md](../../docs/release/RELEASE_RUNBOOK.md)
- [docs/release/ZIRVE_PHASE_2A_REPORT.md](../../docs/release/ZIRVE_PHASE_2A_REPORT.md)
- [docs/release/ZIRVE_RELIABILITY_CLASSIFICATION_REPORT.md](../../docs/release/ZIRVE_RELIABILITY_CLASSIFICATION_REPORT.md)
- [scripts/verify-brief-classification-migration.ts](../../scripts/verify-brief-classification-migration.ts)
- [scripts/verify-browser.ts](../../scripts/verify-browser.ts)
- [scripts/verify-classified-briefs.ts](../../scripts/verify-classified-briefs.ts)
- [scripts/verify-generation.ts](../../scripts/verify-generation.ts)
- [scripts/verify-index-edges.ts](../../scripts/verify-index-edges.ts)
- [scripts/verify-retrieval-edges.ts](../../scripts/verify-retrieval-edges.ts)
- [src/components/AnalyticsSourceCard.test.tsx](../../src/components/AnalyticsSourceCard.test.tsx)
- [src/lib/briefs.test.ts](../../src/lib/briefs.test.ts)
- [src/lib/briefs.ts](../../src/lib/briefs.ts)
- [src/server/ai/gemini.test.ts](../../src/server/ai/gemini.test.ts)
- [src/server/ai/gemini.ts](../../src/server/ai/gemini.ts)
- [src/server/ai/rerank.ts](../../src/server/ai/rerank.ts)
- [src/server/ai/types.ts](../../src/server/ai/types.ts)
- [src/server/analytics/abort.ts](../../src/server/analytics/abort.ts)
- [src/server/analytics/endpoint.test.ts](../../src/server/analytics/endpoint.test.ts)
- [src/server/analytics/endpoint.ts](../../src/server/analytics/endpoint.ts)
- [src/server/analytics/rag-policy.test.ts](../../src/server/analytics/rag-policy.test.ts)
- [src/server/analytics/search.ts](../../src/server/analytics/search.ts)
- [src/server/analytics/source-access.test.ts](../../src/server/analytics/source-access.test.ts)
- [src/server/analytics/source-access.ts](../../src/server/analytics/source-access.ts)
- [src/server/prompts/analytics.test.ts](../../src/server/prompts/analytics.test.ts)
- [src/server/prompts/analytics.ts](../../src/server/prompts/analytics.ts)
- [src/test/brief-editor.test.tsx](../../src/test/brief-editor.test.tsx)
- [src/test/setup.ts](../../src/test/setup.ts)
- [vitest.config.ts](../../vitest.config.ts)

