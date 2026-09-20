# Experiment errata

## 2026-09-20: AGY timeout category

The frozen recovery singleton run contains two failed requests with the correct
`AGY_TIMEOUT` code but an incorrect `authentication` category and authentication
advice. The runner matched the word `login` in AGY's timeout troubleshooting hint
before checking the timeout code.

| Run | Request | Case | Recorded elapsed time | Correct category |
| --- | --- | --- | ---: | --- |
| `agy-recovered-test-single` | `r2` | `grounded_boolean-en-08` | 30,267.610 ms | `timeout` |
| `agy-recovered-test-single` | `r7` | `grounded_boolean-en-10` | 30,265.159 ms | `timeout` |

The original `requests.jsonl` and `records.jsonl` are preserved. The machine-readable
[correction record](results/agy-recovered-test-single/errata.json) identifies both
requests and hashes the raw files. Both failures already counted against the
62/64 end-to-end correct rate. Error codes, failed status, coverage, predictions,
timings, and all recomputed metrics are unchanged. The recovered batch-of-eight
run has no errors and is unaffected.

After **both** frozen formal runs finished, the runner was corrected to prioritize
stable timeout/cancellation codes over diagnostic text. Ten regression tests cover
the observed failure and other classifications. This changes future experiment
error metadata only; it does not alter production inference, prompts, model
configuration, or scoring. Historical artifacts retain their original source
hashes; the current runner consequently has a different hash. The pre-fix runner is available in the republished baseline
`103de936da5072a5681b96a67ef2e42e48316195`, with generic diagnostic text.
See [source provenance](PROVENANCE.md) for the history update and preserved run-time hashes.

中文：单例实测中的 `r2`、`r7` 实际是超时。旧实验脚本把超时提示中的
`login` 误判为认证问题。原始记录保持不变，另附更正记录；这两次失败始终
计入 64 条案例的分母，因此准确率、耗时和其他指标均无需修改。修复在两组
正式实验完成后进行，只影响后续实验的错误分类。
