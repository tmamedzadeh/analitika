> Historical specification/evaluation evidence. Original claims and retired module paths are preserved for context; current behavior is described in [Executive Analytics V1](analytics-v1.md) and [shared search](search-v1.md).

# Archived OSINT Web hardening evaluation (retired feature)

> Historical run record only. OSINT Web/search was removed; this document is not current scope or current provider-quality evidence.

## Eval run 2026-10-21T06:02:44.950Z

Captured: 2026-10-21T06:02:44.950Z

The same 1 seed queries were submitted for search across the eight required languages. HasData was limited to fa, hy, ka, zh and remains an evaluation-only provider. Provider combinations below are merged offline with RRF (k=60); no extra API calls are made for combined modes.

*Reference matches count matching domains from the seed fixture. This is a comparison proxy, not blind relevance scoring or a source-quality judgment.

Evaluation status: incomplete; no provider returned a search response. Query texts, page text, prompts and model outputs are not stored in this report.

Provider timings below are failed request durations, not successful response times.

| Provider mode    | Reference matches* | Languages | Unique domains | Full-text rate | Duplicate rate | Results | Avg. provider response |
| ---------------- | -----------------: | --------- | -------------: | -------------: | -------------: | ------: | ---------------------: |
| Exa              |                n/a | n/a       |            n/a |            n/a |            n/a |     n/a |                  33 ms |
| Tavily           |                n/a | n/a       |            n/a |            n/a |            n/a |     n/a |                  11 ms |
| HasData          |                n/a | n/a       |            n/a |            n/a |            n/a |     n/a |                  20 ms |
| Exa + Tavily     |                n/a | n/a       |            n/a |            n/a |            n/a |     n/a |                  22 ms |
| Exa + HasData    |                n/a | n/a       |            n/a |            n/a |            n/a |     n/a |                  26 ms |
| Tavily + HasData |                n/a | n/a       |            n/a |            n/a |            n/a |     n/a |                  15 ms |
| All              |                n/a | n/a       |            n/a |            n/a |            n/a |     n/a |                  21 ms |

## Baseline comparison

The post-change hybrid row is computed from both providers' three-query results merged offline with RRF; it is a comparison ceiling for the conditional production fallback, not an exact replay of that fallback policy. The baseline used six languages and five were observed; the new run uses all eight.

| Metric                      |       Before |    After (Exa + Tavily, offline RRF) |
| --------------------------- | -----------: | -----------------------------------: |
| Seed-domain relevance proxy |           12 |       not measured (provider errors) |
| Languages with sources      |        5 / 6 |   not measured (no search responses) |
| Languages selected          |            6 |                                    8 |
| Unique domains              |           47 |       not measured (provider errors) |
| Full-text rate              | 100% (36/36) |   not measured (no selected sources) |
| Duplicate rate              |          39% |                         not measured |
| Selected summary sources    | not recorded |                0 (no search results) |
| Azerbaijani summaries       | not recorded | not measurable (no selected sources) |
| Runtime                     |        18.5s |                                12.3s |
| Search requests             |           18 |             20 attempted (20 errors) |
| Query expansion success     | not recorded |                                0 / 1 |
| LLM steps successful        | not recorded |                                0 / 2 |

## Step timings

| Step                      |                                      Before |                                              After |
| ------------------------- | ------------------------------------------: | -------------------------------------------------: |
| Query expansion           |                                not recorded |                                     12206 ms total |
| Search providers          | 18 requests; total step timing not recorded | Exa 33 ms avg, Tavily 11 ms avg, HasData 20 ms avg |
| Azerbaijani summary probe |                                not recorded |                      not run (no selected sources) |

Full-text checks used the existing SSRF-safe page fetcher, capped at 24 distinct pages. A page counts only at 800 or more extracted characters.

Duplicate rate is (fused candidates minus deduped results) / fused candidates. Fused candidates are counted per query-language pair after provider RRF; deduped results then remove normalized URL duplicates and sufficiently similar titles across the full mode. It is a repeat-rate metric, not a relevance or quality score.

The Azerbaijani summary probe uses the production batched summarizer, JSON/schema parsing, source-number matching, and language validation. `successfulSteps` counts logical model calls that produced at least one valid source summary; `validSummaries` counts accepted source rows. `attempts` counts logical structured model calls. Failure and summary-status counts are aggregate only; model responses are not stored.

Summary probe validation counts: {"selectedSources":0,"attempts":0,"successfulSteps":0,"failureReasons":{},"summaryStatusCounts":{}}.

## API usage

Provider usage JSON: {"exa":{"requests":8,"budgetUsed":8,"budgetLimit":24,"errors":8,"searchOperations":8,"averageResponseMs":33,"languagesWithSuccessfulResponses":[]},"tavily":{"requests":8,"budgetUsed":8,"budgetLimit":24,"credits":0,"errors":8,"searchOperations":8,"averageResponseMs":11,"languagesWithSuccessfulResponses":[]},"hasdata":{"requests":4,"budgetUsed":4,"budgetLimit":24,"mode":"light","errors":4,"searchOperations":4,"averageResponseMs":20,"languagesWithSuccessfulResponses":[]}}

Query expansion model calls: 2 (primary: 1, fallback: 1; fallback requested: 1, unavailable: 0). Expansion results: 0 completed, 1 failed; primary failures: 1, fallback failures: 1. Total elapsed: 12.3s. Secure page fetches: 0.
