-- Canonical migration for the expression index recorded by snapshot 0019.
-- Snapshot 0020 only reconciles Drizzle metadata; it must not re-run this DDL.
-- Drizzle applies pending migrations in a transaction; CONCURRENTLY is not legal there.
CREATE INDEX "daily_briefs_search_gin_idx"
ON "daily_briefs" USING gin (
  to_tsvector('simple'::regconfig, lower(translate(normalize("title" || ' || ' || "body", NFC), 'ƏİIŞÇĞÖÜ', 'əiışçğöü')))
);
