# Source provenance after history publication

Git history was republished on 2026-09-20. Reproduction commands use baseline
`103de936da5072a5681b96a67ef2e42e48316195`.

The saved experiment manifests retain their original run-time commit identifiers
and source hashes. These identify the measurement snapshot, not the newly published
Git commits, and the old commit identifiers may no longer resolve. They have not
been replaced with identifiers that did not exist at measurement time.

All production files under `src/` and the fixed dataset are byte-identical to their
measurement versions. The republished baseline changes documentation, generic
experiment error reporting and failure fixtures; prompts, model configuration,
scoring, schedules, raw predictions, timeout failures and timings are unchanged.
The current runner also includes the post-measurement timeout-classification fix
in [ERRATA.md](ERRATA.md). Runner source hashes therefore differ from those recorded
at execution, as disclosed here; this is not a new model evaluation.

The retained lean-agent source copies are unchanged. The isolated-worktree commands
in [variants/README.md](variants/README.md) use the republished baseline and the same
selected development cases. The frozen evaluation parameters and all evidence
needed to recompute reported accuracy and latency remain available.

中文：Git 历史重新发布后，复现命令使用新的基线提交。实验清单仍保留运行时的
原始提交标识与源码哈希，不把新提交伪装成当时的源码版本。生产推理代码、固定
数据集、原始预测、超时记录、耗时和评分未改变；变化涉及文档、实验错误文案与
测试示例，另有已公开说明的超时分类修复。
