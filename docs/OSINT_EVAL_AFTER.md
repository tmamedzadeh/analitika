# OSINT provider evaluation

Captured: 2026-10-19T12:39:29.085Z

The same 3 seed queries were searched across the seven required languages. HasData was limited to fa, hy, ka, zh. Provider combinations below are merged offline with RRF (k=60); no extra API calls are made for combined modes.

*Reference matches count matching domains from the seed fixture. This is a comparison proxy, not blind relevance scoring or a source-quality judgment.

| Provider mode | Reference matches* | Languages | Unique domains | Full-text rate | Duplicate rate | Results | Avg. provider response |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| Exa | 13 | fa, ru, zh, en, fr | 95 | 100% (23 checked) | 46% | 113 | 1906 ms |
| Tavily | 1 | fa, ru, zh, en, fr, hy, ka | 87 | 60% (30 checked) | 2% | 131 | 2516 ms |
| HasData | 0 | ka, fa, hy | 29 | 38% (8 checked) | 8% | 37 | 8925 ms |
| Exa + Tavily | 11 | fa, ru, zh, en, fr, hy, ka | 159 | 85% (27 checked) | 31% | 230 | 2211 ms |
| Exa + HasData | 13 | fa, ru, zh, en, fr, ka, hy | 123 | 85% (26 checked) | 40% | 149 | 5416 ms |
| Tavily + HasData | 1 | fa, ru, zh, en, fr, ka, hy | 108 | 56% (36 checked) | 3% | 167 | 5720 ms |
| All | 10 | fa, ru, zh, en, fr, ka, hy | 179 | 73% (30 checked) | 29% | 265 | 4449 ms |

## Baseline comparison

The post-change hybrid row is computed from both providers' three-query results merged offline with RRF; it is a comparison ceiling for the conditional production fallback, not an exact replay of that fallback policy. The baseline used six languages and five were observed; the new run uses all seven.

| Metric | Before | After (Exa + Tavily, offline RRF) |
| --- | ---: | ---: |
| Seed-domain relevance proxy | 12 | 11 |
| Languages with sources | 5 / 6 | 7 / 7 |
| Unique domains | 47 | 159 |
| Full-text rate | 100% (36/36) | 85% (23/27) |
| Duplicate rate | 39% | 31% |
| Runtime | 18.5s | 92.2s |
| Search requests | 18 | 21 Exa + 21 Tavily |
| LLM calls | 3 | 3 |

Full-text checks used the existing SSRF-safe page fetcher, capped at two top-ranked results per query-language-provider and 80 distinct pages. A page counts only at 800 or more extracted characters.

## API usage

Provider usage JSON: {"exa":{"requests":21,"budgetUsed":21,"budgetLimit":24,"errors":0,"searchOperations":21,"averageResponseMs":1906,"languagesWithSuccessfulResponses":["fa","hy","ru","zh","en","fr","ka"]},"tavily":{"requests":21,"budgetUsed":21,"budgetLimit":24,"credits":21,"errors":0,"searchOperations":21,"averageResponseMs":2516,"languagesWithSuccessfulResponses":["fa","hy","ru","zh","en","fr","ka"]},"hasdata":{"requests":12,"budgetUsed":12,"budgetLimit":24,"mode":"light","errors":8,"searchOperations":12,"averageResponseMs":8925,"languagesWithSuccessfulResponses":["ka","fa","hy"]}}

Query translation calls: 3 (failures: 0). Total elapsed: 92.2s. Secure page fetches: 60.

## Evaluation execution notes

An initial run at 12:35 used ordinary text output for translations; strict parsing rejected all three maps, so that run's result metrics were discarded. It still used 21 Exa requests, 21 Tavily requests, 12 HasData requests, 3 Gemini calls, and 18 secure page fetches. The measured run above used structured Zod-validated translations and is the only post-change result set shown in the tables. Across both post-change attempts, actual usage was 42 Exa requests, 42 Tavily requests, 24 HasData requests, 6 Gemini calls, and 78 secure page fetches. The separate baseline run used 18 Exa requests and 3 Gemini calls.
