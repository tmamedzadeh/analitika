# OSINT provider evaluation

Captured: 2026-10-20T03:41:43.223Z

The same 3 seed queries were submitted for search across the eight required languages. HasData was limited to fa, hy, ka, zh. Provider combinations below are merged offline with RRF (k=60); no extra API calls are made for combined modes.

*Reference matches count matching domains from the seed fixture. This is a comparison proxy, not blind relevance scoring or a source-quality judgment.

Evaluation status: incomplete; no provider returned a search response. Query texts, page text, prompts and model outputs are not stored in this report.

Provider timings below are failed request durations, not successful response times.

| Provider mode | Reference matches* | Languages | Unique domains | Full-text rate | Duplicate rate | Results | Avg. provider response |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| Exa | n/a | n/a | n/a | n/a | n/a | n/a | 10 ms |
| Tavily | n/a | n/a | n/a | n/a | n/a | n/a | 16 ms |
| HasData | n/a | n/a | n/a | n/a | n/a | n/a | 7 ms |
| Exa + Tavily | n/a | n/a | n/a | n/a | n/a | n/a | 13 ms |
| Exa + HasData | n/a | n/a | n/a | n/a | n/a | n/a | 8 ms |
| Tavily + HasData | n/a | n/a | n/a | n/a | n/a | n/a | 11 ms |
| All | n/a | n/a | n/a | n/a | n/a | n/a | 11 ms |

## Baseline comparison

The post-change hybrid row is computed from both providers' three-query results merged offline with RRF; it is a comparison ceiling for the conditional production fallback, not an exact replay of that fallback policy. The baseline used six languages and five were observed; the new run uses all eight.

| Metric | Before | After (Exa + Tavily, offline RRF) |
| --- | ---: | ---: |
| Seed-domain relevance proxy | 12 | not measured (provider errors) |
| Languages with sources | 5 / 6 | not measured (no search responses) |
| Languages selected | 6 | 8 |
| Unique domains | 47 | not measured (provider errors) |
| Full-text rate | 100% (36/36) | not measured (no selected sources) |
| Duplicate rate | 39% | not measured |
| Selected summary sources | not recorded | 0 (no search results) |
| Azerbaijani summaries | not recorded | not measurable (no selected sources) |
| Runtime | 18.5s | 18.4s |
| Search requests | 18 | 60 attempted (60 errors) |
| Query expansion success | not recorded | 0 / 3 |
| LLM steps successful | not recorded | 0 / 3 |

## Step timings

| Step | Before | After |
| --- | ---: | ---: |
| Query expansion | not recorded | 18209 ms total |
| Search providers | 18 requests; total step timing not recorded | Exa 10 ms avg, Tavily 16 ms avg, HasData 7 ms avg |
| Azerbaijani summary probe | not recorded | not run (no selected sources) |

Full-text checks used the existing SSRF-safe page fetcher, capped at 24 distinct pages. A page counts only at 800 or more extracted characters.

## API usage

Provider usage JSON: {"exa":{"requests":24,"budgetUsed":24,"budgetLimit":24,"errors":24,"searchOperations":24,"averageResponseMs":10,"languagesWithSuccessfulResponses":[]},"tavily":{"requests":24,"budgetUsed":24,"budgetLimit":24,"credits":0,"errors":24,"searchOperations":24,"averageResponseMs":16,"languagesWithSuccessfulResponses":[]},"hasdata":{"requests":12,"budgetUsed":12,"budgetLimit":24,"mode":"light","errors":12,"searchOperations":12,"averageResponseMs":7,"languagesWithSuccessfulResponses":[]}}

Query expansion calls: 0 (failures: 3). Total elapsed: 18.4s. Secure page fetches: 0.
