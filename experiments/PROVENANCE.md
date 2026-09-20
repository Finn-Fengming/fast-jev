# Source provenance after history publication

Git history was republished on 2026-09-20. Reproduction commands use baseline
`103de936da5072a5681b96a67ef2e42e48316195`.

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
These post-measurement changes have not been re-benchmarked against the model.
The current runner also includes the post-measurement timeout-classification fix
in [ERRATA.md](ERRATA.md). Runner source hashes therefore differ from those recorded
at execution, as disclosed here; this is not a new model evaluation.

The retained lean-agent source copies are unchanged. The isolated-worktree commands
in [variants/README.md](variants/README.md) use the republished baseline and the same
selected development cases. The frozen evaluation parameters and all evidence
needed to recompute reported accuracy and latency remain available.

中文：Git 历史重新发布后，复现命令使用新的基线提交。实验清单仍保留运行时的
原始提交标识与源码哈希，不把新提交伪装成当时的源码版本。基线推理代码、固定
数据集、原始预测、超时记录、耗时和评分未改变。发布版随后增加诊断与元数据
隐私限制、版本读取和安装包检查，没有重新运行模型 benchmark。

## Published diagnostic metadata

Five `probe.json` files and the live preflight `stdout.json.agy` object are minimized
to the tested version/model and required flags. Their `metadata_scope` and
`privacy_note` fields identify this editorial change. The same cleanup was applied
to reachable history. Raw prediction/request records, labels, timings, manifests,
summary metrics and recomputed reports are unchanged. Probe files are not inputs
to scoring or recorded artifact-hash verification.
