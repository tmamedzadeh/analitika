# Shared search V1

`src/server/search/lexical.ts` owns Unicode/Azerbaijani casing, token groups,
bounded spelling aliases, vowel-harmony suffix variants, conservative prefixes,
one-edit whole-word typo patterns, reference ranking and known-country anchors.
`sql.ts` translates those rules to parameterized PostgreSQL predicates and ranks.
Neither module depends on a table, route, auth context, LLM or cache.

Catalogs require every keyword group; Analitika combines groups with OR for
recall, keeps its vector branches, RRF and optional reranking, then rejects
candidates lacking any explicitly requested known country. This is a small
audited country list, not general named-entity recognition or a full Azerbaijani
morphological analyzer. Broad semantic questions without such entities keep
their existing retrieval behavior.

Limits: 12 distinct keyword groups, 16 grammatical/spelling variants per group;
prefixes require six letters and at most six extra letters; one-edit typos apply
only to all-letter words of length 6–20 in queries of at most three keywords.
Country names never use prefixes or typo tolerance. `Iran`/`İran` use an explicit
alias; dotted/dotless letters otherwise remain distinct. Short and numeric terms
are never fuzzy. The four spelling-alias entries are intentionally small.

Catalog ranking uses exact title, whole phrase, all concepts in title, exact
tokens, grammatical variants, prefixes, then typos. Searches use integer score,
descending date and descending UUID; empty queries use date/UUID. Document
cursors retain PostgreSQL microseconds. Query/filter changes reset React Query
pagination. No catalog search imports a Gemini provider or maintains an AI plan.

Both catalogs keep draft text separate from the submitted query. Typing and clearing
the input make no search request. Enter and the adjacent Axtar submit button apply
trimmed text without resetting filters; filters continue using the last submitted
query. Query keys isolate pagination and in-flight results, and submitting the same
text again does not create another request. Document indexing-status polling remains
independent of input edits.

## Existing indexes and verification limits

- Bulletin FTS preserves the exact normalized title/body expression of
  `daily_briefs_search_gin_idx`.
- Whole-word typo predicates use raw-column regex operators compatible with
  `daily_briefs_title_trgm_idx`, `daily_briefs_body_trgm_idx` and
  `chunks_text_trgm_gin_idx`.
- Analitika retains `chunks_tsv_gin_idx` and the existing 768-dimensional HNSW
  vector index and embedding model. Raw chunk FTS candidates receive a normalized
  recheck to preserve Azerbaijani casing without rebuilding the stored vector.
- Documents have no equivalent title/body expression GIN or text trigram index
  in the current schema. Their FTS expression and typo rechecks can require scans
  over accessible documents. This change adds no indexes or migrations.

No isolated PostgreSQL executable/service was available during implementation.
Synthetic record tests exercise actual core matching/ranking; proxy-driver tests
verify generated SQL, parameters, authorization and pagination. Browser smoke
uses real components with synthetic services at desktop/mobile widths, including
catalog search, pagination, creation route and citation URLs. It does not validate
live PostgreSQL execution plans, production credentials or real provider calls.

Before adding a document index, capture `EXPLAIN (ANALYZE, BUFFERS)` for the
parameterized title/body query against an isolated representative dataset. Check
selectivity, row counts and sort cost, then separately review a concurrent
expression GIN index matching `normalizedSearchSql()` if that plan justifies it.
Do not apply it to production or reindex the corpus as part of this change.

## Gemini configuration

Three-level fallback and the five-minute per-instance quota cooldown remain.
An already-expired deadline now prevents the initial request as well as retries.
Targeted tests cover daily/RPM quotas, Retry-After, cooldown recovery, all-model
outage, terminal billing/auth/request failures, no-backup configuration, partial
streams, actual-model history/SSE and deduplicated Azerbaijani toasts.

Model IDs come from env; this change preserves them and makes no hosting env changes.
See [Executive Analytics V1](analytics-v1.md) for answer structure, citation previews,
ratings, original-filter regeneration, history access and the 115/105/120-second
client/server/function budgets. External-AI classification env gates are not
implemented in the current runtime; owner approval covers the current test data.
