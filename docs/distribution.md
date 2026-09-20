# Install and download / 安装与下载

fast-jev is distributed as a small, dependency-free npm-format archive on public
GitHub Releases. Node.js 22+ and npm are required; Git and an npm account are not.
The archive is platform independent; the selected backend must work on your machine.

## One-command installation

```sh
npm install -g https://github.com/Finn-Fengming/fast-jev/releases/latest/download/fast-jev.tgz
fjev --version
fjev doctor
```

`doctor` checks your backend setup. To try the CLI without a global installation:

```sh
npx --yes --package=https://github.com/Finn-Fengming/fast-jev/releases/latest/download/fast-jev.tgz fjev --help
```

The same global-install command upgrades to the latest release. A pinned release
uses `/releases/download/v0.1.0/fast-jev.tgz` instead of `/releases/latest/download/fast-jev.tgz`.
The package name is `fast-jev`; do not use `npx fjev`, which would request a different
registry package. No npm-registry publication is claimed.

## Download, verify, then install offline

Download [fast-jev.tgz](https://github.com/Finn-Fengming/fast-jev/releases/download/v0.1.0/fast-jev.tgz)
and [SHA256SUMS](https://github.com/Finn-Fengming/fast-jev/releases/download/v0.1.0/SHA256SUMS)
into the same directory. With macOS:

```sh
shasum -a 256 -c SHA256SUMS
npm install -g ./fast-jev.tgz --offline --ignore-scripts --no-audit --no-fund
```

Linux can use `sha256sum -c SHA256SUMS`; Windows PowerShell can compare
`Get-FileHash .\fast-jev.tgz -Algorithm SHA256` with the downloaded checksum.
Offline installation needs no model credentials. Actual decisions need a working
local agy or a configured compatible API and network access.

If npm's global directory is not writable, use a Node version manager or a
user-owned npm prefix. Newer npm versions may require `--allow-remote` when
installing an HTTPS archive. See the official [npm install](https://docs.npmjs.com/cli/v11/commands/npm-install/)
and [npm exec](https://docs.npmjs.com/cli/v11/commands/npm-exec/) documentation.

## Rebuild the release

Maintainers run these from a source checkout:

```sh
npm test
npm run check
npm run package
npm run test:package
```

The outputs are `dist/fast-jev.tgz` and `dist/SHA256SUMS`. Packaging checks an
explicit file allowlist; the install smoke test uses the exact archive in a fresh
temporary installation, checks both aliases, offline decisions with `--dry-run`,
and the JavaScript API. The release carries the archive and its checksum, without
an installer script or install-time hooks. The installed CLI reads its version
from the packaged `package.json`.

## 中文说明

直接运行本页第一条命令即可安装，无需克隆源码或登录 npm。也可下载 `.tgz`
和校验文件，验证后离线安装。`latest` 用于获取最新版，`v0.1.0` 链接用于
固定版本；升级时重新执行安装命令即可。包内不含实验原始数据、测试目录、Git
历史、本机配置或凭据。需要实验资料时，请查看仓库的 `experiments/`。

仅安装 CLI 不需要调用模型；实际决策复用已配置的本机 agy，或使用你显式设置
的 OpenAI-compatible API。源码开发者可用上述四条检查命令重建并验证安装包。
