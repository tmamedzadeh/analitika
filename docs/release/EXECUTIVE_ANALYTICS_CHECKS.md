# Executive Analytics functional checks — 2026-10-22

Phase A, based on `457b5d83aaa82af3b07ab1430b83aba3a6661e40`. Local and remote main matched before implementation; worktree was clean. This receipt records local code checks, not production acceptance.

| Gate | Result |
| --- | --- |
| Targeted Vitest | **161/161**, 18 files, Vitest 4.1.12 |
| TypeScript application | PASS, `bunx tsc --noEmit` |
| TypeScript scripts | PASS, `bunx tsc --noEmit -p tsconfig.eval.json` |
| ESLint | PASS, zero errors; six existing scaffold Fast Refresh warnings |
| Production build | PASS, Vite 8.1.6 / Nitro Vercel artifact |
| Built route configuration | Analytics 120s; Inngest 300s; local artifact runtime `nodejs24.x` |
| Browser smoke | PASS, installed Edge, 1680×1100 and 390×844; actual components/styles with synthetic services |
| Git diff whitespace | PASS |

The browser smoke checked history opening, Copy payload/success, hover and touch citation previews, trusted parent/chunk URLs, original-filter regeneration, mobile page/popover bounds and collapsing history. Unit tests additionally cover clipboard rejection/missing API, duplicate regeneration, edited form filters, terminal-stream loss, user cancellation, current history metadata, revoked account/source/chunk, legacy history, malformed snapshots, neutral unassessed ratings, fallback, quotas, actual model, clearance and server deadlines. The overall server budget includes history setup time.

The locked dependency install corrected an existing local Vitest 4.1.11/4.1.12 mismatch without changing package inputs or lockfile. Twenty-one pre-existing Prettier errors in four code files were corrected without changing their behavior so the mandatory full lint could pass.

## Manual semantic sample: PARTIAL

Three bounded generations used only the same newly invented inline fixture; five total provider dispatches including fallback. No seed dataset, database documents or user source text were read or sent. Completed models were the configured primary and light models; all three completions passed technical citation/completion checks.

Manual comparison confirmed the direct approved-budget answer, exact 12/15/3 million AZN distinctions, dates, currencies, contract-versus-expenditure separation and identification of the D/5 execution claim as unconfirmed. Samples also exposed overstatements about document nonexistence, an unsupported attribution of official status and an occasional language typo. Prompt instructions were strengthened against those errors; the final sample still had overly broad absence wording. Therefore semantic acceptance is **PARTIAL**, not a claim of verified executive quality for every generated answer. Do not replace this limitation with a green unit-test result or perform mechanical sentence/excerpt rejection. Real output still needs source comparison and production acceptance.

## Scope and remaining acceptance

Client/server/Vercel budgets are **115/105/120 seconds**. No model IDs, embeddings, schema, migrations, permissions or production env were changed. History uses its existing GET function for current authorized previews, and stores only an optional chunk ID in the existing JSON snapshot. Both commits must pass their gates before a normal push together.

Production SHA/runtime/env, live PostgreSQL execution of the new history read, cloud indexing/recovery, real source-revocation/session behavior and final semantic acceptance remain to be checked against the actual deployed revision. See the [current analytics contract](../analytics-v1.md) and [owner checklist](../PRODUCTION_MANUAL_CHECKLIST.md). No production GO is declared.
