# ZIRVƏ V1 release candidate runbook

Updated 2026-10-22 (Asia/Baku). Target: https://analitika-one.vercel.app. The current owner brief authorizes two verified commits and a normal push of both to main. Existing Git integration may deploy automatically. Production acceptance remains unverified. Read the [current analytics contract](../analytics-v1.md) and [owner acceptance checklist](../PRODUCTION_MANUAL_CHECKLIST.md); older release requests are historical evidence.

## Preserve and inspect

Read `AGENTS.md`, the current audit, handoff and checkpoint manifest. Inspect branch/HEAD/origin/main and both index/worktree. Preserve Lovable history. Do not reset/clean, amend/rebase published commits, force push, reseed, or apply migrations 0000–0023 again. The project has one configured DB; do not create a test/evaluation DB.

Use secrets from the configured secure environment. Keep `.env.local`, raw diagnostics and `.release-backup.local/` out of Git. Run `bun install --frozen-lockfile` on a new machine; this session found and corrected stale installed Vite 8.1.5 versus locked 8.1.6 without changing the lockfile.

## Local verification

For this bounded change, run targeted tests, `bunx tsc --noEmit`, `bun run lint` and `bun run build` after functional work and again after cleanup. Do not run the full E2E/production audit or mass AI evaluations. If separately testing the built runtime, use `bun run preview` at `127.0.0.1:4175` (the project artifact adapter), with approved invented fixtures and an installed Edge/Chrome.

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

The runtime no longer parses or enforces `AI_EXTERNAL_ALLOWED_CLASSIFICATIONS` or `AI_EXTERNAL_POLICY_REFERENCE`. Live active-user/clearance/source checks still apply; authorized source text and questions can be processed by Gemini at any classification. The owner approves current test-data usage. Real classified processing requires separate approval and an appropriate processing environment before introducing such data. Do not claim an open-only code gate exists or silently change execution policy during documentation work. Do not change production env.

Preserve configured model IDs and 768-dimensional embeddings. The existing route is primary → light → optional `AI_BACKUP_MODEL`; duplicate IDs are removed. Quota and transient retries, Retry-After, five-minute per-instance quota cooldown, cancellation and absolute deadline remain in the gateway; SDK retries are disabled. Record the actual completing model, not just the configured primary. Tests use synthetic transports; their success does not establish live provider availability.

The bucket must stay private. Current bucket-level `file_size_limit` and MIME restrictions are unset; this session did not change them or existing objects. Application upload URLs now cryptographically bind a validated size (at most 10 MiB) and MIME. Live mismatches were rejected; save also validates actual bytes and creates a new server-only copy. Broader bucket limits can be managed separately through the supported storage administration interface. Supabase documents per-bucket restrictions in [Storage file limits](https://supabase.com/docs/guides/storage/uploads/file-limits).

The new staging key format is intentionally owner-bound. Uploads prepared by an older runtime may need a refresh/retry after rollout; finish active upload sessions before the approved deployment. Existing committed attachment routes continue to use their stored keys.

## Production gates requiring access

Historical observations below are from the earlier release audit, not a fresh cloud inspection.

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

Commit A contains functional hardening and current documentation only after targeted tests, TypeScript, ESLint and production build pass. Commit B contains safe cleanup, link/reference fixes and its manifest, followed by the same gates and affected tests. Review the complete diff, confirm fresh remote main, then push both commits together without force or rewriting published history. Verify remote SHAs and any available deployment status. A successful push/build/deployment does not establish production GO; actual runtime, cloud, source access and semantic acceptance remain required. Do not reset/reindex the corpus, reapply migrations or change production env.
