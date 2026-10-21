# ZIRVƏ V1 production hardening — checkpoint audit

Checkpoint: 2026-10-21, Asia/Baku. Full hardening was stopped at the owner's request to transfer work to another computer. This is an intermediate audit, not a release certificate. Full context and remaining work: [WORK_SESSION_HANDOFF.md](WORK_SESSION_HANDOFF.md).

**Production decision: NO-GO.** Browser E2E, cloud worker delivery, production revision/configuration, storage security and classified-processing policy remain incomplete.

## Code and database

- V1 scope retained; retired web OSINT, requests, tags and document-user sharing remain removed. Historical migrations remain.
- Indexing uses fenced leases, bounded recovery, provider timeouts and atomic replacement. Failures retain the committed index; edited briefs cannot expose retained stale chunks.
- Live source/chunk/clearance revalidation protects citations and history. Owner/admin does not bypass content clearance. Cancellation cannot overwrite completed history.
- External AI defaults to open-only; classified allowlists require a policy reference and actual approval. No approval was invented.
- Citation validation checks structure, exact excerpts and numerical consistency. It does not prove semantic entailment.
- Xülasələr remains lexical PostgreSQL AND search. No LLM/vector/rerank was added to the catalog.
- Destructive seeding is disabled. Evaluation uses the existing project DB with an active user's clearance; reindex defaults to dry-run.

On the same Supabase database, migrations 0019–0023 completed: lexical index, metadata/index reconciliation, RLS/grant revocation, eight constraint renames. The journal contains 24 entries. 0019 was made transaction-compatible before first application. Historical applied SQL was not rewritten.

[Final DB checkpoint](release/LIVE_DB_CHECKPOINT.json): 13 documents, 10 briefs, 107 chunks/embeddings, no query history. All corpus records ready; vectors are Gemini Embedding 2, 768 dimensions. Zero invalid parents/offsets/dimensions, missing embeddings, orphans or duplicate ordinals. All migration hashes match, including original 0000's LF/CRLF-equivalent hash. Fifteen tables have RLS; anon/authenticated have no read/write grants. Trusted server access remains valid.

[Native schema verification](release/LIVE_SCHEMA_DRIFT.json) passed after 0023: 15 tables, 25 indexes, zero mismatches. No database operation remains running. User corpus was preserved; synthetic fixtures were cleaned up.

The three newest uploads were already ready with chunks/embeddings. Creation-to-update spans were approximately 39–47 minutes; transition/job history was absent, so the cause of the old delay is unknown.

## Evidence

| Check                                 | Result and limit                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Final unit suite                      | PASS: 43 files, 182 tests                                                                       |
| Production and all-scripts TypeScript | PASS                                                                                            |
| Lint                                  | PASS: 0 errors, 6 existing React fast-refresh warnings                                          |
| Production build                      | PASS after approved retry for sandbox readlink restriction; no deployment                       |
| Frozen lockfile dry-run               | PASS                                                                                            |
| Dependency audit                      | PASS: empty findings after compatible patches, Vite 8.1.6 and scoped esbuild override           |
| Drizzle check and native drift        | PASS, latest snapshot 0023                                                                      |
| Indexing/access live integration      | PASS: 17 checks, zero fixture leftovers; local injected vectors, no cloud-delivery proof        |
| Retrieval baseline                    | 17 questions, 20/20 gold labels resolved; 15 answerable, two no-answer, rerank disabled         |
| Retrieval metrics                     | Recall@5 = 1; Recall@10 = 1; MRR = 0.855556; nDCG = 0.879315                                    |
| Live generation                       | PASS: three open-only cases, numeric answer and two abstentions; no entailment proof            |
| Browser E2E                           | FAIL/incomplete: four checks passed, then wrong empty-state locator; corrected but not rerun    |
| Expanded lexical pagination/EXPLAIN   | NOT VERIFIED: script written/typechecked, not run                                               |
| Storage signed/private operations     | NOT VERIFIED: script written/typechecked, not run                                               |
| Deployed revision/cloud workers       | NOT VERIFIED: public GET probes cannot establish revision or registration                       |
| Git whitespace check                  | Known failure: applied metadata-only 0020 has blank EOF; bytes preserved for migration checksum |

Machine-readable results are in [release/](release/). Older DB evidence remains timestamped historical evidence; `LIVE_DB_AFTER_MIGRATIONS.json` predates 0023 and the explanation of 0000's line-ending hash. Use `LIVE_DB_CHECKPOINT.json` for final counts and hashes.

## Readiness

| Area      | Status                                                                       |
| --------- | ---------------------------------------------------------------------------- |
| Code      | Builds/tests pass; complete file/security review unfinished                  |
| Database  | Applied and live schema verified; corpus preserved                           |
| Indexing  | Controlled failure/concurrency/recovery PASS; cloud delivery unverified      |
| Retrieval | Measured baseline; broader access/fallback/rerank coverage pending           |
| Security  | RLS/source/history protections improved; storage/config/policy gates pending |
| Runtime   | Current deployed revision and real event processing unverified               |
| Release   | NO-GO pending remaining gates                                                |

No manual deployment was performed. Git synchronization preserves work; any connected hosting automation must be checked separately before production GO.
