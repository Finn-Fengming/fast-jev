# Privacy and publication / 隐私与发布内容

The publication audit covers tracked files, reachable Git history, commit metadata,
and the release archive. No real credentials, private keys, private account email,
personal filesystem paths, or internal company service addresses were found in the
reviewed material. This is a scoped review, not a guarantee that arbitrary future
inputs or backend responses are safe to publish.

Unrelated local AGY model and capability inventories have been removed from saved
diagnostics and reachable history. Published probe metadata includes only the
tested model, required flags and version. Scored answers, labels, timings and
timeout failures remain unchanged. See [experiment provenance](https://github.com/Finn-Fengming/fast-jev/blob/main/experiments/PROVENANCE.md).

The release archive uses an explicit file allowlist. It excludes `.git`, tests,
experimental result files, `.env`, `.npmrc`, credential files, caches and logs.
The project also ignores common local secret-file extensions and distribution
outputs to reduce accidental commits. Public GitHub attribution uses a noreply
email address. Token counts and synthetic test credentials are not access tokens.

AGY errors use fixed diagnostic advice instead of copying arbitrary backend text.
Usage metadata retains only supported numeric token counters. Public experiment
metadata does not store compatible API hostnames or paths. These changes affect
diagnostics and metadata, not the recorded benchmark predictions or scoring.

Your decision inputs intentionally go to the selected backend and model outputs
may contain input-derived text. `--dry-run` prints your input and prompt;
`config` shows local configuration with the API key omitted. Review such output
before sharing it. fast-jev does not manage or export agy's login credentials;
agy's own authentication and logs remain under its control.

中文：本次检查覆盖仓库文件、可达提交历史与安装包，未发现真实密钥、私钥、私人
邮箱、个人目录路径或企业内部服务地址。已精简与实验无关的本机诊断清单，保留
复现所需的被测版本、型号与必要参数。安装包仅包含运行代码、示例及文档。
模型输入输出本身仍可能包含用户提供的信息；发布自己的日志或数据前需单独检查。
