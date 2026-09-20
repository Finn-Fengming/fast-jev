# AGY / OpenRouter Jev comparison

This experiment compares fast-jev's AGY backend (`gemini-3.8-flash-low`) with
OpenRouter's **native Decisions API** (`typesafe/jev-1.13`). The regular fast-jev
OpenAI-compatible provider uses Chat Completions and is not the adapter used for
this native-decision benchmark.

## Completed 60-second follow-up

Status: `completed_with_errors`. **All 148 planned calls were attempted**: 144 measured calls and four excluded warmups. Every backend/mode covers 64/64 cases, with zero unrun cases. End-to-end correctness includes backend failures; table percentiles use successful requests only.

| Mode | Backend | Correct / attempted cases | Failed / attempted requests | Successful-request p50 / p95 (s) |
| --- | --- | ---: | ---: | ---: |
| Singleton | AGY | 59/64 (92.19%) | 5/64 | 13.447 / 44.665 |
| Singleton | Jev | 64/64 (100.00%) | 0/64 | 0.318 / 0.458 |
| Batch of 8 | AGY | 48/64 (75.00%) | 2/8 | 12.892 / 44.182 |
| Batch of 8 | Jev | 63/64 (98.44%) | 0/8 | 0.324 / 0.462 |

AGY singleton failures were two `AGY_TIMEOUT` and three `AGY_FAILED` errors. Two AGY batch timeouts affected 16 cases. Conditional accuracy among successful responses was AGY 59/59 singleton and 48/48 batch; Jev 64/64 singleton and 63/64 batch. Jev's sole batch error was a score prediction. Including failures, AGY's request p50/p95 were **13.771/54.155 s** singleton and **13.303/60.264 s** batch; Jev had no request failures, so its all-attempt percentiles match the table.

Score correctness uses absolute error ≤ 0.5, without rounding native values. AGY's 15 valid score answers in each mode were exact (MAE 0). Jev singleton score MAE was **0.007500**, exact **9/16**; batch MAE was **0.056875**, exact **11/16**. Mean successful batch amortization was **2,823.741 ms/case for AGY** and **45.265 ms/case for Jev**, not individual response latency.

The [raw report](results/agy-jev-openrouter-60s-test-20260920/comparison.md), [JSON](results/agy-jev-openrouter-60s-test-20260920/comparison.json), and [analysis](results/agy-jev-openrouter-60s-test-20260920/analysis.md) retain full evidence. Two UTC-versus-monotonic timing warnings are recorded; monotonic duration and serial non-overlap checks passed. The 22 measured source-file hashes remained unchanged, with runtime HEAD `60066f4`. These observations do not establish general production superiority.

The [initial frozen protocol](protocols/agy-jev-openrouter-20260920.md) defines the data,
mapping, timing, stopping rules, and interpretation before measured test calls.
Both backends are measured again; earlier AGY numbers are not reused as the new
comparison arm.

The initial 30-second attempt stopped at the predeclared error threshold:
[15 singleton cases per backend](results/agy-jev-openrouter-test-20260920/comparison.md),
AGY 8 correct / 7 timeouts and Jev 15 correct, with the remaining cases and all
batches unrun. It is retained in full. The
[separately frozen follow-up](protocols/agy-jev-openrouter-60s-20260920.md) uses the
CLI's default **60-second** deadline for both backends and runs batches first.
No production adapter, prompt, label, score mapping or retry policy changed.
The commands below reproduce that explicitly revised configuration; they do not
erase the stopped attempt or make the existing cases an unseen holdout.

## Reproduce

The measured implementation is frozen at commit
`d09f2408e79b32b4bec99db62af10268911c1195`. Check out that revision to reproduce
the exact adapter, prompts, schedule, and scoring implementation. The follow-up
recorded runtime HEAD `60066f40dfe74cc18eac7ab88527ce7a165b38f6`; its added
protocol/evidence did not alter the 22 source-file hashes. Later README
edits and saved results do not change that measurement snapshot.

Use a repository checkout with Node.js 22+, a working `agy` login, and an
OpenRouter credential exported as `OPENAI_API_KEY`. The scripts have no runtime
dependencies. Do not save your key in a tracked file or pass it on the command
line. `OPENAI_BASE_URL` and local fast-jev configuration do not change the fixed
official Jev endpoint or the two models for this experiment.

```sh
# Freeze a plan without making model calls; no API key is needed.
node experiments/compare.mjs --timeout 60000 --batch-sizes 8,1 \
  --plan --out experiments/results/my-comparison-plan

# Development-only interface check, kept separate from test measurements.
node experiments/compare.mjs --timeout 60000 --batch-sizes 8,1 --split dev --limit 8 \
  --out experiments/results/my-comparison-dev

# Full fresh round: 64 test cases, singleton and batches of eight, both backends.
node experiments/compare.mjs --timeout 60000 --batch-sizes 8,1 \
  --out experiments/results/my-comparison

# Recompute scores and audit raw artifacts offline; no key or AGY needed.
node experiments/compare-report.mjs experiments/results/my-comparison
```

Every output directory must be new. The completed follow-up made 144 measured
requests and four excluded warmups. AGY may take several minutes. Each request
has a 60-second timeout; calls are serial with no application retries. Backend
order alternates within paired batches to reduce a fixed ordering bias.

`--split dev --limit 8` is an interface check, not a substitute for the full test.
Use `node experiments/compare.mjs --help` for supported overrides; keep changed
settings in separate result directories. Never replace failed requests with
silently retried successful predictions.

## Read the results

The comparison report includes one row per backend and batch size. Reported
accuracy includes backend failures in its attempted-case denominator. Coverage
and `not_run` disclose any stopping; a partial run is not a completed comparison.
Score tasks retain continuous native values and report both ≤ 0.5 accuracy and
MAE/exact match. These are distinct quality measures.

Request p50/p95 use successful calls; all-attempt latency and failure counts are
also shown. AGY timing includes a new AGY process, while Jev uses the HTTP native
decision endpoint with connection reuse. This measures the complete calling
pathway, not pure model inference. Batch mean divided by case count is amortized
cost; each item still waits for its batch to finish.

The 64 English/Chinese synthetic test cases were previously observed. Their
rule-derived labels have not been independently human-annotated. One fresh run
can describe this workload, but cannot establish a general production ranking.
Each batch mode attempted eight requests. Successful latency uses six samples
for AGY and eight for Jev; nearest-rank p95 is the maximum of each successful
sample set. Native Jev confidence/probabilities and AGY's self-reported
confidence are not interchangeable.

## Audit artifacts

The top-level manifest and paired sequence record both backends' schedule. Each
backend/mode directory contains a case snapshot, raw request records, per-case
records, a runtime summary, and an independently recomputed report. Development
warmup cases are preserved separately for reconstruction. Source/data hashes
identify the measured implementation and inputs.

For Jev, `request_sha256` identifies the same logical request passed to AGY.
The separate `native.wire_request_sha256` identifies the actual native API body.
Allowlisted native answers are retained, including continuous Noul and Score
values. The report rebuilds the native body and verifies both its hash and the
raw-answer-to-prediction conversion. Credentials, response headers, provider
request IDs, and arbitrary error bodies are excluded.

The verifier recomputes scores from saved predictions and labels, checks identical
case order/grouping across backends, and audits request sequence and timing.
Integrity hashes detect inconsistencies; they do not independently prove an
editable artifact's origin. Preserve the complete directory and measured source
revision when sharing results.

中文：本实验通过 Jev 原生 Decisions API 与本机 AGY 进行同题配对测试，单条与
每批八条分别统计。复现需要源码、可用 AGY，以及仅存在于本地环境变量中的
OpenRouter key。先用开发集检查接口，再固定设置跑完整测试；最后可完全离线
重算得分与时延并校验原生答案映射。超时、失败和未运行案例均保留，不用历史
AGY 成绩替代本次实测，也不把批量摊销时间当作单条响应延迟。
