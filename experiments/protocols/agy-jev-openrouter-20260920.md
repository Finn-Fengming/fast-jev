# AGY versus native Jev: matched diagnostic experiment

Protocol date: 2026-09-20. Written before this comparison's measured test calls.

## Scope and fixed settings

Compare the current fast-jev AGY pathway (`gemini-3.8-flash-low`) with
OpenRouter's native `typesafe/jev-1.13` Decisions API. Both backends receive a
fresh run of the same 64 existing test cases. Earlier AGY measurements are
historical evidence and are not substituted for this run.

The suite is an AI-assisted, rule-derived synthetic diagnostic set, not an
independently human-annotated production benchmark. Its test cases and previous
AGY results have already been observed. This is a new measurement on a frozen
existing set, **not a newly unseen test**. No test labels, prompts, or production
settings may be changed in response to these results.

- Dataset: `experiments/data/decision-suite.jsonl`, SHA-256
  `f0bfdd47121bf16ee1600583ea06aa58a69aeecd8e5d679560dc1447ba696e2c`.
- All 64 test cases: 16 per category; 32 English and 32 Chinese.
- Two modes, reported separately: one case per request and eight cases per
  request. Each backend performs one measured repeat per mode.
- Seed `20260920`; identical selected cases, order, and grouping for both
  backends. Backend execution order alternates AGY/Jev and Jev/AGY for successive
  request pairs. Calls are sequential, with concurrency 1.
- Timeout: 30,000 ms per backend call. No application retries, fallback model,
  or fallback provider. Upstream caching/retries are outside our control.
- One excluded development-set warmup per backend per mode. Development-only
  interface checks may precede the formal run and must be saved separately.
- Planned budget: 64 + 8 measured requests per backend, 144 measured requests
  total, plus four warmups. Each mode contains the same 64 unique cases.
- A failed warmup stops the run. Three consecutive measured errors on either
  backend stop it; retain all attempted outcomes and mark remaining cases
  `not_run`. Infrastructure failures do not justify silently restarting and
  choosing a better run.
- Freeze the implementation and record source hashes before measured requests.
  Record actual timestamps, sanitized AGY version, requested/resolved models,
  environment, raw typed answers, and request/case records.

## Native request mapping

Jev has `text -> decisions` modality. It is called through
`POST https://openrouter.ai/api/alpha/decisions`, not Chat Completions. The
credential is read from `OPENAI_API_KEY` and sent only to that official endpoint.
Neither credentials nor raw error bodies are written to artifacts.

Use the same `buildBatch()` logical request as AGY. Its state, full question
instructions, and allowed choices are preserved. For batches, each instruction
explicitly points to its own `state.inputs[i]`; a question ID alone is not an
instruction to Jev. Gold answers, rationales, case split, and case IDs used for
evaluation do not enter model inputs.

| Logical type | Native question | Normalized prediction |
| --- | --- | --- |
| choice | `type: choice`; options become criteria keys with null descriptions; full prompt retains the routing rules | `answer.choice`, validated against allowed options |
| boolean | `type: noul`; full original prompt | `answer.noul >= 0.5`, with the tie fixed to true |
| score | `type: score`; full prompt plus the dataset's complete ordered `score_levels` descriptions | Original continuous `answer.score`, without rounding |

The suite's score range is 0–2. Native Score is a probability-weighted ordinal
index in the same units. Its three criterion descriptions already appear in the
original prompt; this mapping adds no gold-answer information. Missing or invalid
native answers fail the whole call, matching fast-jev's batch validation policy.

Record the canonical logical-request hash and a separate native wire-body hash.
Allowlisted native answers are retained so the boolean threshold and score
mapping can be independently recomputed. Request IDs, account details, response
headers, and unrelated local model inventories are omitted. Native probabilities
and confidence are not compared to AGY's uncalibrated self-reported confidence.

## Metrics and interpretation

Choice and boolean use exact typed match. Score uses the existing absolute-error
threshold ≤ 0.5, with score MAE and exact match reported separately. Preserve
continuous Jev values even when an integer prediction would look better. Backend
failures count against end-to-end accuracy; show attempted coverage, valid rate,
successful-response accuracy, failed requests, and unrun cases separately.

Measure wall-clock time around the full backend call, including local request
construction, transport, response parsing, and validation. AGY includes a fresh
process per call. Jev uses direct Node fetch, with connection reuse permitted.
These are user-facing **end-to-end pathway times**, not isolated neural inference
times. Exclude warmup, probe, outer Node startup, and artifact-writing time.

Report successful-request p50/p95 using nearest rank, sample count, all-attempt
latency, and failure count. In batch mode, report mean successful request time
divided by eight as amortized milliseconds per case; never label it individual
response latency or compare it with singleton API latency. Eight batch requests
give only eight latency samples, so p95 is the maximum observed sample.

Report all outcomes, including unfavorable results. One run on template-related
synthetic cases does not establish statistical superiority or production quality.
No model training, test-set prompt tuning, or confidence calibration is performed.

## Sources

- [OpenRouter Jev model](https://openrouter.ai/typesafe/jev-1.13)
- [Official OpenAPI: DecisionsRequest and DecisionsResponse](https://openrouter.ai/openapi.json)
- [Official batching example](https://openrouter.ai/labs/jev/compile)
- [TypeSafe primitives](https://docs.typesafe.ai/primitives)
- [Choice](https://docs.typesafe.ai/primitives/choice),
  [Noul](https://docs.typesafe.ai/primitives/noul),
  [Score](https://docs.typesafe.ai/primitives/score)

Exact commands and observed outcomes are recorded in the comparison guide and
result directory after execution; they do not replace this pre-measurement plan.

## Development interface check before the measured test

`agy-jev-openrouter-dev-20260920` used the seed-selected eight development cases,
batch size eight, one warmup and one measured request per backend. Both pathways
returned valid answers and scored 8/8 under the frozen metric. Jev preserved a
fractional score (score MAE 0.003333; exact match 2/3), while AGY's three scores
matched exactly. No question, label, inference setting or score conversion was
changed after this check. The small development sample validates the interface;
its timing and quality are excluded from the formal test table.
