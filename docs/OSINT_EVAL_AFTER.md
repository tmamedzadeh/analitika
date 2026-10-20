# OSINT provider evaluation

Captured: 2026-10-20T08:09:50.427Z

The same 3 seed queries were submitted for search across the eight required languages. HasData was limited to fa, hy, ka, zh. Provider combinations below are merged offline with RRF (k=60); no extra API calls are made for combined modes.

*Reference matches count matching domains from the seed fixture. This is a comparison proxy, not blind relevance scoring or a source-quality judgment.

Evaluation status: search responses received. Query texts, page text, prompts and model outputs are not stored in this report.

Average provider timings below represent successful search responses.

| Provider mode | Reference matches* | Languages | Unique domains | Full-text rate | Duplicate rate | Results | Avg. provider response |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| Exa | 16 | ru, en, fr, az, zh | 36 | 100% (7 checked) | 85% | 37 | 2543 ms |
| Tavily | 5 | ru, en, fr, az | 37 | 100% (7 checked) | 55% | 50 | 2594 ms |
| HasData | 0 | none | 24 | 100% (2 checked) | 7% | 28 | 8184 ms |
| Exa + Tavily | 16 | ru, en, fr, az, zh | 67 | 100% (9 checked) | 76% | 83 | 2568 ms |
| Exa + HasData | 16 | ru, en, fr, az, zh | 57 | 100% (7 checked) | 77% | 62 | 5363 ms |
| Tavily + HasData | 5 | ru, en, fr, az | 49 | 100% (7 checked) | 52% | 68 | 5389 ms |
| All | 16 | ru, en, fr, az, zh | 77 | 100% (9 checked) | 73% | 99 | 4440 ms |

## Baseline comparison

The post-change hybrid row is computed from both providers' three-query results merged offline with RRF; it is a comparison ceiling for the conditional production fallback, not an exact replay of that fallback policy. The baseline used six languages and five were observed; the new run uses all eight.

| Metric | Before | After (Exa + Tavily, offline RRF) |
| --- | ---: | ---: |
| Seed-domain relevance proxy | 12 | 16 |
| Languages with sources | 5 / 6 | 5 / 8 |
| Languages selected | 6 | 8 |
| Unique domains | 47 | 67 |
| Full-text rate | 100% (36/36) | 100% (9/9) |
| Duplicate rate | 39% | 76% |
| Selected summary sources | not recorded | 3 / 3 |
| Azerbaijani summaries | not recorded | 0% (0/3) |
| Runtime | 18.5s | 121.2s |
| Search requests | 18 | 60 attempted (9 errors) |
| Query expansion success | not recorded | 0 / 3 |
| LLM steps successful | not recorded | 0 / 5 |

## Step timings

| Step | Before | After |
| --- | ---: | ---: |
| Query expansion | not recorded | 36016 ms total |
| Search providers | 18 requests; total step timing not recorded | Exa 2543 ms avg, Tavily 2594 ms avg, HasData 8184 ms avg |
| Azerbaijani summary probe | not recorded | 4698 ms for 3 selected sources |

Full-text checks used the existing SSRF-safe page fetcher, capped at 24 distinct pages. A page counts only at 800 or more extracted characters.

## API usage

Provider usage JSON: {"exa":{"requests":24,"budgetUsed":24,"budgetLimit":24,"errors":0,"searchOperations":24,"averageResponseMs":2543,"languagesWithSuccessfulResponses":["hy","fa","ru","zh","en","fr","ka","az"]},"tavily":{"requests":24,"budgetUsed":24,"budgetLimit":24,"credits":24,"errors":0,"searchOperations":24,"averageResponseMs":2594,"languagesWithSuccessfulResponses":["fa","hy","ru","zh","en","ka","fr","az"]},"hasdata":{"requests":12,"budgetUsed":12,"budgetLimit":24,"mode":"light","errors":9,"searchOperations":12,"averageResponseMs":8184,"languagesWithSuccessfulResponses":["fa","hy"]}}

Legacy expansion counters: `expansionCalls=0` counts successful primary expansions only; `expansionFailures=3` counts failed primary expansion runs. Total elapsed: 121.2s. Secure page fetches: 22.

## Detailed interpretation of the latest provided run

The figures below describe the 2026-10-20 seed evaluation (the local artifact was captured at 08:09:50 UTC). They are not results from a real user OSINT run, and this work did not rerun the external evaluation.

### Expansion

- The primary model was `gemini-3.8-flash`. The eval made three primary calls; each timed out at about 12 seconds, for 36,016 ms total.
- The old eval script set `timeoutMs: 12_000` directly. `GeminiLLMProvider` used that value to build the request `AbortSignal`; its gateway retries only quota errors, so `maxAttempts: 2` did not retry these timeout errors.
- The production job has no nested 12-second timeout: its HTTP timeout is 30 seconds and its primary expansion stage budget is 55 seconds. It uses `generateObjectPrimary`, then makes one explicit `AI_LIGHT_MODEL` fallback call for all translated languages if primary expansion fails.
- The old eval never called `generateQueryExpansionsWithFallback`. Its catch block reused the original query, so no explicit fallback was requested. The zero `expansionCalls` value meant zero successful primary results, not zero model invocations.
- The updated eval now uses the production fallback helper and reports primary calls, fallback calls, completed expansions, and failed expansions separately. No live rerun has been made to produce updated measurements.

### Azerbaijani summary probe

- The recorded two `gemini-3.5-flash-lite` calls completed without transport errors (about 1.9 s and 2.8 s), but accepted zero of three summaries.
- In the old eval, the root schema allowed arbitrary `sources` items. The probe then checked source numbers and Azerbaijani title/summary/claims in application code; any exception was swallowed, and a step counted only if every pending source passed. Thus transport success did not imply valid summaries. If a row lacked a `claims` array, for example, the `.every` check threw and the catch discarded the step without a reason.
- The saved aggregates do not distinguish malformed rows, wrong source numbers, or language rejection. The model output was not retained, so the exact per-row rejection cause cannot be reconstructed from this run. The `0` Azerbaijani summaries figure means no row passed the probe's post-generation checks.
- The updated probe uses production batching and `parseSourceSummariesDetailed`; it reports aggregate `schema`, `source_number`, `language`, `missing`, and generation-failure counts without retaining model output. It remains a probe and does not save summaries to a run.
- In updated eval output, `successfulSteps` counts logical model calls that yielded at least one valid row; `validSummaries` counts accepted source rows. This is distinct from the old all-pending-rows-per-call counter.

### Provider results and coverage

| Mode | Requests | Errors | Candidates | Unique results | Unique domains | Duplicate rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Exa | 24 | 0 | 240 | 37 | 36 | 84.6% |
| Tavily | 24 | 0 | 112 | 50 | 37 | 55.4% |
| HasData | 12 | 9 | 30 | 28 | 0 reference-domain matches | 6.7%* |
| Exa + Tavily | offline merge | — | 343 | 83 | 67 | 75.8% |
| All three | offline merge | — | 370 | 99 | 77 | 73.2% |

Exa and Tavily each returned successful responses for all eight requested languages (`hy`, `fa`, `ru`, `zh`, `en`, `fr`, `ka`, `az`) and averaged about 2,543 ms and 2,594 ms. HasData succeeded only for `fa` and `hy`, averaged about 8,184 ms, and remains evaluation-only. The language list in the table near the top describes languages with source coverage after merging; it differs from languages with successful API responses.

The Exa + Tavily and all-provider rows were computed offline with RRF; they did not trigger extra provider calls. HasData's `6.7%` rate uses its 30 candidates and 28 globally deduped results; the zero in the reference-match column is the separate seed-domain proxy.

### What duplicate rate measures

For each mode, the eval computes `(fused candidates - globally deduped results) / fused candidates`. Candidates are flattened across query-language pairs after per-pair reciprocal-rank fusion. `dedupeSearchSources` then removes repeated normalized URLs and sufficiently similar titles across that flattened set. This measures repeated results across queries/languages, not source relevance or search quality.

The eval does not save per-source semantic-similarity or overlap distributions, nor labeled examples of relevant and irrelevant sources. Seed-domain matches are only a comparison proxy. These aggregates do not support changing `OSINT_RELEVANCE_THRESHOLD`; its default remains `0.18`.

## Preserved historical run — 2026-10-20 03:41:43 UTC

This earlier run returned no search responses: Exa had 24 errors, Tavily 24, and HasData 12 (60 errors total). Its provider timings (10 ms, 16 ms, and 7 ms) were failed-request durations. Query expansion took 18,209 ms, reported 0 successful expansions and 3 failures, the summary probe did not run because no sources were selected, and total runtime was 18.4 seconds. These earlier failures remain part of the history; they are superseded for current provider availability by the later 08:09 run above.

| Provider mode | Reference matches | Languages | Unique domains | Full-text rate | Duplicate rate | Results | Avg. failed response |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| Exa | n/a | n/a | n/a | n/a | n/a | n/a | 10 ms |
| Tavily | n/a | n/a | n/a | n/a | n/a | n/a | 16 ms |
| HasData | n/a | n/a | n/a | n/a | n/a | n/a | 7 ms |
| Exa + Tavily | n/a | n/a | n/a | n/a | n/a | n/a | 13 ms |
| Exa + HasData | n/a | n/a | n/a | n/a | n/a | n/a | 8 ms |
| Tavily + HasData | n/a | n/a | n/a | n/a | n/a | n/a | 11 ms |
| All | n/a | n/a | n/a | n/a | n/a | n/a | 11 ms |
