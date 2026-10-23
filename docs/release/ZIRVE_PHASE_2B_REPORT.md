# ZIRVƏ V1 — PHASE 2b

22 October 2026, Asia/Baku. Local implementation and isolated verification only. No commit, push, deployment, shared database access, corpus writes, indexing event or live AI call. Phase 3 and Final QA were not started.

Phase 2a is preserved. At entry it occupied 33 staged files, with an empty unstaged diff. HEAD remains `8edcab6a9885d374c25db8dce25c5df29f9f8e95`. The SHA-256 of `git diff --cached --binary` is unchanged: `5bae19aba2c2b19d4c46bca63233b4909cd405241a90c82cf8ed73a4ce4503a0`. Phase 2b consists of the unstaged changes and new files listed below; review with `git diff` plus the untracked files, rather than treating the combined HEAD diff as Phase 2b.

| Area | Result |
| --- | --- |
| SSE lifecycle | Authenticated, rate-limited, validated requests open SSE before awaiting history setup/retrieval. Additive `{type: "progress", stage}` events report `starting`, `retrieval` (including rerank), `sources`, `generation`, `validation`. Retrieval failures after opening the stream are terminal SSE errors with HTTP 200; preflight HTTP errors remain unchanged. Only one terminal event is allowed. |
| Publication and access | Existing source preparation, per-dispatch/retry/fallback access checks, exact source consistency and final citation validation remain mandatory. Generated prose appears exclusively through `final`; the client ignores legacy `delta`. Progress contains only stage names, with no counts, source metadata, reasoning, percentages or ETA. |
| Progress UI | A compact timeline, current stage, completed milestones and actual elapsed time replace the waiting text. Validation retry returns to generation. Authorized source cards remain usable during generation. Sources-only/no-results skip generation. Final replaces progress immediately, without waiting for history persistence/EOF. |
| Error/cancel/deadline | Cancellation releases pending immediately. The existing 115-second client deadline releases UI even if transport ignores abort. Disconnect without a terminal event clears previews. Terminal errors provide retry using the original request context. Existing server/function budgets remain 105/120 seconds. |
| Son sorğular | Selection and question update immediately, old answer/source snapshots clear, record loading has its own skeleton. A new selection aborts the previous operation; an operation counter rejects stale success, failure and cleanup. Same pending ID is deduplicated; later reopens still recheck access. List loading/refetch and record loading are separate. Running history has an explicit unfinished message. |
| Unified loading | Bulletin/document catalogs use delayed skeletons for initial/filter loads and a reserved, quiet indicator for background refresh. Pagination/save/upload/auth/settings actions use stable-width labels and delayed button indicators. Settings retain the user table during refresh. Document details use a content skeleton. Existing Router pending delay (250 ms, no minimum display time) and sidebar-preserving layout are retained. Document/bulletin indexing still shows real existing job status. |
| Accessibility | Live stage announcements remain outside an analytical `aria-busy` ancestor; elapsed time does not announce every second. Current steps/rows expose ARIA state. Cancellation is at least 44 px. New motion respects reduced motion. Keyboard navigation and desktop/mobile overflow were checked in the browser. No dependencies were added. |

Verification:

| Check | Result |
| --- | --- |
| Full isolated Vitest suite | PASS: 419 tests in 60 suites (Phase 2a baseline: 409); all services mocked |
| Final accessibility adjustment | PASS: 29 affected component tests and the browser checks repeated after the change |
| TypeScript app and evaluation projects | PASS (`--noEmit --incremental false`) |
| ESLint | PASS: 0 errors; the existing Fast Refresh warning in `src/components/ui/button.tsx` remains |
| Isolated Edge browser | PASS: 10 desktop/mobile checks; no page errors or external requests. [Evidence](PHASE_2B_BROWSER.json) |
| Production build | PASS: client, SSR and Nitro/Vercel output using the actual project configuration. The initial sandbox denied Nitro's parent-directory `readlink`; the same build passed with the required filesystem permission. No application configuration was changed to bypass tracing. |
| References / whitespace | PASS: local references resolve; `git diff --check` clean |

The build used Vite's `createBuilder({envDir: false}, null).buildApp()` (the CLI's build path), with sensitive environment variables removed, `NODE_ENV=production`, `VITEST_WORKER_ID=phase-2b-build` to prevent dotenv credential loading during verification, and outbound `fetch` rejected. It built artifacts only and did not run a server or deploy. Existing build notices about `vite-tsconfig-paths` and the non-route `attachments.test.ts` remain. Verification helper/logs and synthetic screenshots are in `.release-backup.local/phase-2b*`.

No additional AI calls: the production diff adds event emission/UI only, retaining the existing provider calls and two-attempt validation loop. Mock RAG tests still assert exactly embedding → rerank → generation (three HTTP dispatches) for each of the four classifications, with no transaction held during dispatch. Endpoint tests assert one ordinary generation, zero generation for sources-only/no-results, and exactly two for the existing validation retry. Fallback/provider tests and Phase 2a revocation/cancellation checks remain covered. No live Gemini evaluation was run.

Changed files (Phase 2b only):

- `src/lib/analytics.ts`, `src/lib/i18n/az.ts`
- `src/server/analytics/endpoint.ts`, `endpoint.test.ts`, `rag-policy.test.ts`
- `src/components/AnalyticsProgress.tsx`, `ZirveLoader.tsx`, `ZirveLoader.test.tsx`, `BriefEditor.tsx`, `Shell.tsx`
- `src/routes/_app.axtaris.tsx`, `_app.ayarlar.tsx`, `_app.index.tsx`, `_app.senedler.tsx`, `_app.senedler_.$id.tsx`, `_app.senedler_.yeni.tsx`, `login.tsx`
- `src/styles.css`, `src/test/analytics-layout.test.tsx`, `src/test/document-detail.test.tsx`
- `scripts/verify-phase-2b-ui.ts`, `scripts/fixtures/phase-2b-ui.tsx`, `scripts/fixtures/phase-2b-services.ts`
- `docs/release/PHASE_2B_BROWSER.json`, this report

The browser harness renders the production analytics, source/answer, loader and shell components with synthetic server-function replacements and SSE transport. Its route transition uses a deferred synthetic loader. It does not claim live authentication, upload, database, worker or provider verification. Existing component tests cover catalog filters/pagination, document details/upload flow and bulletin create/edit/save with mocked services. Historical release evidence was not overwritten.

Phase 2b is ready for review and the project can proceed to separately authorized Phase 3 work. Release remains **NO-GO** because the inherited blockers remain open:

- **P1 — semantic acceptance:** current-prompt synthetic C/E acceptance and editorial grounding/official-status/Azerbaijani review require separate authorized live verification.
- **P1 — historical comparison D timeout:** mechanics pass locally; the historical 105-second provider delay and a successful live comparison are still unverified.
- **P2 — historical bulletin E2E:** create/edit mocks pass; the historical live failure requires proven test isolation before verification.
- **Vercel and Inngest: ПРОВЕРЯЕТ ВЛАДЕЛЕЦ / OWNER VERIFICATION REQUIRED.** Local build success does not verify deployed buffering, runtime configuration, provider availability or worker state.

Stop gate: no Selective Context Expansion, Final QA, commit, push or deployment performed. No Production GO is declared.
