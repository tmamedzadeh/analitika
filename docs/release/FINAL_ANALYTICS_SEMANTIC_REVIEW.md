# Final analytics semantic review

Review date: 2026-10-22, Asia/Baku. This is a manual review of actual Gemini completions, not a claim based on prompt assertions, mocked output, or build success.

**Semantic acceptance: NO-GO for unrestricted production acceptance.** The tested C repeat still confuses lack of disclosed capability measurements with a limitation on the actual capability. D did not complete within the unchanged 105-second deadline. The last targeted prompt guards have not received another live test. Passing citation membership validation does not establish factual entailment.

## Scope and reproducibility

The dedicated [verifier](../../scripts/verify-analytics-prompt-quality.ts) uses invented, open synthetic fixtures and the existing configured `createGeminiProviders().analytics` adapter, fallback route, gateway and citation/publication validation. It imports no database, storage, document service, history or analytics endpoint. No real project documents were transmitted. Fixtures are explicitly described to the model as synthetic scenarios, not current real-world news.

The verifier defaults to a dry run. Explicit `--live` runs at most six sequential selected cases, with one attempt per existing provider route and the existing 105-second deadline per case. It stops that batch at its first provider error. Selected batches write separate files so failures are preserved. This evaluation does not test hybrid retrieval, live authorization, the deployed endpoint, or production latency after retrieval.

Commands actually used:

```text
bun --no-env-file run scripts/verify-analytics-prompt-quality.ts
bun --no-env-file run scripts/verify-analytics-prompt-quality.ts --live
bun --no-env-file run scripts/verify-analytics-prompt-quality.ts --live --case=E-reliability --case=F-insufficient
bun --no-env-file run scripts/verify-analytics-prompt-quality.ts --live --case=C-assessment
```

The first sandboxed live attempt failed immediately with sanitized category `network` and no completion. The same authorized synthetic test ran with network-enabled execution afterward. No provider authentication, quota, model, TLS or API restriction was bypassed. D's timeout was preserved; D was not retried. E/F were a separate batch. C received one further bounded check after a concrete grounding defect was identified; no further live reruns followed.

Raw evidence:

- [Initial A–D batch](../analytics-prompt-live-audit.json): A/B/C completions, D timeout, E/F not attempted in this batch.
- [Separate E/F batch](../analytics-prompt-live-E-reliability_F-insufficient-audit.json): both completed.
- [One C repeat](../analytics-prompt-live-C-assessment-audit.json): completed, but the intended semantic guard was not followed.

## Observed results

Word counts below are approximate whitespace counts, not length targets or quality gates.

| Case | Actual completion model | Elapsed | Outcome |
| --- | --- | --- | --- |
| A: Hörmüz overview | `gemini-3.8-flash` | 16.192s | `stop`; 289 words; valid sparse citations [1], [3], [6], [8]. Substantive linked prose and thematic sections. |
| B: 2027 budget fact | `gemini-3.8-flash` | 4.630s | `stop`; 71 words; starts with the synthetic 700-billion-dram draft, date and status. |
| C0: industrial assessment | `gemini-3.5-flash-lite` | 30.951s | `stop`; 192 words. Unsupported implication concerning mass-production limitations; heading typo and excessive title casing. |
| D: cooperation comparison | No completed model | 105.001s | Provider timeout. No output exists to review. |
| E: source reliability | `gemini-3.5-flash-lite` | 27.229s | `stop`; 163 words. Explains A/1 and D/5 and shared provenance; overstates official status and exposes an internal M2 label. |
| F: insufficient budget/conversion data | `gemini-3.5-flash-lite` | 42.343s | `stop`; 77 words. No fabricated dollar conversion or approved budget; unnecessary prior-year comparison remains. |
| C1: assessment after first guard | `gemini-3.5-flash-lite` | 28.449s | `stop`; citation/publication checks pass. Still makes the material unsupported inference and ignores heading casing instruction. |

Existing fallback produced all light-model completions. This evaluation did not change the configured models, routing, fallback or quota implementation.

## Manual assessment against all twelve criteria

`Pass` means the observed answer satisfies the criterion within its synthetic fixture; it is not a guarantee for future output. `Partial` marks a specific weakness described below. `Fail` marks a material defect. `N/O` means no output was available. Appropriate brevity on B/F counts as success, rather than requiring analytical volume on a factual or unanswerable question.

| Criterion | A | B | C0 | D | E | F | C1 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1. Relevance to the question | Pass | Pass | Pass | N/O | Pass | Pass | Pass |
| 2. Factual grounding | Pass | Pass | Partial | N/O | Partial | Pass | **Fail** |
| 3. Azerbaijani grammar and wording | Pass | Pass | Partial | N/O | Pass | Pass | Partial |
| 4. Analytical depth appropriate to the question | Pass | Pass | Partial | N/O | Pass | Pass | Partial |
| 5. Completeness of material information | Pass | Pass | Pass | N/O | Pass | Pass | Pass |
| 6. Logical coherence | Pass | Pass | Partial | N/O | Pass | Pass | Partial |
| 7. No template reliability/limitations closing | Pass | Pass | Pass | N/O | Pass | Pass | Pass |
| 8. No unnecessary repetition | Partial | Pass | Pass | N/O | Pass | Partial | Pass |
| 9. Specific, justified uncertainty | Pass | Pass | Partial | N/O | Partial | Pass | **Fail** |
| 10. Citation correctness and placement | Pass | Pass | Partial | N/O | Pass | Pass | Partial |
| 11. Executive presentation | Pass | Pass | Partial | N/O | Partial | Pass | Partial |
| 12. Length proportional to complexity and evidence | Pass | Pass | Pass | N/O | Pass | Pass | Pass |

The review examined the full answers beside the supplied fixture text. It was an engineering/editorial assessment, not an independent native-language specialist certification.

### A: broad overview

The answer covers continuing vessel passage, stricter procedures, military-political context, logistical cost pressures, regional trade, alternatives, and the absence of measured export/price effects. It uses paragraphs and meaningful headings rather than a three-bullet summary. The economic consequences remain conditional and linked to the fixture. Its opening repeats some details in the next section, and wording can still be polished. No reliability-code closing or generic `Məhdudiyyətlər` section appears.

### B: direct factual response

The answer opens with the amount, currency, year, document date and **draft** status. It preserves the distinction between a proposal, approved budget and actual expenditure. It does not invent an exchange rate or dollar amount. The compact answer is appropriate to this question. All factual statements reference [1]. These are synthetic numbers, not claims about Armenia's real budget.

### C0/C1: material grounding defect

C0 summarizes infrastructure upgrades, import dependency, service/training and the distinction between a statement and measured output. However, its opening describes undisclosed mass-production capability as a structural limitation. The sources establish import dependence and a distinction between production stages; they do not establish weak or constrained production merely because metrics are absent. Its opening synthesis also lacks a nearby citation. The heading `İstehsal İnfratrukturu və Texniki İmkanlar` contains a spelling defect and uses excessive title casing.

A targeted prompt guard was then added to distinguish undisclosed measurements from evidence of weak capability, together with proofreading and normal heading casing. C1 is actual evidence that this instruction was insufficient: it says that non-disclosure of production and technical metrics `potensialın real miqyasını məhdudlaşdırır`. The evidence only limits **our ability to assess** that real capability. C1 adds nearby citations, but the supplied cited sources still do not support that causal conclusion. Its headings also remain in title case.

The final prompt now includes the exact wrong-versus-correct distinction for that failure. This latest clarification has **not** been tested live. There is no semantic pass claim for C.

### D: unavailable comparison output

The request exhausted the unchanged 105-second budget on a short synthetic corpus. No answer can be assessed against any semantic criterion. Other cases demonstrably completed, so this is recorded as a failed comparison generation, rather than describing all provider testing as unavailable. It does not prove a persistent provider or deployment fault, but is insufficient for release acceptance of that scenario.

### E: reliability question

The answer explains the existing A/1 and D/5 meanings, the scope of the acceptance record, the unsupported anonymous decommissioning claim, and why two fragments of the same anonymous report are not independent corroboration. It keeps low-rated uncertainty visible and does not declare the weak claim false. These are useful observed behaviors.

It also describes acceptance as `rəsmən təsdiqlənmiş` even though the fixture does not independently establish an official source status. Ratings alone must not confer official status. The reference to `M2 material qrupu` exposes a prompt-only implementation label. The final prompt explicitly forbids copying such labels, directs explanations to material titles or [n] citations, and strengthens the official-status guard. These final E-specific guards have **not** been tested live.

### F: insufficient data

The answer directly states that the requested exact dollar equivalent is unavailable, preserves the proposed-budget status and explains that neither approval nor an exchange rate is supplied. It invents neither conversion nor official approval. Repeating the prior-year dram figure is unnecessary to answer this particular question; that remains an editorial weakness.

## Prompt revisions and evidence provenance

The initial substantive revision removed suggestions to routinely add `Məhdudiyyətlər`, removed the fixed analytical sequence, strengthened natural Azerbaijani and synthesis, retained source-specific uncertainty and direct reliability analysis, preserved sparse citations, and supplied stable same-material relationships. The source context also retains either existing rating when the other is absent; no rating values are changed. Thinking level and output budgets remain unchanged at the existing values.

| Revision | Evidence relationship | System prompt SHA-256 |
| --- | --- | --- |
| Initial audited revision | A/B/C0/D and separately E/F ran against this revision. The first verifier did not capture a prompt hash. They predate the later production-metrics/proofreading guards. | Not captured at execution; no retrospective hash is claimed. |
| First metrics/proofreading guard | C1 ran against this exact system prompt; the hash is captured in the C1 JSON artifact. | `6313f7716ae31940c63994ebdc6112c2287c9a54903c6322b475aa5a5714d107` |
| Final local prompt | Adds the exact assessment-versus-capability example, explicit suppression of internal M labels, and stronger official-status wording. No subsequent live generation. | `03079ba74505997f0762ac0e8d4a3a8f2f1829a4f978f4c4a23d6f5b81756aa8` |

Final [analytics.ts](../../src/server/prompts/analytics.ts) file SHA-256, including local file bytes: `c7200a8e7d4741b3a13b37a259915e3941f1a450e1b3f826a6c5ebb7712cb802`.

## Usage and validation boundaries

Across the three network-enabled batches, the existing adapter recorded **10 API operation attempts**, **6 completed responses**, **22,742 reported input tokens**, **9,501 reported output tokens**, and **6,361 reported thinking tokens**. The initial sandbox-blocked attempt is **one additional attempted operation**, with no completion or reported usage. Token fields are the adapter's recorded categories; failed and timed-out calls may have unreported usage, so these figures are not a complete billing estimate.

All six completed outputs finished with `stop` and passed the unchanged citation/publication validator. The validator checks allowed source membership, bounded citation normalization, nonempty output and completion. It does not verify that a citation entails a claim; C1 demonstrates that distinction. No regex removed unwanted substantive prose or concealed the observed defects.

The final prompt tests, citation tests and endpoint tests pass together (3 files, 68 tests). Targeted ESLint and main application TypeScript checks pass. The full scripts TypeScript project also exposed existing errors in unrelated verification scripts; those are tracked in the root final audit. Static tests verify prompt contracts and exact context mappings, not generated-answer quality.

Before unrestricted production acceptance, the final prompt needs a fresh bounded semantic acceptance check for C and E, a successful comparison case within the existing budget, and deployment/runtime verification. Any future evaluation must preserve the failed outputs and distinguish improved prompt wording from demonstrated model behavior.
