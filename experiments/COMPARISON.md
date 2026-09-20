# AGY / OpenRouter Jev comparison

This experiment compares fast-jev's AGY backend (`gemini-3.8-flash-low`) with
OpenRouter's **native Decisions API** (`typesafe/jev-1.13`). The regular fast-jev
OpenAI-compatible provider uses Chat Completions and is not the adapter used for
this native-decision benchmark.

The [frozen protocol](protocols/agy-jev-openrouter-20260920.md) defines the data,
mapping, timing, stopping rules, and interpretation before measured test calls.
Both backends are measured again; earlier AGY numbers are not reused as the new
comparison arm.

## Reproduce

Use a repository checkout with Node.js 22+, a working `agy` login, and an
OpenRouter credential exported as `OPENAI_API_KEY`. The scripts have no runtime
dependencies. Do not save your key in a tracked file or pass it on the command
line. `OPENAI_BASE_URL` and local fast-jev configuration do not change the fixed
official Jev endpoint or the two models for this experiment.

```sh
# Freeze a plan without making model calls; no API key is needed.
node experiments/compare.mjs --plan --out experiments/results/my-comparison-plan

# Development-only interface check, kept separate from test measurements.
node experiments/compare.mjs --split dev --limit 8 \
  --out experiments/results/my-comparison-dev

# Full fresh round: 64 test cases, singleton and batches of eight, both backends.
node experiments/compare.mjs --out experiments/results/my-comparison

# Recompute scores and audit raw artifacts offline; no key or AGY needed.
node experiments/compare-report.mjs experiments/results/my-comparison
```

Every output directory must be new. A complete formal run makes 144 measured
requests and four excluded warmups. AGY may take several minutes. Each request
has a 30-second timeout; calls are serial with no application retries. Backend
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
Eight batch requests provide only eight latency observations; their nearest-rank
p95 is the maximum. Native Jev confidence/probabilities and AGY's self-reported
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
