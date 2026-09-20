# fast-jev

[English](README.md) · [简体中文](README.zh-CN.md)

在终端里快速完成结构化判断。复用本机 **agy** 登录，或连接 **OpenAI-compatible API**；无需训练模型，零运行时依赖。

```sh
fjev choose "下一步做什么？" \
  --option 发布 --option 排查 \
  --context "发布测试没有通过。" --text
```

借鉴 Jev 的封闭决策模式。这是独立封装，不是 Jev 模型或 TypeSafe API 客户端。置信度来自**模型自报，未经校准**。原理、证据和取舍见[完整调研](docs/research-jev.md)。

## 安装

需要 **Node.js 22+**（自带 npm）。直接安装公开的 GitHub Release 包，无需克隆源码，也无需 npm 账号：

```sh
npm install -g https://github.com/Finn-Fengming/fast-jev/releases/latest/download/fast-jev.tgz
fjev --help
```

也可以不做全局安装，直接试用：

```sh
npx --yes --package=https://github.com/Finn-Fengming/fast-jev/releases/latest/download/fast-jev.tgz fjev --help
```

`fast-jev` 与 `fjev` 是同一个命令。[直接下载安装包](https://github.com/Finn-Fengming/fast-jev/releases/latest/download/fast-jev.tgz) · [SHA-256 校验值](https://github.com/Finn-Fengming/fast-jev/releases/latest/download/SHA256SUMS) · [固定版本与离线安装](docs/distribution.md)。

当前使用 **GitHub Releases** 分发，尚未发布 npm registry 同名包，请使用上面的完整链接。开发者仍可在源码目录执行 `npm install -g .`。

## 选择后端

### agy：默认后端

确保本机 `agy` 已安装、已登录并能正常使用。不需要额外 key、配置文件或 `init` 步骤。

```sh
fjev doctor
fjev check "健康检查是否成功？" --context "HTTP 200 OK"
```

默认模型为 `gemini-3.8-flash-low`，该标识已在检查的本机 `agy models` 中确认。可用 `--model ID` 或 `--agy-bin /path/to/agy` 覆盖；实际模型可用性取决于你的 agy 安装和账户。

agy 在临时工作目录中运行，通过 stdin 接收提示，并读取临时 schema 文件。适配器启用 agy 的 plan 模式与 sandbox，禁用斜杠命令。它复用现有登录和用户级设置；临时目录不是独立配置档，也不代表所有工具均不可用。权限、认证和日志仍由本机 agy 管理。

### OpenAI-compatible API

显式指定后端和模型：

```sh
export OPENAI_API_KEY='your-key'
fjev check "健康检查是否成功？" --context "HTTP 200 OK" \
  --provider openai \
  --base-url https://gateway.example/v1 \
  --model your-model-id
```

`--base-url` 支持以 `/v1` 结尾的 API 根路径，也支持完整 `/chat/completions` 地址，默认值为 `https://api.openai.com/v1`。本地免认证端点可以不设置 key。

输出模式需要明确选择：

| `--response-format` | 行为 |
| --- | --- |
| `json_schema`，默认 | 请求 strict JSON Schema 输出 |
| `json_object` | 请求 JSON mode |
| `text` | 不发送 `response_format`，在提示中要求 JSON |

各兼容服务支持的能力不同。不支持 strict schema 时，可自行选择 `json_object` 或 `text`；所有模式都执行相同的本地校验。**fast-jev 不会自动降级模式、切换后端或重试。** `--effort` 和 `--max-tokens` 均可选，仅在后端支持对应值时设置。

## 命令

```sh
# 单选；classify 是别名
fjev choose "应由哪个团队处理？" --option 账单 --option 技术 --option 其他 \
  --context "同一笔订单扣了两次钱。"
echo "我无法登录" | fjev classify "应由哪个团队处理？" \
  --options '["账单","技术","其他"]'

# 是非判断；有效的 false 也属于成功结果
fjev check "这是一条缺陷报告吗？" --file ticket.txt

# 数值评分，默认范围为 0–1
fjev score "紧急程度：0 是日常事项，10 是正在发生的服务中断。" \
  --min 0 --max 10 --context "结账服务不可用。" --explain

# 对 JSON 数组降序排名，或保留符合条件的条目
printf '%s\n' '[{"name":"增加缓存","effort_days":2},{"name":"重写服务","effort_days":60}]' | fjev rank "预期收益相对于投入的性价比" --top 1
printf '%s\n' '[{"name":"增加缓存","effort_days":2},{"name":"重写服务","effort_days":60}]' | fjev filter "能在两天内完成吗？"

# 一次模型调用回答多个类型化问题；batch 是别名
printf '%s\n' '{"state":"HTTP 200 OK","questions":[{"id":"healthy","type":"boolean","prompt":"请求是否成功？"}]}' | fjev batch --pretty

# 配置与诊断
fjev config --pretty
fjev doctor
fjev doctor --live
```

单项判断通过 `--context`、`--file` 或管道输入文本。`--context` 与 `--file` 可以合并；两者均未提供时才读取管道文本。`rank` / `filter` 接收 JSON 数组，`decide` 接收请求对象；支持 `--input FILE`、`--input -` 或直接管道输入 JSON。`rank` / `filter` 还可用 `--context` / `--file` 添加共享上下文。

`rank`、`filter`、`decide` 会将问题合并到**一次调用**，不会逐条发起模型请求；这不代表模型内部独立或并行推断。每次最多 **100 个问题/条目**，序列化输入上限 **256 KiB**；单选支持 **2–100 个不重复字符串**。响应格式不合法时，整次调用失败。

## 结果与拒绝决策

默认输出 JSON。`--pretty` 美化格式，`--text` 只输出值；对于 `rank` / `filter`，输出保留条目的 JSON 数组。`--explain` 增加简短理由。

以下仅展示输出结构，不是性能实测：

```json
{
  "command": "choose",
  "result": {
    "id": "decision",
    "type": "choice",
    "value": "排查",
    "confidence": 0.91,
    "status": "ok"
  },
  "meta": {
    "provider": "agy",
    "model": "gemini-3.8-flash-low",
    "elapsed_ms": 1500,
    "backend_duration_ms": null,
    "usage": null,
    "confidence_kind": "self_reported",
    "calibrated": false
  }
}
```

`score.value` 表示所问维度的分值，`confidence` 表示模型对答案的支持程度，二者相互独立。当前版本直接返回选项、布尔值或范围内的数值；**不输出 Jev 候选概率分布，也不复现其 Score / Noul 语义**。

```sh
fjev choose "下一步做什么？" --option 发布 --option 排查 \
  --context "测试结果缺失。" --min-confidence 0.8
```

低于阈值时，`value` 设为 `null`，`status` 设为 `abstained`，退出码为 **4**。默认阈值为 0。排名/筛选会从 `result` 中排除这些条目，并在 `abstained` 字段单独列出；只要有一项拒绝决策，退出码仍为 4。阈值是分流规则，不是准确率保证。

| 退出码 | 含义 |
| --- | --- |
| `0` | 有效结果，包括布尔值 `false` |
| `1` | 后端或输出错误 |
| `2` | 输入或配置不合法 |
| `4` | 至少一项拒绝决策 |
| `124` | 超时 |
| `130` | 已取消 |

结果写入 stdout，错误以 JSON 写入 stderr。后端默认超时 **60 秒**，可用 `--timeout MS` 修改。

## 配置

配置文件是可选的。默认读取 `$XDG_CONFIG_HOME/fast-jev/config.json`，未设置 XDG 时读取 `~/.config/fast-jev/config.json`。也可通过 `--config PATH` 或 `FAST_JEV_CONFIG` 指定路径。将[配置模板](https://raw.githubusercontent.com/Finn-Fengming/fast-jev/main/examples/config.json)另存为 `config.json`：

```sh
fjev config --config config.json --pretty
fjev check "是否准备就绪？" --context "全部必要检查已通过。" \
  --config config.json --provider openai
```

优先级为：**命令行参数 → 环境变量 → 所选后端的配置 → 默认值**。`provider` 和 `timeoutMs` 放在顶层，其余后端字段分别放在 `agy` / `openai` 对象下。API key 放在环境变量中，不写进配置文件；`config` 展示最终配置时不打印 key。

| 环境变量 | 用途 |
| --- | --- |
| `FAST_JEV_PROVIDER` | `agy` 或 `openai` |
| `FAST_JEV_MODEL` | 覆盖当前后端的模型 |
| `FAST_JEV_TIMEOUT_MS` | 后端超时，单位毫秒 |
| `FAST_JEV_AGY_BIN` | agy 可执行文件 |
| `FAST_JEV_EFFORT` | 可选 `low`、`medium`、`high` |
| `OPENAI_BASE_URL` | compatible API 根路径或补全地址 |
| `OPENAI_API_KEY` | compatible API 默认凭据 |
| `FAST_JEV_API_KEY` | 优先于所配置凭据变量的覆盖值 |
| `FAST_JEV_RESPONSE_FORMAT` | `json_schema`、`json_object`、`text` |
| `FAST_JEV_CONFIG` | 显式配置文件路径 |

`openai.apiKeyEnv` 可指定其他凭据变量名。`--max-tokens` / `openai.maxTokens` 对应 API 的 `max_tokens`。`--effort` 对应 agy 参数或 API 的 `reasoning_effort`，未配置时不发送。避免模型后缀与 effort 冲突，例如 `-medium` 的 agy 模型配 `--effort low`。

## JavaScript API

在自己的项目中安装：

```sh
npm install https://github.com/Finn-Fengming/fast-jev/releases/latest/download/fast-jev.tgz
```

```js
import { decide } from 'fast-jev';

const output = await decide({
  state: '发布测试没有通过。',
  questions: [
    { id: 'action', type: 'choice', prompt: '下一步做什么？', options: ['发布', '排查'] },
    { id: 'ready', type: 'boolean', prompt: '测试通过了吗？' },
    { id: 'risk', type: 'score', prompt: '风险：0 低，10 高。', min: 0, max: 10 }
  ]
}, { provider: 'agy', minConfidence: 0.8 });

console.log(output.results);
```

另有 `buildDecision`、`validateRequest`、`validateOutput` 导出。JavaScript API 不会自动加载 CLI 配置或环境变量；使用 HTTP 时显式传入 `{ provider: 'openai', model, baseUrl, apiKey: process.env.OPENAI_API_KEY }`，取消请求可传 `signal: AbortSignal`。

## 检查与测试

```sh
# 只查看请求、提示和 schema，不调用模型
fjev check "HTTP OK?" --context "HTTP 200 OK" --dry-run --pretty

# 以下开发检查在源码目录运行
npm test
npm run check
npm run package
npm run test:package
```

`--dry-run` 输出包含你的输入。`doctor` 检查配置，其中 agy 模型列表可能联系其服务；它不证明推理可用。`doctor --live` 发起一次真实测试判断，可能产生后端用量。测试采用本地固定数据或模拟后端，不能证明模型准确率或生产时延。本地 130 项测试通过；[CI](https://github.com/Finn-Fengming/fast-jev/actions/workflows/ci.yml)的 Linux/macOS × Node.js 22/24 四组任务也全部通过。

可以进行小规模真实调用计时：

```sh
npm run benchmark -- --provider agy --runs 3
npm run benchmark -- --provider openai --model your-model-id --runs 3
```

脚本记录样本、失败和成功调用的 p50/p95。每次 run 都发起真实请求；三次调用只能做冒烟检查，不足以可靠估计尾部时延，也不是准确率或校准评测。

| 现象 | 处理方式 |
| --- | --- |
| 找不到 agy 或缺少必要参数 | 检查 `agy --version`，更新 agy，或设置 `--agy-bin` |
| API HTTP 400 | 检查模型，并显式选择端点支持的输出模式 |
| 超时 | 检查后端连通性，再按需要增加 `--timeout` |

[2026-09-20 的真实检查](experiments/results/agy-recovered-preflight-20260920/report.json)已成功，使用 agy 1.2.7 与 `gemini-3.8-flash-low`：一次决策耗时 20,956 ms，后端报告耗时 7,293 ms。两者计时边界不同，单次检查也不能代表时延分布。完整记录见 [验证文档](docs/validation.md)，实现边界见 [架构说明](docs/architecture.md)。

## 可复现实验

[实验指南](experiments/README.md) 包含固定的 96 条中英文诊断案例（开发集 32、测试集 64）、固定随机种子、逐条原始结果、源码/数据哈希，以及从原始输出重新评分的报告脚本。标签是按明确规则预先生成的 AI 辅助参考答案，未经独立人工标注。

请从克隆的仓库根目录运行以下命令；npm 安装包不包含 `experiments/`。

```sh
# 先查看计划，不调用模型
npm run experiment -- --provider agy --model gemini-3.8-flash-low --plan --split test --out experiments/results/my-plan
# 仅用开发集选配置，冻结后再运行测试集
env -u FAST_JEV_EFFORT npm run experiment -- --config examples/config.json --provider agy --model gemini-3.8-flash-low --agy-bin agy --timeout 30000 --split dev --limit 8 --repeats 1 --out experiments/results/my-dev
env -u FAST_JEV_EFFORT npm run experiment -- --config examples/config.json --provider agy --model gemini-3.8-flash-low --agy-bin agy --timeout 30000 --split test --repeats 1 --batch-size 1 --out experiments/results/my-test-single
env -u FAST_JEV_EFFORT npm run experiment -- --config examples/config.json --provider agy --model gemini-3.8-flash-low --agy-bin agy --timeout 30000 --split test --repeats 3 --batch-size 8 --out experiments/results/my-test-batch-8
npm run experiment:report -- experiments/results/my-test-single
npm run experiment:report -- experiments/results/my-test-batch-8
```

**agy 真实测试结果（2026-09-20）。** 固定的 64 条测试案例已取得真实单例与批量结果：

| 模式 | 首轮正确 / 已尝试案例 | 成功 / 已尝试请求（全部轮次） | 成功请求 p50 / p95 |
| --- | ---: | ---: | ---: |
| [单例，1 轮](experiments/results/agy-recovered-test-single/report.md) | 62/64（96.88%） | 62/64 | 11.92 秒 / 23.73 秒 |
| [每批 8 例，3 轮](experiments/results/agy-recovered-test-batch-8/report.md) | 64/64（100%） | 24/24 | 12.82 秒 / 21.16 秒 |

两次失败均为 30 秒超时限制触发的 `AGY_TIMEOUT`。其余 62 条成功预测全部正确；评分题 16/16 完全命中，MAE 为 0。96.88% 的端到端正确率包含这两次失败；成功请求时延分位数不包含失败，全体请求 p50/p95 为 11.94 秒 / 29.59 秒。

批量模式三轮共 192 次案例执行全部正确，64 条案例的预测跨轮完全一致；重复调用不等于 192 条独立质量样本。平均批次耗时除以八为 **1.69 秒/例**，这是摊销耗时，每次请求 p50 仍为 12.82 秒。这套小规模合成案例不能保证生产环境质量。

原始单例记录的辅助错误类别曾将两次超时误标为 `authentication`；`AGY_TIMEOUT` 错误码、失败数量和指标均正确。[勘误](experiments/ERRATA.md)保留原记录，并说明两组正式运行结束后应用的错误分类修复。

[正式协议](experiments/protocols/agy-recovery-20260920.md)在测试前冻结：完整 64 条测试案例，单例 1 轮、8 例批量 3 轮，超时 30 秒，生产代码保持原样；协议附完整复现命令。此前[单例](experiments/results/agy-recovered-dev-single/report.md)与[批量](experiments/results/agy-recovered-dev-batch-8/report.md)开发检查各答对 8/8。[精简 agent 候选方案](experiments/results/agy-lean-dev-single/report.md)在开发集同样答对 8/8，但平均和尾部时延没有改善，因此未采用。历史 `agy-single`、`agy-batch-8` 目录仍是**未执行的计划**；实际实验另存目录。

[公开 Jev 实验](experiments/baselines/jev-public.md)单独列出来源与条件。不同数据集、环境和计时方法不用于直接排名，也不能据此声称 fast-jev 超过 Jev。

已通过复用校验后的请求，去掉一次重复输入校验。5 组交替 AB/BA 实验、每组每种批量大小各 1,000 个样本，得到以下各次运行 p50 的中位数：

| 每次条目数 | 优化前 | 优化后 | 配对降幅中位数 |
| ---: | ---: | ---: | ---: |
| 1 | 0.0260 ms | 0.0220 ms | 15.60% |
| 8 | 0.0829 ms | 0.0553 ms | 33.96% |
| 32 | 0.2414 ms | 0.1550 ms | 35.73% |

这仅是**无网络、无模型调用的本地封装开销**，不是 agy 响应时间，也不是与 Jev 的速度比较。优化前代码和全部 30,000 个时延样本均已保留。[A/B 原始结果](experiments/results/overhead-ab/comparison.json)。

```sh
npm run benchmark:local -- --out experiments/results/my-overhead-ab
```

## 能力边界

封装校验结构、合法选项和数值范围，无法保证判断正确或抵抗所有提示注入。精确运算交给代码，阈值用自己的带标签数据评估。输入会发送到所选后端，agy 使用其既有认证与服务路由。没有测量就不承诺具体时延、成本或校准水平。

更多背景见 [Jev 完整调研与验证方案](docs/research-jev.md)，其中区分了原始决策模型与本项目的无训练封装。

[安装与分发](docs/distribution.md) · [隐私与发布内容](docs/security.md)。
