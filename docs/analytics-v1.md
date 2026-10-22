# Executive Analytics V1

Current implementation, 2026-10-22 (Asia/Baku). This describes code behavior and local verification boundaries, not production acceptance.

## Answer and retrieval contract

`/axtaris` uses the existing authenticated `/api/analytics/search` POST endpoint. Hybrid retrieval combines vectors, the [shared lexical engine](search-v1.md), trigram and RRF, with optional reranking. The `/` bulletin and `/senedler` document catalogs stay lexical-only and submit text through Enter/Axtar. Models, embeddings and ranking are unchanged. Migration `0024_brief_classification` adds the existing four classification levels to bulletins; [release evidence and access paths](release/ZIRVE_RELIABILITY_CLASSIFICATION_REPORT.md) describe enforcement.

The Azerbaijani prompt starts with the requested fact or main conclusion. Structure follows complexity: a factual question can need one paragraph; an analytical question can need facts, assessment, comparisons and limitations. It distinguishes reported claims, confirmed facts, interpretation and forecasts; proposed/approved budgets, planned/actual expenditure and contract/execution are distinct. Dates, currencies, units and periods remain explicit. Missing evidence is not proof that an event did not occur. Unsupported recommendations and generic filler are excluded.

This is an instruction to the model, not a semantic guarantee. Publication checks only nonempty output, a completed `stop` finish, and membership of citation numbers in the authorized server source set. There are no mandatory evidence markers, sentence-by-sentence gates, exact excerpt matching or numeric entailment checks. An invalid completion can retry once; token ceilings remain 4096/6144. With no eligible sources, the endpoint sends the existing no-answer without generation.

## Sources, ratings and history

Citation numbers identify retrieved chunks. Only cited chunks appear under a generated answer; the UI explicitly labels the cited count and separately reports retrieved count. A count of seven can include `[8]` when retrieved chunk `[1]` was not cited. Numbers are never compacted on the client. Full-source URLs are built from trusted document/brief UUIDs; model URLs are ignored.

Citation previews support pointer hover, keyboard focus and touch/click through the installed Popover. They show title, date, section and a bounded excerpt, with full-source and source-card links. The current answer uses authorized SSE metadata. The existing history read function rechecks active account, author/admin visibility, live clearance, source access and exact current chunk/parent within a transaction. A removed chunk or unavailable source suppresses the historical answer; older snapshots without a chunk ID retain source navigation with a neutral preview-unavailable message. No extra generation endpoint or private excerpt copies are added.

History snapshots add only an optional chunk ID in the existing JSON field. Query, answer, original filters, actual model, elapsed duration and server source mappings remain authoritative. The existing 90-day default retention applies. Reopening history performs a fresh access check; document routes recheck access again on navigation.

Existing A–F / 1–6 ratings remain. D/E or 4/5 are low ratings; F/6 and missing ratings mean unassessed. Validation tracks whether cited sources have low ratings but never appends a generic sentence to the answer. A compact `Etibarlılıq və məhdudiyyətlər` block identifies only affected citations and their existing ratings. The model is instructed to explain the specific uncertainty beside the affected claim.

## Copy, regeneration and timing

Copy uses only the full answer Markdown, preserving paragraphs, headings, tables and `[n]`. It makes no server call and reports clipboard success or failure. Metadata and hidden source cards are excluded. Icon buttons have tooltips, accessible labels and 44px touch targets.

Regenerate captures the displayed answer's question and a copy of its original filters. Later edits to the form cannot change that request. History regeneration uses historical question/filters. A synchronous client lock prevents duplicate submits; the existing endpoint performs fresh retrieval and permissions checks and creates a new history record. Prior history rows are not overwritten.

The server overall budget is **105s from request start**, client deadline **115s**, Vercel analytics function **120s**. Generation and its validation retry share the absolute server deadline after retrieval and history setup; there is no additional 60s generation cap or first-token timer. A still-running model can use the entire remaining budget. Explicit 503s allow at most one retry with at most 1s backoff and at least 5s remaining headroom, then light/optional backup. A longer Retry-After skips that retry. This reserves time by avoiding repeated unavailable calls, without truncating normal reasoning. Exhausting the absolute deadline can leave no time for fallback; requests needing more than 105s require a separate architectural change. The extra client time allows the server terminal SSE event and network transit. User stop/unmount aborts the request; server timeout records `failed`, disconnect/cancel records `cancelled`. Terminal histories cannot be overwritten by a late disconnect. The client rejects streams ending without a terminal event and preserves a completed answer on a later transport error.

## Gemini and security boundary

Primary → light → optional backup is already implemented. The gateway owns bounded quota/transient retries and Retry-After, five-minute quota cooldown per warm instance, abort/deadline and deduplicated fallback notifications. SDK retries remain disabled. Actual completion model is displayed and persisted. Model IDs are env configuration; this change does not set hosting variables.

`AI_EXTERNAL_ALLOWED_CLASSIFICATIONS` and `AI_EXTERNAL_POLICY_REFERENCE` are **not parsed or enforced** by the current runtime. RBAC/clearance and live source checks protect application access, but do not restrict an authorized source to local-only processing. The owner authorizes Gemini with the current test corpus. This does not authorize real classified processing. Real classified data requires a separate approved processing environment before introduction. No new policy gate or permission bypass is introduced here. See [authentication](AUTHENTICATION.md), [decisions](DECISIONS.md) and [release runbook](release/RELEASE_RUNBOOK.md).

## Verification limits

Targeted component/provider/endpoint and proxy-DB tests establish UI interactions, mappings, generated SQL boundaries, fallback, cancellation and terminal states. They do not prove semantic correctness, live PostgreSQL behavior, provider availability or production deployment. Manual production acceptance must compare claims against sources, verify the deployed SHA and check cloud document/brief/recovery jobs using newly invented fixtures; see the [owner checklist](PRODUCTION_MANUAL_CHECKLIST.md).
