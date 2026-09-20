# Experiment source provenance

## Current paired AGY / native Jev measurement

The current entry point is the [60-second follow-up](protocols/agy-jev-openrouter-60s-20260920.md), its [report](results/agy-jev-openrouter-60s-test-20260920/comparison.md), and [COMPARISON.md](COMPARISON.md). The [initial 30-second protocol](protocols/agy-jev-openrouter-20260920.md) and [partial report](results/agy-jev-openrouter-test-20260920/comparison.md) remain linked beside it.

The 60-second follow-up is final with status `completed_with_errors`: all 148 planned calls were attempted, and every backend/mode covers 64/64 cases. Seven measured AGY requests failed (five singleton, two batch); their affected cases remain in the end-to-end denominator. The separately recomputed report records two UTC-versus-monotonic timing warnings while passing monotonic duration and serial non-overlap checks. All 22 measured source-file hashes remained unchanged. The [analysis](results/agy-jev-openrouter-60s-test-20260920/analysis.md) accompanies the full original records.

The initial attempt stopped after three consecutive AGY timeouts. Each backend attempted 15/64 singleton cases: AGY had eight correct outputs and seven timeouts; Jev scored 15/15. The remaining 49 singleton cases and all batch cases are `not_run`. Those original records are preserved; the follow-up neither fills their gaps nor selects each case's best output across attempts.

The follow-up explicitly revises both backends' deadline to 60,000 ms and mode order to 8, then 1. This was written after observing initial failures and before new calls. It retains the same model, adapter, prompts, labels, score mapping, no-retry policy and stopping rules. A separate three-case [development diagnostic](results/agy-jev-timeout-dev-20260920/README.md) succeeded with a stream observer at 60 s but did not establish the timeout cause. No production fix was made, and formal calls omit the observer. Neither attempt is a new blind holdout.

Both formal attempts use the implementation frozen at
`d09f2408e79b32b4bec99db62af10268911c1195` and aggregate source SHA-256
`9f6c59b2ece1d41e07859d9b8973c02ace983af790cbd5bff00d8d49bab82b75`.
The initial manifest records that implementation commit as its runtime HEAD.
The follow-up manifest records its actual runtime HEAD
`60066f40dfe74cc18eac7ab88527ce7a165b38f6`, which also contains the preserved
initial evidence and revised protocol. Its measured implementation files and
aggregate source hash are unchanged. Each manifest retains per-file hashes;
subsequent publication commits do not replace recorded measurement snapshots.

The separate development interface check in
[`agy-jev-openrouter-dev-20260920`](results/agy-jev-openrouter-dev-20260920/)
was run from an **uncommitted working-tree snapshot**. Its manifest correctly
records the then-current Git HEAD
`1acd3349575e75c05e4c547051c11d208f46ee5c`, while its source SHA-256 is
`83e3266dbbd0dab7f27282f750064e970df075b07d3469900e68605f6a660544`.
That HEAD alone does not reconstruct the uncommitted experiment files. The
recorded file hashes identify what was measured and differ from the later formal
commit. Development outputs are excluded from the formal quality and latency
table; neither their hashes nor their commit identifiers are rewritten to match
the formal run.

The paired runner preserves original attempt records and sanitized native Jev
answers. The reporter independently rebuilds logical and native wire requests,
normalizes native answers, re-scores frozen labels, and checks the complete
alternating schedule and observed execution prefix. Report-generation timestamps
and evaluator hashes identify the code that recomputed a report; they do not
change the source that made the original provider calls. Hashes establish internal
consistency, not independent provenance.

中文：初轮 30 秒实验因连续超时按约定停止，原始失败和未运行记录完整保留。后续协议是在观察到初轮失败后、开始新调用前公开修订：双方改为 60 秒，先每批 8 例再单例，其他评估规则与被测实现保持不变。开发观察代理的三次成功不能确证超时原因，没有因此修复生产代码，正式调用不使用代理。

两轮实现都对应 `d09f240` 和相同源码 hash；后续启动时真实 HEAD 为 `60066f4`，其中额外保存了初轮证据和修订协议，manifest 不将该提交伪装成另一份实现。更早开发接口检查的 HEAD 与未提交工作树快照分别保留。两轮不拼接最佳预测，也不称为新增盲测。

## Historical publication and baseline

Git history was republished on 2026-09-20. Historical AGY-only and lean-agent
reproduction commands use baseline `103de936da5072a5681b96a67ef2e42e48316195`.

The saved experiment manifests retain their original run-time commit identifiers
and source hashes. These identify the measurement snapshot, not the newly published
Git commits, and the old commit identifiers may no longer resolve. They have not
been replaced with identifiers that did not exist at measurement time.

The republished baseline retains the production files under `src/` and the fixed
dataset byte-for-byte from their measurement versions. The republished baseline changes documentation, generic
experiment error reporting and failure fixtures; prompts, model configuration,
scoring, schedules, raw predictions, timeout failures and timings are unchanged.
The release code additionally limits diagnostic messages and usage metadata, reads
the CLI version from package metadata, and minimizes exported probe/endpoint details.
Those release-time changes were not a new measurement of the historical runs;
the later paired experiment above records its own implementation and new calls.
The historical single-backend runner also includes the post-measurement timeout-classification fix
in [ERRATA.md](ERRATA.md). Runner source hashes therefore differ from those recorded
at execution, as disclosed here; this is not a new model evaluation.

The retained lean-agent source copies are unchanged. The isolated-worktree commands
in [variants/README.md](variants/README.md) use the republished baseline and the same
selected development cases. The frozen evaluation parameters and all evidence
needed to recompute reported accuracy and latency remain available.

中文：Git 历史重新发布后，复现命令使用新的基线提交。实验清单仍保留运行时的
原始提交标识与源码哈希，不把新提交伪装成当时的源码版本。基线推理代码、固定
数据集、原始预测、超时记录、耗时和评分未改变。发布版随后增加诊断与元数据
隐私限制、版本读取和安装包检查，没有据此更改旧实验成绩；本轮配对实验另存新调用记录。

## Published diagnostic metadata

Five `probe.json` files and the live preflight `stdout.json.agy` object are minimized
to the tested version/model and required flags. Their `metadata_scope` and
`privacy_note` fields identify this editorial change. The same cleanup was applied
to reachable history. Raw prediction/request records, labels, timings, manifests,
summary metrics and recomputed reports are unchanged. Probe files are not inputs
to scoring or recorded artifact-hash verification.
