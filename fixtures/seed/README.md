# Archived seed fixture

`zirve_military_seed_data_2026-10-18.json` was moved here byte-for-byte from the repository root. It remains necessary for the protected dry-run in [seed-demo.ts](../../scripts/seed-demo.ts) and the historical release inventory. The script resolves this file relative to itself, returns only aggregate counts, and continues to reject destructive seeding on every target.

Its structure contains ten documents and ten daily briefs. Synthetic provenance is not independently established; test authorization for the current corpus is not proof of provenance. Do not send this fixture's contents to an external AI provider, publish its text in logs/issues/reports, or use it for new live provider evaluations. Newly invented inline samples are used instead.

No database or S3 data was changed during this move. See the [cleanup manifest](../../docs/repository-cleanup.md) for preservation checks.
