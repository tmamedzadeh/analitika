# ZIRVƏ V1 release candidate runbook

Updated 2026-10-22 (Asia/Baku). Owner target: https://analitika-one.vercel.app. The final PRODUCTION_RELEASE_REQUEST authorizes commit/push/PR/merge/deploy after gates. The owner subsequently asked to skip obtaining Vercel access; this does not waive runtime acceptance. Current decision: NO-GO. See ../V1_FINAL_PRODUCTION_REPORT.md. Classified external processing remains unauthorized.

## Preserve and inspect

Read `AGENTS.md`, the current audit, handoff and checkpoint manifest. Inspect branch/HEAD/origin/main and both index/worktree. Preserve Lovable history. Do not reset/clean, amend/rebase published commits, force push, reseed, or apply migrations 0000–0023 again. The project has one configured DB; do not create a test/evaluation DB.

Use secrets from the configured secure environment. Keep `.env.local`, raw diagnostics and `.release-backup.local/` out of Git. Run `bun install --frozen-lockfile` on a new machine; this session found and corrected stale installed Vite 8.1.5 versus locked 8.1.6 without changing the lockfile.

## Local verification

Build with `bun run build`, then use `bun run preview` at `127.0.0.1:4175` and `bun run test:e2e`. Check the installed Edge/Chrome executable (`BROWSER_EXECUTABLE_PATH` if needed). Vite's generic preview command is not the project artifact adapter. Check both DB and storage fixture cleanup in evidence.

Target checks to changed behavior. Relevant scoped scripts:

- `bun run scripts/verify-storage.ts`: private/signed/unsigned access, signature-bound PUT size/type, immutable committed images and exact object cleanup.
- `bun run scripts/verify-lexical.ts`: rollback-only AZ lexical/date/pagination/EXPLAIN checks.
- `bun run scripts/verify-runtime-edges.ts`: real local artifact HTTP and real DB/history, with a separate subprocess's synthetic provider transport. Includes the actual 105-second deadline. Port 4176 must be free. This does not prove cloud workers or external Gemini availability.
- `bun run scripts/verify-retrieval-edges.ts`: injected vectors/local rerank checks, access/filters/no-match/HNSW, exact fixture cleanup.
- `bun run scripts/verify-index-edges.ts`: delete/edit races, invalid vectors/quota retention and DB pool reconnect. Reconnecting a pool does not prove a cloud process restart.
- `bun run scripts/verify-release-integration.ts <new-evidence-path>`: changed indexing/access/history integration; preserve earlier evidence when rerunning.
- `bun run scripts/verify-release-db.ts <new-evidence-path>`: read-only corpus/journal/grants/integrity capture. Repeat native drift after schema changes, not merely for a new UI build.

`controlled-ai-preload.ts` is test subprocess tooling, requires explicit synthetic flags and refuses provider input without the fixture token. It is not imported by the application or bundled into production. Do not configure those flags in hosting.

## External processing and storage

Keep `AI_EXTERNAL_ALLOWED_CLASSIFICATIONS=open` and no classified allowance without actual approval. V1 has no separate question classification: the live user's clearance conservatively protects question embeddings/rerank/generation, matching history classification. Higher-clearance local lexical source search remains available. Owner/admin does not raise content clearance.

Use the agreed `gemini-3.8-flash`, `gemini-3.5-flash-lite`, and `gemini-embedding-2` (768 dimensions). Do not add `AI_BACKUP_MODEL` or switch models to hide an outage. Gateway retries are bounded, including transient 503s and Retry-After; SDK retries are disabled to prevent multiplied budgets. Current primary synthetic generation and manual support sample PASS; three current corpus cases PASS with the approved quota fallback to light. Intermittent 503, quota and earlier validation failures are recorded; availability is not guaranteed by a single success.

The bucket must stay private. Current bucket-level `file_size_limit` and MIME restrictions are unset; this session did not change them or existing objects. Application upload URLs now cryptographically bind a validated size (at most 10 MiB) and MIME. Live mismatches were rejected; save also validates actual bytes and creates a new server-only copy. Broader bucket limits can be managed separately through the supported storage administration interface. Supabase documents per-bucket restrictions in [Storage file limits](https://supabase.com/docs/guides/storage/uploads/file-limits).

The new staging key format is intentionally owner-bound. Uploads prepared by an older runtime may need a refresh/retry after rollout; finish active upload sessions before the approved deployment. Existing committed attachment routes continue to use their stored keys.

## Production gates requiring access

Vercel access was skipped at the owner's request. Inngest management API is available with the existing signing key; GitHub REST is available through the configured Git credential helper (connector itself returned 404). API inspection found an old 8-function sync, not the current six jobs. Three retired OSINT functions received pause HTTP200. Do not infer registration/revision from a 401 endpoint or login GET.

Before release approval, record:

1. Exact production project, target, deployment ID and Git revision matching the reviewed candidate.
2. Deployed model/policy/DB/signing env checks as safe flags only; do not copy values into evidence. Confirm the trusted DB role and private storage target.
3. Generated route functions: analytics streaming with 120-second maxDuration and Inngest with 300 seconds. These are present in the local Vercel artifact; verify hosting uses them.
4. Six current Inngest jobs registered, signing enabled, and actual synthetic open document plus brief event→claim→ready runs without a manual worker invocation.
5. Scheduled recovery at `*/15 * * * *`, durable recovery after actual worker restart, and exact fixture cleanup. Do not run global recovery/reindex merely to obtain a green check.
6. Successful current Gemini generation, citation/source navigation, no-answer, session/clearance and private attachment smoke on the actual deployed revision.

The old 39–47 minute upload delay cannot be explained without retained transition/event history. Inspect timestamps, progress lease/recovery counters and Inngest runs for future incidents; never invent a historical cause.

## Release boundary

Prepare a reviewed diff and acceptance matrix first. The final owner request already authorizes release actions; no repeated permission question is required. Keep production **NO-GO** while critical FAIL/NOT VERIFIED remains. Preserve the work in the review branch/PR; do not merge or roll out through failed gates. A permitted deployment is followed by revision verification and smoke; permission itself is not evidence. No corpus-wide reset or reindex is a release gate.
