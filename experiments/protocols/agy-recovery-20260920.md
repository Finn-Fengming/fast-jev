# AGY recovery evaluation protocol — 2026-09-20

Frozen at **2026-09-20T06:26:27Z**, before sending any held-out test cases to AGY in this recovery run. Availability checks and tuning have used diagnostic or development cases only. This document records the decision made before formal testing; it must not be rewritten to favor subsequent results.

## Selected implementation and development evidence

Use the current production `src/agy.mjs` from baseline commit `bcac77dff826e688b081761357eea24e07fbe833`, with its existing prompt construction and output validation. The adapter SHA-256 at protocol freeze is `09e974fc25d9a3951e8fa3ac9d17de42aeab3b9c422256fc2e4624e9605dc82e`.

An isolated lean-agent candidate was evaluated on the same eight development cases. Both variants answered 8/8 correctly. Production had request p50 **12,570.026 ms**, mean **13,069.339 ms**, and p95 **20,561.107 ms**; the candidate had p50 **11,955.326 ms**, mean **13,396.2295 ms**, and p95 **25,575.763 ms**. These are small, sequential development trials, not a statistically established speed difference. The candidate's lower p50 did not accompany better mean or tail latency, so it is **not adopted**.

A separate candidate audit observed `init.agent: fast-jev`, 57 advertised tools, zero tool events, `num_turns: 2`, and 26,492 input tokens. This confirms the requested agent name was reported, but does not establish tool-free execution or explain the token/turn accounting. No conclusion about the cause of these values is assumed. Candidate and audit sources remain research artifacts in `experiments/variants/`.

## Fixed formal protocol

| Setting | Frozen value |
|---|---|
| Provider / requested model | `agy` / `gemini-3.8-flash-low` |
| Configuration | Explicit `examples/config.json`; explicit `--agy-bin agy` |
| Effort | Unset `FAST_JEV_EFFORT`; no effort flag or configured effort |
| Timeout | 30,000 ms per request, explicitly overriding the example config |
| Data | All 64 cases with `split: test`; no `--limit` |
| Dataset SHA-256 | `f0bfdd47121bf16ee1600583ea06aa58a69aeecd8e5d679560dc1447ba696e2c` |
| Seed / concurrency | `20260920` / 1 |
| Process | Fresh AGY process and temporary workspace per request |
| Retries | None in fast-jev; AGY/provider internal retries and caching are not controlled |
| Warmup | One development-case request per mode, excluded from formal metrics |
| Failure stop | Failed warmup stops the run; three consecutive measured request failures stop the remaining schedule |

Run modes sequentially. Do not alter the production source, prompts, model, labels, or scoring after inspecting held-out results. Any later investigation or changed configuration must be separately labeled with new artifacts and must disclose that the holdout has been seen. The external Jev figures remain historical, unmatched references using different data and environments; this protocol cannot establish superiority over Jev.

## Schedules and pre-test amendment

The historical no-inference plan used three repeats for each mode. Based only on observed development latency of roughly 13 seconds per singleton request, the recovered **singleton schedule is reduced to one repeat before testing**: 64 measured requests plus one warmup. Primary accuracy already uses repeat 0, so all 64 held-out cases remain covered. There will be **no singleton repeat-consistency claim**; singleton latency uses 64 requests rather than the historical planned 192.

The recovered **batch-of-eight schedule keeps three repeats**: 64 cases × 3 repeats, 24 measured requests plus one warmup. Its primary accuracy also uses repeat 0; later repeats support consistency and latency observations, not additional independent quality samples. The two modes have different latency sample counts. Their first-repeat case ordering uses the same fixed seed, with batch boundaries determined by batch size.

Use new directories; retain the historical `agy-single` and `agy-batch-8` plan-only records unchanged:

```bash
env -u FAST_JEV_EFFORT node experiments/run.mjs \
  --config examples/config.json --provider agy \
  --model gemini-3.8-flash-low --agy-bin agy --timeout 30000 \
  --split test --repeats 1 --batch-size 1 --warmup 1 \
  --seed 20260920 --max-errors 3 \
  --out experiments/results/agy-recovered-test-single

env -u FAST_JEV_EFFORT node experiments/run.mjs \
  --config examples/config.json --provider agy \
  --model gemini-3.8-flash-low --agy-bin agy --timeout 30000 \
  --split test --repeats 3 --batch-size 8 --warmup 1 \
  --seed 20260920 --max-errors 3 \
  --out experiments/results/agy-recovered-test-batch-8

node experiments/report.mjs experiments/results/agy-recovered-test-single
node experiments/report.mjs experiments/results/agy-recovered-test-batch-8
```

## Evidence and interpretation

Each run captures source hashes, data and selected-case snapshot hashes, requested configuration, AGY version/model probe, environment, planned order, attempted outputs, errors, elapsed time, and unrun cases. The saved Git commit is supplemented by file hashes when the workspace contains uncommitted documentation or artifacts. These are auditable local records, not cryptographic attestation of a serving-model version.

Recompute reports from saved predictions and labels. Retain failed requests and unrun-case coverage. Primary end-to-end quality includes attempted backend failures in its denominator. Score tasks report exact match and MAE alongside the predefined absolute-error ≤ 0.5 tolerance metric. Request p50/p95 include AGY process and wrapper time, and exclude warmup/probe/outer report-writing time. Batch time divided by eight is amortized cost, not individual-case response latency. The synthetic, AI-assisted dataset has not been independently human annotated and does not establish production generalization.

## Publication note

Git history was republished after measurement. The baseline identifier above is the
original run-time identifier; reproduction commands now use the republished baseline.
See [source provenance](../PROVENANCE.md). Inference source, dataset, schedules,
outputs and scoring were not changed by this editorial update.
