# Repository cleanup manifest ? 2026-10-22

Phase B follows functional commit `e082be4`. This is a conservative source cleanup; no database, storage object, applied migration, model ID, embedding or access permission was changed.

## Inventory and deletion evidence

The inventory covered 364 tracked files, 230 code files and 106 runtime/test/CLI roots, including src routes, server/start/router entries, scripts, tests, build/test configs, documentation, assets and package commands. TypeScript import analysis followed static imports, re-exports and dynamic import literals. Each deletion below was outside the reachable application/test/CLI graph. Secondary searches checked runtime and config references; there are no component-discovery globs. Historical file manifests are retained as dated evidence rather than treated as executable imports. The ESLint config was an apparent graph orphan but was preserved because the lint CLI discovers it by convention.

## Deleted files (40)

38 unused UI wrappers, the hook used only by the unused sidebar, and the unused department-label helper:

- `src/components/ui/accordion.tsx`
- `src/components/ui/alert.tsx`
- `src/components/ui/aspect-ratio.tsx`
- `src/components/ui/avatar.tsx`
- `src/components/ui/badge.tsx`
- `src/components/ui/breadcrumb.tsx`
- `src/components/ui/card.tsx`
- `src/components/ui/carousel.tsx`
- `src/components/ui/chart.tsx`
- `src/components/ui/checkbox.tsx`
- `src/components/ui/collapsible.tsx`
- `src/components/ui/context-menu.tsx`
- `src/components/ui/drawer.tsx`
- `src/components/ui/dropdown-menu.tsx`
- `src/components/ui/form.tsx`
- `src/components/ui/hover-card.tsx`
- `src/components/ui/input-otp.tsx`
- `src/components/ui/input.tsx`
- `src/components/ui/label.tsx`
- `src/components/ui/menubar.tsx`
- `src/components/ui/navigation-menu.tsx`
- `src/components/ui/pagination.tsx`
- `src/components/ui/progress.tsx`
- `src/components/ui/radio-group.tsx`
- `src/components/ui/resizable.tsx`
- `src/components/ui/scroll-area.tsx`
- `src/components/ui/select.tsx`
- `src/components/ui/separator.tsx`
- `src/components/ui/sheet.tsx`
- `src/components/ui/sidebar.tsx`
- `src/components/ui/skeleton.tsx`
- `src/components/ui/slider.tsx`
- `src/components/ui/switch.tsx`
- `src/components/ui/table.tsx`
- `src/components/ui/tabs.tsx`
- `src/components/ui/textarea.tsx`
- `src/components/ui/toggle-group.tsx`
- `src/components/ui/toggle.tsx`
- `src/hooks/use-mobile.tsx`
- `src/lib/departments.ts`

The old department path in the original V1 addendum is a historical specification reference, now explicitly labeled as historical; no active department field, migration or stored data was removed. The components generator's unused hooks alias was removed.

## Other dead code removed

- Uncalled history exports `analyticsHistoryOwnerCondition` and `analyticsHistoryClassificationAllowed`; the actual live owner/clearance predicates remain.
- Unused Azerbaijani strings `lowReliabilityWarning`, `historyRerun`, `sourcesCount`, `showOnlyFragments` and `errorReference`. Active cited/retrieved counts and icon tooltips remain.

## Removed direct dependencies (27)

Every package below was imported exclusively by the deleted unreachable wrappers:

- `@radix-ui/react-accordion`
- `@radix-ui/react-aspect-ratio`
- `@radix-ui/react-avatar`
- `@radix-ui/react-checkbox`
- `@radix-ui/react-collapsible`
- `@radix-ui/react-context-menu`
- `@radix-ui/react-dropdown-menu`
- `@radix-ui/react-hover-card`
- `@radix-ui/react-label`
- `@radix-ui/react-menubar`
- `@radix-ui/react-navigation-menu`
- `@radix-ui/react-progress`
- `@radix-ui/react-radio-group`
- `@radix-ui/react-scroll-area`
- `@radix-ui/react-select`
- `@radix-ui/react-separator`
- `@radix-ui/react-slider`
- `@radix-ui/react-switch`
- `@radix-ui/react-tabs`
- `@radix-ui/react-toggle`
- `@radix-ui/react-toggle-group`
- `embla-carousel-react`
- `input-otp`
- `react-hook-form`
- `react-resizable-panels`
- `recharts`
- `vaul`

The Bun lockfile changed only to prune that dependency graph and re-hoist already locked packages: entries 1000 ? 928. No new package/version identity was introduced. `react-is@17.0.2`, previously nested under test formatting, became the root hoist after chart dependencies were removed; this is not a newly resolved upgrade. Framework-supplied build integrations (Tailwind, TanStack router plugin, tsconfig paths), React DOM, types and every remaining runtime package were retained. No mass version update was performed.

## Moved and consolidated files

| Previous path | Current path | Preservation |
| --- | --- | --- |
| `zirve_military_seed_data_2026-10-18.json` | `fixtures/seed/zirve_military_seed_data_2026-10-18.json` | Exact bytes and SHA-256 unchanged; protected dry-run still resolves it |
| `docs/WORK_SESSION_HANDOFF.md` (long prior session record) | [historical handoff](archive/WORK_SESSION_HANDOFF_2026-10-22.md) | Original claims preserved; relative links adjusted for the archive directory |

A short current [handoff](WORK_SESSION_HANDOFF.md) now occupies the original path, preserving existing entry links. Historical V1 specifications and OSINT evaluation reports remain, with explicit historical labels. The seed has ten document and ten brief entries; its provenance was not independently established, so it is retained offline and never used as AI input. A regression test verifies the relocated fixture by aggregate counts only. Destructive seeding remains disabled on every target.

## Preserved material and reasons

- `AGENTS.md`, production configs, all 24 applied migrations and Drizzle journal/snapshots: sync, schema and recovery history.
- [Final production report](V1_FINAL_PRODUCTION_REPORT.md), [hardening audit](V1_PROD_HARDENING_AUDIT.md), all prior `docs/release/` JSON/PNG/request evidence: timestamped audit and reproducibility; not current runtime guarantees.
- [Authentication](AUTHENTICATION.md), [release runbook](release/RELEASE_RUNBOOK.md) and [owner checklist](PRODUCTION_MANUAL_CHECKLIST.md): active security and operations instructions.
- All integration/evaluation/recovery scripts and required fixtures: retained reproduction and rollback workflows. They were not run against the corpus as part of cleanup.
- Logo, favicon and robots assets: active branding and standard browser/crawler conventions.
- Existing ignored developer artifacts and user files: outside the source cleanup scope. Only task-owned QA artifacts were created under an ignored directory.

## Reference and quality checks

`bun run check:references` validates repository-relative inline/reference Markdown links, local imports and package-script file targets without reading the seed payload. Historical manifest path strings intentionally record former paths. The seed consumer and all active links were updated.

| Post-cleanup gate | Result |
| --- | --- |
| Targeted Vitest | **176/176**, 22 files, including relocated seed regression |
| Application and scripts TypeScript | PASS, both configurations |
| ESLint | PASS, zero errors; one retained Button Fast Refresh warning |
| Production build | PASS; client CSS 97.01 → 64.88 kB after unused wrappers were removed |
| Frozen install | PASS, no changes |
| Browser smoke | PASS again at 1680×1100 and 390×844 with synthetic services |
| Relative Markdown links / local imports | 146 / 595 checked, zero failures |
| Seed byte preservation | SHA-256 and Git blob identical before/after move |

The initial relocated-seed test exposed Vite's browser asset rewrite of `new URL`; using the explicit Node URL constructor keeps this CLI filesystem read independent of browser transformation. The corrected seed test and final 22-file run pass.

These gates do not establish production or semantic acceptance; see [Phase A verification limits](release/EXECUTIVE_ANALYTICS_CHECKS.md). No DB writes, S3 operations, corpus reindex or production env changes were performed.
