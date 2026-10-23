# ZIRVƏ V1 — PHASE 3: SELECTIVE CONTEXT EXPANSION

23 October 2026, Asia/Baku. Implemented locally behind `ENABLE_CONTEXT_EXPANSION=false`. Production enablement, Phase 4, live AI evaluation, commit, push and deployment were not performed.

Phase 3 is ready for review with the limitations below. The full suite has one **pre-existing staged UI/test mismatch**, so this is not an all-green release verdict. Release remains **NO-GO**; the inherited P1 semantic and historical comparison-timeout blockers remain open.

The actual initial state was `main`, HEAD `8edcab6a9885d374c25db8dce25c5df29f9f8e95`, **55 staged files, no unstaged/untracked files**. Both previous phases were already staged, unlike the older Phase 2b report's original layout. The initial staged patch is preserved byte-for-byte: SHA-256 `28c1b0f355b6017b1f0aa15441be6384df4220e7807c7df80741374c8a4080d9`. Phase 3 is exclusively the unstaged diff and new files listed below. Earlier reports and historical evidence were not rewritten.

| Area | Implementation |
| --- | --- |
| Placement | After unchanged retrieval/RRF/optional rerank/top-10/source preview authorization, before prompt construction. Existing `sources` progress covers the real optional preparation. Sources-only/no-results do not expand. No UI, search, chunking, indexing, model/fallback, classification or existing deadline changes. |
| Selection | Consider only the first three results. An anchor must be non-table, at least 800 characters and have a nonempty section. Inspect only `ord - 1`/`ord + 1`, same parent/type, section and configured embedding model. Require exact 48–384-character overlap and offsets matching raw text. Extract only the immediately adjoining part of the anchor's cut sentence, 24–320 characters, at least four words; exclude complete independent neighboring sentences. No table expansion. |
| Ambiguity and duplicates | Reject conflicting/duplicate neighbors, gaps, inconsistent offsets/overlap, section/model changes, already retrieved chunks and repeated/subsumed excerpts. New quantities, capitalized names and content vocabulary absent from the anchor are rejected; only a small closed set of connectors may be new. Short/self-contained/unclear cases retain baseline. This deliberately favors skipping over adding evidence. |
| Context budget | At most three auxiliary chunks total. The **entire additive prompt payload**, including instructions and labels, is capped at 20% of original retrieved text in both UTF-16 character units and UTF-8 bytes, and at 2,400 bytes absolutely. This is a deterministic text budget, not a measured 20% provider-token ratio; no tokenizer/AI call is added. Output ceilings remain 4096/6144. |
| Citation boundary | Original numbered evidence is unchanged. Expanded prompts explicitly separate `Citable Evidence` and non-citable `Auxiliary Context`, linked only to the existing anchor citation. Auxiliary has no own `n`, card, displayed count or standalone history source. Prompt instructions forbid auxiliary-only factual claims and transferring their support to an anchor citation. Tests exclude new numbers/names/content words and independent auxiliary-only facts from the generated request. |

Index consistency uses the existing architecture, without migration or a new version marker:

1. Capture takes the existing active-account and authorized committed-parent `FOR SHARE` locks, and rechecks the exact retrieved primary UUID, parent, text and offsets. It then captures complete primary identities and reads candidate neighbors in the same transaction. Section/table/ord/model are included in captured identity. Source ordering and citation mapping must remain identical.
2. Parent locks conflict with the existing workers' `FOR UPDATE` atomic replacements. `process-document.ts` replaces the whole chunk set inside that lock; `index-brief.ts` does likewise. Both commits are fenced by the existing lease/status checks and create new chunk UUIDs. Therefore replacement before capture fails the primary identity check, replacement during capture waits, and replacement after capture is rejected by the next guard. The captured set can belong to the retained last committed index while a replacement is staged; staged neighbor rows are never read.
3. Before **each actual provider dispatch/retry/fallback**, the existing guard revalidates primary access plus one batched exact check of every captured primary/auxiliary identity. A SHA-256 identity covers UUID, both parent fields, full text, offsets, ord, section, table flag and embedding model. Full auxiliary identity is checked even though only its selected boundary excerpt is sent.
4. Final publication repeats those checks under short locks with a synchronous publication callback. Any changed/deleted/revoked auxiliary context rejects the generated answer. There is no silent removal of context or baseline publication after generation. No transaction or lock spans Gemini.

The shared DB-only locked read was extracted from `withAnalyticsSourceAccess` for reuse during capture. Its baseline queries and synchronous-publication restriction are retained. With no expected context, the original access path performs no added queries.

SQL and fallback behavior:

- OFF: zero preparation DB calls and byte-identical baseline prompts (nine comparisons against the initial staged prompt: 0/2/10 sources × three thinking levels). No new AI/embedding/rerank calls.
- ON with no eligible anchor: zero preparation SQL. Otherwise at most **six statements for one parent kind, seven for mixed documents/briefs**, independent of source count: one transaction-local timeout setup, account, one/two batched parent reads, exact primary check, primary identity capture and **one** neighbor query returning at most six rows. There is no per-anchor SQL loop.
- Optional preparation sets transaction-local `statement_timeout=250ms` and `lock_timeout=100ms`; these do not change baseline/provider/105-second overall budgets. Before each dispatch and final publication, an expanded request adds one batch identity query for at most 13 chunks.
- Optional SQL error/lock timeout/model mismatch/no useful neighbor rolls back/skips expansion. Baseline still must pass the normal live access guard. Primary revocation/change and cancellation propagate; they never become permissive fallback. Existing 105/115/120-second budgets remain unchanged.
- Technical logs include enabled state, primary/auxiliary counts, base/additional characters and bytes, percentage, preparation transaction wall time and a fixed reason code. They contain no source text, query, parent/chunk IDs or raw SQL/provider errors. No external telemetry was added.

History stores only private identity fingerprints inside the first existing source snapshot's JSON. It stores neither auxiliary text nor another citable entry. Reopening an expanded answer performs one batched provenance check under the already authorized parent locks, including when the feature flag is now OFF. A changed auxiliary suppresses the saved answer; still-authorized primary cards remain independent. Fingerprints are removed from the public history response. Legacy/baseline history keeps its existing path. No database schema change is required.

Verification:

| Check | Result |
| --- | --- |
| Relevant synthetic regression suites | **PASS: 159 tests, nine suites**; selection, consistency, dispatch/publication, history, providers, SSE, citation policy and environment default |
| Full isolated suite | **480 PASS / 1 FAIL**, 63 suites; the single baseline mismatch is detailed below. All 62 added cases pass. |
| TypeScript application and evaluation projects | **PASS:** `--noEmit --incremental false` for both projects |
| ESLint | **PASS:** 0 errors; the existing Fast Refresh warning in `src/components/ui/button.tsx` remains |
| Production build | **PASS:** client, SSR and Nitro/Vercel output; secrets stripped, dotenv disabled during verification, outbound fetch rejected; artifacts only |
| OFF prompt compatibility | **PASS:** nine byte-identical comparisons with the initial staged implementation |
| Git baseline / references | **PASS:** staged patch unchanged, `git diff --check` clean; 376 files / 732 imports / 202 local Markdown links checked |

The full-suite mismatch is `src/test/analytics-layout.test.tsx`, “lists each cited material once and keeps chunk-level citation numbers”: it requires the old “7 retrieved materials / 8 retrieved fragments” explanatory label, which is already absent from the initial staged `src/routes/_app.axtaris.tsx`. The original citable grouping still renders one material/two cited fragments. Both UI and test are preserved exactly as staged; no product change or weakened assertion was introduced to turn this unrelated baseline failure green.

New tests cover before/after/first/last boundaries, sections, duplicates, tables, short materials, budgets, exact UUID/text/offset/model/ord changes, deleted parents, account revocation, stale retrieval, whole-index replacement, a model of a parent-locked writer waiting for capture, SQL fallback, abort/timeout and late completion. Pipeline tests reject publication/retry/fallback after auxiliary changes, retain verified `final`, and keep history/citation counts unchanged. Real provider adapters with mocked transport still make exactly embedding → rerank → generation (three dispatches) for all four classifications with the flag OFF and ON. Eligible expanded requests use one mocked generation; the existing validation retry uses two. No added AI calls are made for expansion itself.

These are proxy/unit concurrency models and inspection of the existing atomic writer protocol, **not live PostgreSQL concurrency or latency measurements**. No actual database, Gemini, storage or worker was used, and no corpus digest was needed because the corpus was neither read nor written. Verification logs and the initial Git manifest are in `.release-backup.local/phase-3/`.

Changed files, Phase 3 only:

- `.env.example`, `src/server/env.ts`, `src/server/env.test.ts`, `src/server/config.ts`
- `src/server/analytics/context-selection.ts`, `context-selection.test.ts`
- `src/server/analytics/context-identity.ts`, `context-expansion.ts`, `context-expansion.test.ts`, `context-pipeline.test.ts`
- `src/server/analytics/source-access.ts`, `endpoint.ts`, `history.ts`, `history.test.ts`, `rag-policy.test.ts`
- `src/server/prompts/analytics.ts`, `src/test/fixtures/analytics-context.ts`
- This report

No quantitative quality improvement is claimed. The narrow vocabulary/boundary filter and prompt separation reduce contamination risk but do not prove semantic entailment: repeated vocabulary can express a different relationship, and baseline citation validation checks citation structure, not every claim's truth. Production expansion remains OFF until separate owner approval and semantic acceptance. Actual tokenizer impact and live PostgreSQL concurrency/performance remain unmeasured.

Phase 4 can be considered only as a separately authorized task. First reconcile the baseline UI/test mismatch, retain the inherited **P1 C/E semantic acceptance**, **P1 historical D comparison timeout**, and **P2 historical live bulletin E2E** findings. **Vercel and Inngest: ПРОВЕРЯЕТ ВЛАДЕЛЕЦ / OWNER VERIFICATION REQUIRED.** No Production GO is declared. Phase 3 stop gate observed; no work on Phase 4, reindex, migration, commit, push or deployment.
