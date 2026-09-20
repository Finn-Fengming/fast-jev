# Synthetic decision suite v1

`decision-suite.jsonl` contains 96 original, self-contained decision cases. It is a small diagnostic suite for fast-jev, not a production accuracy estimate or a replacement for a representative application dataset. No cases were copied from Jev's public examples or evaluation sets.

## Provenance and labels

This suite was constructed with AI assistance during this project's development. Each reference answer was assigned from the explicit rule and synthetic facts in its case, before evaluating the provider. The Gemini provider under evaluation did not generate, judge, or revise these labels. These are **rule-derived, AI-assisted reference labels, not independently human-annotated gold labels**. Every row includes a short rationale for human review; independent human review has not yet been performed.

All customer messages, records, entities, and tracking identifiers are invented. They contain no real customer records or personal identifiers. Cases include resolved history, negation, quotation, incomplete information, explicit priority rules, and two simple numeric boundary checks. Most cases require reading supplied facts and rules rather than world knowledge or arithmetic.

## Composition and fixed split

| Category | Task | English | Chinese | Dev | Test |
| --- | --- | ---: | ---: | ---: | ---: |
| `routing_choice` | Route the current support request | 12 | 12 | 8 | 16 |
| `grounded_boolean` | Determine whether a record establishes a statement | 12 | 12 | 8 | 16 |
| `rubric_score` | Assign a 0–2 score from a stated rubric | 12 | 12 | 8 | 16 |
| `policy_choice` | Apply an explicit action policy | 12 | 12 | 8 | 16 |
| **Total** | | **48** | **48** | **32** | **64** |

Each category has four English and four Chinese development cases, plus eight English and eight Chinese test cases. IDs ending in `01` through `04` are development cases; `05` through `12` are test cases. The stored `split` field is authoritative. This is a deliberately assigned split, not a random sample. The two languages use distinct scenarios rather than translations of the same case. Development and test do not contain the same request or translated copies, but they intentionally share task families and some rubric templates.

Across the entire boolean category, each language has six true and six false labels. Across the score category, each language has four cases at each score. Choice labels and task difficulty are not balanced. Do not interpret an aggregate accuracy as class-balanced accuracy.

The fixture's SHA-256 is:

```text
f0bfdd47121bf16ee1600583ea06aa58a69aeecd8e5d679560dc1447ba696e2c
```

Check it from the repository root with `shasum -a 256 experiments/data/decision-suite.jsonl`. Keep this file unchanged across compared runs. A semantic label or case change requires a new dataset version and a documented change; do not silently edit a failed test case into a passing one.

## Row contract and provider input

Each UTF-8 JSONL row contains:

- `id`, `split`, `category`, `language`: evaluation metadata.
- `request`: the **only object sent to a provider**. It contains `state` and exactly one question with `id: "decision"`.
- `expected.decision`: a reference string, boolean, or integer score.
- `rationale`: an explanation for review, never provider input.
- `score_levels.decision`: present only for scores; a zero-indexed list of the three level descriptions. The identical descriptions also appear in the question's prompt, so all providers receive the rubric itself.

Choice questions use string options and describe every option in their prompt. Boolean questions use a closed-record evidence rule: false means either contradicted **or not established**, not necessarily false in the world. Routing and policy choices include an `other`, clarification, or equivalent valid option when the rule needs one; these are task answers, not provider abstentions. Score questions have `min: 0`, `max: 2` and explicit criteria for each integer level.

Do not serialize the whole row as model input or include labels, rationale, category, split, or IDs in provider context. Do not use a model to fill in missing outputs or judge whether an error should count as correct.

## Evaluation discipline

Use development cases to choose prompts and settings. Freeze those choices before the test run; report any subsequent test-driven tuning as such. A split authored by the project is not an externally held-out benchmark, even when test responses were not used for tuning.

Report choice and boolean exact match, score mean absolute error (MAE), score exact match, and result validity/coverage separately. A score prediction of `1.8` against a reference of `2` has MAE `0.2`; preserve that numeric output instead of silently rounding it into an exact match. A probability-weighted expected score has a different interpretation from a directly selected integer, so exact match alone cannot fairly compare those scoring methods. Missing outputs, transport failures, malformed responses, and abstentions must remain visible in totals; state the denominator for each metric. An accepted-answer-only score must be accompanied by coverage.

Record the code revision, fixture hash, provider and model, command and settings, host/runtime, request schedule, cache state, concurrency, timeout, retry policy, and raw per-case outcomes. Latency includes provider startup and transport only when the timer explicitly covers those components; name the measured boundary. For timing claims, use multiple runs, show sample count and uncertainty, and keep warm-up, cold-start, sequential, and concurrent measurements distinguishable. Provider failures can establish an availability problem, but cannot establish model accuracy or normal inference speed.

Published Jev results use different datasets, models, infrastructure, and timing boundaries. They are contextual references only. This suite, or an agy-only run of it, cannot establish that fast-jev is faster or more accurate than native Jev.

## Limitations

The suite is small, synthetic, and relatively easy. Rules are short, supplied in full, and often reduce to checking explicit facts. It does not cover realistic traffic prevalence, long contexts, ambiguous human preferences, multi-question batching, tool use, specialist knowledge, calibration, adversarial robustness, safety, or production drift. It was not independently annotated or audited. Shared task/rubric templates mean examples are not fully independent. A strong result supports only performance on these fixed cases under the recorded conditions.

## 中文说明

本数据集共 96 条原创合成案例，四类任务各 24 条，每类英文和中文各 12 条；固定开发集 32 条、测试集 64 条。中英文场景独立编写，没有把同一句话的翻译拆进两个集合，但部分评分规则模板相同。

数据由 AI 辅助编写，参考答案依据案例内的明确规则预先固定；被测 Gemini 未参与标注。**这不是经过独立人工标注或复核的金标准。** 每条提供可供人工检查的解释；只能将 `request` 传给模型，不能泄露 `expected` 或 `rationale`。

请分别报告准确率、评分 MAE、有效输出率和覆盖率，并记录所有失败。评分的浮点输出不得擅自四舍五入成正确答案。只能用开发集调参；如查看测试结果后继续修改，必须披露。数据、配置、运行条件和原始结果应一并保留。该小型自建集合不能代表生产准确率；与 Jev 的公开结果使用不同条件，不能直接据此声称速度或准确率超过 Jev。
