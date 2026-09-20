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

`--dry-run` 输出包含你的输入。`doctor` 检查配置，其中 agy 模型列表可能联系其服务；它不证明推理可用。`doctor --live` 发起一次真实测试判断，可能产生后端用量。测试采用本地固定数据或模拟后端，不能证明模型准确率或生产时延。本地串行运行 169 项测试全部通过；[CI](https://github.com/Finn-Fengming/fast-jev/actions/workflows/ci.yml)覆盖 Linux/macOS × Node.js 22/24。

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

**AGY / Gemini 与 OpenRouter 原生 Jev 实测（2026-09-20）。** 模型分别为 `gemini-3.8-flash-low` 和 `typesafe/jev-1.13`；双方限时 60 秒，先每批 8 例再单例，各一轮，串行 AB/BA 交替，无应用层重试。每后端、每模式计划 **64 条案例**，预热排除；本轮状态：`completed_with_errors`。

本轮 Jev 的端到端正确率更高、成功请求时延更低。AGY 成功返回的答案全部正确，调用失败拉低了其端到端正确率。Jev 使用实验专用的原生 Decisions API 适配器；生产 CLI 的 compatible 后端仍使用 Chat Completions。

| 模式 | 后端 | 正确 / 已尝试案例 | 案例覆盖 | 失败 / 已尝试请求 | 成功请求 p50 / p95（秒） |
| --- | --- | ---: | ---: | ---: | ---: |
| 单例 | AGY / Gemini | 59/64 (92.19%) | 64/64 | 5/64 | 13.447 / 44.665 |
| 单例 | OpenRouter Jev | 64/64 (100.00%) | 64/64 | 0/64 | 0.318 / 0.458 |
| 每批 8 例 | AGY / Gemini | 48/64 (75.00%) | 64/64 | 2/8 | 12.892 / 44.182 |
| 每批 8 例 | OpenRouter Jev | 63/64 (98.44%) | 64/64 | 0/8 | 0.324 / 0.462 |

端到端正确率包含后端失败；覆盖列为实际尝试 / 64，未运行案例不伪装成预测。成功响应条件下准确率另为：单例 AGY 59/59 (100.00%)、Jev 64/64 (100.00%)；批量 AGY 48/48 (100.00%)、Jev 63/64 (98.44%)。成功请求分位数排除失败耗时；完整失败、全体请求时延和覆盖见[原始报告](experiments/results/agy-jev-openrouter-60s-test-20260920/comparison.md)。

分类/布尔精确匹配；评分以绝对误差 **≤ 0.5** 计入正确率，保留 Jev 连续值，不四舍五入。下面评分指标只针对返回的评分答案，MAE 仅使用有效数值；后端失败保留在上表分母。

| 模式 | 后端 | 评分 MAE | 评分精确匹配 | 有效评分数 |
| --- | --- | ---: | ---: | ---: |
| 单例 | AGY / Gemini | 0.0000 | 100.00% | 15 |
| 单例 | OpenRouter Jev | 0.0075 | 56.25% | 16 |
| 每批 8 例 | AGY / Gemini | 0.0000 | 100.00% | 15 |
| 每批 8 例 | OpenRouter Jev | 0.0569 | 68.75% | 16 |

批量成功请求平均摊销：**AGY 2823.74 ms/例；Jev 45.26 ms/例**，不是单条响应延迟，整批须等待完整返回。计时包含 AGY 新进程启动、或 Jev 的 Node fetch 网络调用，以及各自构造、解析与校验；不代表纯模型计算。批量最多 8 个请求样本，8 个样本的 p95 就是最大值。

**保留初轮 30 秒结果：** [初轮报告](experiments/results/agy-jev-openrouter-test-20260920/comparison.md)中双方各尝试 15/64 条单例；AGY 8/15 正确、7 次超时，Jev 15/15 正确。连续 3 次 AGY 超时触发停止，各剩余 49 条单例及全部批量未运行。60 秒与批量优先是在看到这些失败后公开修订的协议；未改题目、标签或模型提示词，未拼接两轮最佳输出。

这是已经观察过的小型合成集，参考答案由 AI 辅助按规则编写，未经独立人工标注。一轮结果不证明生产泛化或稳定速度，原生 Jev 概率不与 AGY 自报告 confidence 比较。[对比说明](experiments/COMPARISON.md) · [协议](experiments/protocols/agy-jev-openrouter-60s-20260920.md) · [结果与分析](experiments/results/agy-jev-openrouter-60s-test-20260920/analysis.md) · [JSON](experiments/results/agy-jev-openrouter-60s-test-20260920/comparison.json)。

复现需要工作正常的本机 agy，以及配置为 OpenRouter 凭据的 `OPENAI_API_KEY`。从源码仓库运行（安装包不含实验脚本）；每次使用新输出目录：

```sh
node experiments/compare.mjs --timeout 60000 --batch-sizes 8,1 \
  --out experiments/results/my-comparison
node experiments/compare-report.mjs experiments/results/my-comparison
```

第一条加 `--plan` 可不调用模型查看计划；第二条只离线核验原始答案、请求 hash、评分和配对顺序。[历史 AGY、外部 Jev 与本地封装开销实验](experiments/README.md#历史实验索引)单独保留。

## 能力边界

封装校验结构、合法选项和数值范围，无法保证判断正确或抵抗所有提示注入。精确运算交给代码，阈值用自己的带标签数据评估。输入会发送到所选后端，agy 使用其既有认证与服务路由。没有测量就不承诺具体时延、成本或校准水平。

更多背景见 [Jev 完整调研与验证方案](docs/research-jev.md)，其中区分了原始决策模型与本项目的无训练封装。

[安装与分发](docs/distribution.md) · [隐私与发布内容](docs/security.md)。
