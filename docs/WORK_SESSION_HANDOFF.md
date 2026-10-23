# Current V1 handoff — 2026-10-23

The current source is prepared for owner manual testing after Phases 1–4 and [C/E Semantic Hardening](release/ZIRVE_SEMANTIC_HARDENING_REPORT.md). Final local verification passes **506 tests / 64 files** (76.11s, exit code 0), both TypeScript projects, ESLint (zero errors, one existing Fast Refresh warning), repository references and the production client/SSR/Nitro build. The build used the real project config with dotenv content masked, credentials removed and external fetch forbidden; Windows dependency tracing required filesystem access beyond the sandbox. No deployment command was run. These are local engineering checks, not production acceptance.

[Live Gemini acceptance](release/ZIRVE_LIVE_GEMINI_ACCEPTANCE_REPORT.md) preserved three synthetic generations and four SDK dispatches: C/E semantic FAIL; D semantic + deadline PASS in 6.115s through the existing fallback. The subsequent shared-prompt hardening has only offline evidence. C/E release blockers remain open pending a separately authorized bounded rerun; D's live result belongs to the earlier prompt. **Release remains NO-GO.**

[Phase 4](release/ZIRVE_PHASE_4_REPORT.md) records the completed local QA. Context Expansion remains **OFF**; model IDs, thinking configuration, routing/fallback, 4096 output ceiling and 105-second server deadline are unchanged. Historical bulletin E2E remains open; Vercel and Inngest require owner verification. No new AI call, database/corpus mutation, indexing event, infrastructure change or deployment is part of Git preparation.

For manual testing, use the existing [owner checklist](PRODUCTION_MANUAL_CHECKLIST.md) and [release runbook](release/RELEASE_RUNBOOK.md). Start with login, bulletin/document navigation, filters and source display. Creating/editing published content can enqueue indexing; keep those owner-controlled checks separate from this local verification. Local `.env` files, credentials, scratch scripts and logs are excluded from Git. Timestamped synthetic raw answers, manual reviews and final reports remain available as historical evidence.

Git preparation removed 16 obsolete local logs and a temporary scratch directory, retained useful backups and all final reports/evidence, and replaced nine absolute local paths in verification metadata with repository-relative paths. Hash values and raw Gemini answers were preserved. The 17 files prepared for publication passed credential-value, sensitive-path and local-personal-path checks; generated build output remains ignored.

Phase 2a implementation and its historical verification limits: [Phase 2a report](release/ZIRVE_PHASE_2A_REPORT.md). Later phases supersede the earlier pending UX/Progress and Context Expansion implementation statuses.

Source cards group by typed parent identity, distinguish material/fragment counts, and support scoped exact-fragment expansion and focus. History with unverifiable chunks cannot replay its saved answer; failed reopening clears stale content. The [earlier final audit](release/ZIRVE_FINAL_ULTRA_AUDIT.md) is historical evidence, superseded by the later phase and semantic reports above.

The functional implementation and security boundary are documented in [Executive Analytics V1](analytics-v1.md), [shared search](search-v1.md) and the [release runbook](release/RELEASE_RUNBOOK.md). Historical cleanup decisions: [repository manifest](repository-cleanup.md).

Executive prompts, scoped reliability warnings, trusted citation previews, original-filter Copy/Regenerate and 115/105/120-second client/server/function budgets are implemented. Models, embeddings, database schema, permissions and production environment are unchanged.

The owner authorizes Gemini for user-accessible material at all four classifications. The runtime does **not** enforce the old `AI_EXTERNAL_ALLOWED_CLASSIFICATIONS` / `AI_EXTERNAL_POLICY_REFERENCE` gates; authentication, roles, live clearance and source access still apply. Provider dispatches occur outside source-access transactions, with repeated access checks before dispatch and publication. Local tests use synthetic transports and proxy databases; they do not establish real production concurrency behavior.

The lengthy prior handoff is preserved as [historical session evidence](archive/WORK_SESSION_HANDOFF_2026-10-22.md). Its old statuses and policy descriptions are not current guarantees. All release evidence, applied migrations, recovery scripts and authentication documentation remain available. No DB reset, reindex or storage operation was performed.
