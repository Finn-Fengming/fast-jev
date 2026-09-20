# Published Jev references / Jev 公开实验参考

Accessed **2026-09-20**. We inspected original reports, aggregate JSON and timing code. **No Jev inference was run and none of these model results was reproduced locally.** [Machine-readable records](jev-public.json) include immutable source commits, downloaded-source SHA-256, metric definitions and missing fields as `null`.

这些是外部作者报告，不能与 fast-jev 的新 synthetic 测试集直接排名。下面保留不同任务的强项与弱项；不拼接不同数据集的最佳准确率和最低时延来宣称胜出。

## 1. Independent classification pilot

AbdelStark, 2026-09-17, resolved model **jev-1.13.0**, deterministic BTZSC sample, 100 examples per dataset. Client location: France. Each row is a separate task.

| Dataset | Classes | n | Accuracy | p50 ms | p95 ms |
|---|---:|---:|---:|---:|---:|
| AG News | 4 | 100 | 91.0% | 255.9 | 332.3 |
| Banking77/BTZSC | 72 | 100 | 87.0% | 246.4 | 334.2 |
| DAIR Emotion | 6 | 100 | 48.0% | 236.3 | 289.4 |

Source: [aggregate JSON](https://github.com/AbdelStark/jev-benchmarks/blob/0d610cc53e79bcbec691312b0c4adb4a0e371642/results/reports/btzsc-pilot-v1.json), [report](https://github.com/AbdelStark/jev-benchmarks/blob/0d610cc53e79bcbec691312b0c4adb4a0e371642/results/reports/btzsc-pilot-v1.md).

The dataset revision is `fef2a2ac62b69c58670047dddf045c53d7c3cb5e`, seed `20260917`. Accuracy uses probability argmax versus gold. Latency wraps the SDK call in a serial loop, includes network and the first connection, and has no Jev warmup. The retained predictions have zero final failures, but four earlier validation failures were retried; this is not a zero-error first-attempt run. Banking excludes 200 rows without a positive candidate. Raw predictions are not public, so published hashes alone cannot enable independent offline recomputation. [Timing adapter](https://github.com/AbdelStark/jev-benchmarks/blob/0d610cc53e79bcbec691312b0c4adb4a0e371642/src/jev_benchmarks/adapters/jev.py), [runner](https://github.com/AbdelStark/jev-benchmarks/blob/0d610cc53e79bcbec691312b0c4adb4a0e371642/src/jev_benchmarks/runner.py).

## 2. Independent Korean/English and batching audit

jujumilk3, 2026-09-18, **jev-1.13.0**, Seoul. Values below come from aggregate JSON; they are more precise than the prose report.

| MMLU-ProX condition | n | Accuracy | Median ms |
|---|---:|---:|---:|
| English | 999 | 81.28% | 254.1 |
| Korean | 999 | 74.77% | 255.9 |
| Korean state, English instruction | 999 | 74.77% | 256.0 |
| English, question removed | 300 | 46.33% | 261.1 |
| Korean, question removed | 300 | 38.33% | 258.7 |

The blind controls use smaller subsets; the language arms share items. Accuracy grades the selected label among successful calls. Dataset revision and actual worker counts are not recorded in the aggregate. [MMLU-ProX results](https://github.com/jujumilk3/jev-calibration-audit/blob/daab9e2c2d5d5683bf07f3482deb653c26856219/results/parallel_ko_en.json).

| KoBBQ target-question condition | Paired n | Accuracy | p50 ms | p95 ms |
|---|---:|---:|---:|---:|
| Alone | 247 | 96.76% | 255.9 | 477.4 |
| With 10 fillers | 247 | 97.17% | 263.6 | 427.6 |
| With 10 fillers + 5 hostile questions | 247 | 97.17% | 271.4 | 415.2 |

The report says 250 items; JSON retains **247 matched successful items**. Accuracy concerns only the target question, not every bundled answer. [Paired results](https://github.com/jujumilk3/jev-calibration-audit/blob/daab9e2c2d5d5683bf07f3482deb653c26856219/results/interference.json).

The frequently quoted 280/397 ms single-question p50/p95 comes from only **15 repeated requests**. Another saved probe has n=10 and 294.7/971.2 ms. Both are preserved in JSON, with three-question controls. The source's p95 is the sample maximum at these sample sizes. [First probe](https://github.com/jujumilk3/jev-calibration-audit/blob/daab9e2c2d5d5683bf07f3482deb653c26856219/results/preflight.json), [second probe](https://github.com/jujumilk3/jev-calibration-audit/blob/daab9e2c2d5d5683bf07f3482deb653c26856219/results/preflight_n50.json).

**Timing caveat:** the client resets its timer for each HTTP attempt. Earlier failed attempts, retry waits, response JSON parsing and CLI startup are excluded. These numbers are not complete-workflow wall time. [Client implementation](https://github.com/jujumilk3/jev-calibration-audit/blob/daab9e2c2d5d5683bf07f3482deb653c26856219/src/jev_audit/client.py).

## 3. Controlled synthetic behavior study

RINNECODER, 2026-09-16, **jev-1.13.0**, four workers, no automatic retries. The selected report supplies no aggregate latency or client region.

| Task | Correct / calls | Accuracy |
|---|---:|---:|
| Purpose-focused direct decisions | 288 / 288 | 100% |
| Descriptive action choices | 288 / 288 | 100% |
| Two-step decision pipeline | 288 / 288 | 100% |
| Arithmetic, all option orders | 288 / 432 | 66.67% |
| Regular logical chains | 162 / 162 | 100% |
| Scrambled logical chains | 25 / 54 | 46.30% |
| Dispersed version lookup | 43 / 54 | 79.63% |

The first three rows share 48 scenarios; arithmetic contains only six distinct problems. Counts include repeated requests, not independent new problems. Harder follow-ups were adaptive. Published raw artifacts and an offline verifier are available, but we did not run their verifier. These results motivate boundary tests; they are not general model accuracy estimates. [Original report](https://github.com/RINNECODER/jev-behavior-study/blob/e4a1d7ec691a91f33d3b5879a780e6f27328f173/DECISION_AND_LIMITS_REPORT.md).

## 4. Vendor workflow evaluation

The official chart's rounded Jev point reports **67.8% agreement, 0.4 s mean workflow time and $0.0004 per case**, averaged equally across four workflows. The inspected chart does not identify an exact Jev version, sample count, experiment date or concurrency; those fields remain `null`. The reference labels come from high-thinking GPT-6 Astra and Claude Fable 5.1, not human gold labels. This is a vendor result and a different metric from classification accuracy. [Official evaluation](https://evals.typesafe.ai/).

The launch article says published evaluations generally ran from West Coast laptops near the service. That is approximate context, not a verified region for every chart point. Its 70–500 ms range and advertised relative speedups are not a reproducible p50/p95 baseline. [Launch article, 2026-09-15](https://typesafe.ai/blog/introducing-system-one-models-and-jev).

## How to use these references / 比较规则

Use these rows as **historical external references**, with the local agy results reported separately. A higher score on a different dataset or a lower per-item batch time does not establish a win. A valid direct comparison requires the same item IDs, labels, choices, question semantics, failure policy and timing boundary, plus documented model versions, concurrency, retries, warmup and regions.

复核本文件可直接查看冻结 commit 的原始链接，并对下载内容核验 JSON 中的 SHA-256。这里复现的是“资料来源与指标摘录”；模型推理未本地复现。缺失数据不补零，也不把外部数值包装成我们的实验。
