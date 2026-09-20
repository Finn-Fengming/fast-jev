# Interpretation and failure analysis

This file explains observed errors; the independently recomputed
`comparison.json` / `comparison.md` remain the numerical source of truth.
The cases, prompts and labels were not changed in response to outcomes.

All 148 planned calls completed their attempts (144 measured plus four warmups).
Every backend/mode has 64/64 case coverage. Seven measured AGY requests failed;
no Jev request failed. The completed run retains these failures rather than
replacing them with another attempt.

## Singleton condition

AGY scored **59/64 = 92.19%** end to end: 59 correct successful outputs, two
timeouts and three `AGY_FAILED` backend errors. Jev scored **64/64 = 100%**.
The corresponding successful-request p50/p95 were **13,446.576 / 44,664.646 ms**
for AGY and **317.704 / 457.643 ms** for Jev. Including failed request times,
AGY p50/p95 were **13,770.809 / 54,155.106 ms**. These are complete pathway
timings, with different process/transport costs.

AGY's 15 valid score outputs matched exactly; Jev's 16 score outputs had MAE
0.0075 and all met the predeclared 0.5 tolerance. Jev's exact numeric score match
rate was 56.25%, which is separate from within-tolerance correctness.

## Batch-of-eight condition

All 64 cases were attempted by both backends. AGY had two failed requests, each
covering eight cases: 16 cases count as incorrect because no valid prediction was
returned before the 60-second deadline. Its 48 successful case outputs were all
correct. Therefore **48/64 = 75%** is its end-to-end accuracy and **48/48 = 100%**
is accuracy conditional on successful responses. These describe different
properties; the latter does not remove the availability failures.

Jev completed all eight requests and scored **63/64 = 98.44%**. Its one wrong
case is `rubric_score-zh-06`, which asks for two elements in a support response:
explicitly restating the actual issue and giving a concrete next action. The
customer says “导出的图片只有左半边。” (the exported image contains only its left
half). The response says “收到反馈，非常抱歉给您带来不便，我们会持续改进服务。”
(acknowledgment, apology and a general promise to improve service).

The frozen rule explicitly excludes generic apologies from issue restatement
and vague promises from concrete actions, so the reference score is **0**.
Jev returned **0.76**, with level probabilities `{0: 0.25, 1: 0.74, 2: 0.01}`:
the weighted score is `0 × 0.25 + 1 × 0.74 + 2 × 0.01 = 0.76`. It exceeds the
predeclared absolute-error tolerance of 0.5. The continuous-value mapping and
scoring are correct. AGY returned 0 for this case in the matched batch.

This is an observed rubric judgment error, not evidence identifying the model's
internal reasoning or a general language-specific weakness. The review is
AI-assisted; it does not replace independent human dataset annotation.

## Prior interrupted attempt and diagnostics

The initial 30-second run stopped after its predeclared consecutive-error limit:
15 singleton cases per backend, AGY 8 correct plus 7 timeouts, Jev 15 correct.
The remaining cases were not run. See the preserved
[initial report](../agy-jev-openrouter-test-20260920/comparison.md).

Three development-only calls with a stream-event observer succeeded in roughly
11–15 seconds, with process closure about one second after SUCCESS. They did not
identify the earlier timeout cause. The subsequent 60-second run follows the
[explicitly revised protocol](../../protocols/agy-jev-openrouter-60s-20260920.md),
uses no observer, and changes no model, prompt, label or production adapter.

Report all attempts together when describing reliability. A later completed
measurement does not erase previous failures, and the small, previously observed
synthetic set cannot establish production accuracy or calibrated confidence.

## Timing boundaries

The measured request duration is authoritative for this comparison. For example,
AGY batch request `r1` took 43,987.870 ms externally while its reported duration
was 4,544 ms; `r4` took 44,181.675 ms while reporting 2,528 ms. These differences
cannot be labeled pure wrapper overhead or recovered as a hypothetical speedup.

The [AGY headless documentation](https://antigravity.google/docs/cli/headless/)
describes the result duration as run/session wall time, distinct from individual
step durations, but does not specify all startup/authentication/initialization/
shutdown boundaries. The adapter only converts the reported seconds to
milliseconds. The short development event traces do not establish the missing
boundaries for these longer calls. We therefore compare the original complete
request times, retain AGY's reported duration as separate metadata, and make no
claim about isolated model compute or the cause of this gap.

The independent verifier recorded two UTC/monotonic warnings: the wall-clock
duration at sequence index 35 differs from monotonic elapsed time by 20.440 ms,
and the following start-to-start gap differs by 20.626 ms. These differences
remain disclosed in `comparison.json`; they were not corrected by editing raw
timestamps. Every monotonic duration and serial-order check passed. Reported
latencies use the unchanged monotonic measurements, so UTC clock drift does not
alter the latency statistics.
