# fast-jev 实验与复现

当前主实验是 **fast-jev AGY（`gemini-3.8-flash-low`）与 OpenRouter 原生 Jev（`typesafe/jev-1.13`）的同案例对比**。当前入口采用双方 60 秒限制、先批量后单例的后续实验：从[对比说明](COMPARISON.md)、[独立重算报告](results/agy-jev-openrouter-60s-test-20260920/comparison.md)、[机器可读报告](results/agy-jev-openrouter-60s-test-20260920/comparison.json)和[原始证据](results/agy-jev-openrouter-60s-test-20260920/)查看状态、效果、速度与完整分母。两条路径都发起新的真实调用。

### 60 秒后续实测结果

状态为 `completed_with_errors`：**148/148 次计划调用全部尝试**（144 次正式请求、4 次预热），四组均覆盖 64/64 条案例，`not_run` 均为 0。端到端正确率计入后端失败；以下时延只使用成功请求。

| 模式 | 后端 | 正确 / 已尝试案例 | 失败 / 已尝试请求 | 成功请求 p50 / p95（秒） |
| --- | --- | ---: | ---: | ---: |
| 单例 | AGY | 59/64 (92.19%) | 5/64 | 13.447 / 44.665 |
| 单例 | Jev | 64/64 (100.00%) | 0/64 | 0.318 / 0.458 |
| 每批8例 | AGY | 48/64 (75.00%) | 2/8 | 12.892 / 44.182 |
| 每批8例 | Jev | 63/64 (98.44%) | 0/8 | 0.324 / 0.462 |

AGY 单例失败为 2 次 `AGY_TIMEOUT`、3 次 `AGY_FAILED`；批量 2 次超时使对应 16 条案例失败。成功输出条件下，AGY 单例为 59/59、批量为 48/48 正确；Jev 单例 64/64、批量 63/64，批量唯一不正确案例是评分题。AGY 包含失败的全体请求 p50/p95 为单例 **13.771/54.155 秒**、批量 **13.303/60.264 秒**；Jev 无请求失败，全体请求分位数与表中相同。

评分采用绝对误差 ≤ 0.5；AGY 两种模式的有效评分各 15 条，均精确命中、MAE 为 0。Jev 单例评分 MAE **0.007500**、精确命中 **9/16**；批量 MAE **0.056875**、精确命中 **11/16**。批量成功请求平均摊销为 AGY **2,823.741 ms/例**、Jev **45.265 ms/例**，这是整批耗时分摊，不是单条响应延迟。

独立报告记录了 **2 个 UTC 与单调计时差异提示**；采用单调时钟的耗时一致性与串行无重叠校验通过。被测 22 个源码文件的 hash 未变，运行时 HEAD 为 `60066f4`。本轮只描述该合成工作负载的两条完整调用路径，不构成普遍胜出或生产表现保证；详见[结果分析](results/agy-jev-openrouter-60s-test-20260920/analysis.md)。

**初轮 30 秒实验一并保留：** [报告](results/agy-jev-openrouter-test-20260920/comparison.md)记录两后端均尝试 15/64 条单例案例；AGY 8/15 正确、7 次超时，Jev 15/15 正确。AGY 连续 3 次正式超时触发预先约定的停止条件，双方剩余 49 条单例及全部批量案例均为 `not_run`。60 秒实验是看到这些失败之后公开修订协议的新一轮，不能补写初轮空缺、挑选两轮较优预测或掩盖初轮失败。

## 当前 AGY / Jev 配对实验

[后续实验协议](protocols/agy-jev-openrouter-60s-20260920.md)在新一轮调用前固定：双方调用限制改为 **60 秒**（与产品默认一致），模式顺序改为 **每批 8 例，再单例**，其余实现与评估规则保持不变。仍使用原有全部 64 条测试案例，每个后端、每种模式各运行 1 轮；同一种子、顺序和批次，相邻请求对交替采用 AGY→Jev 和 Jev→AGY，整个实验并发为 1。应用层无重试，每个后端、每种模式各排除 1 次开发集预热。完整预算为 144 次正式调用加 4 次预热；本轮全部执行，逐条覆盖与失败见上述结果和原始记录。

两轮之间的[开发集诊断](results/agy-jev-timeout-dev-20260920/README.md)使用 60 秒限制和仅观察、转发原始流的代理，3 条开发案例全部成功，耗时 11.37–14.58 秒，成功事件到进程退出约 1 秒。这不足以确定初轮超时的根因；没有据此修改生产代码。正式实验不带该观察代理。

AGY 每次启动新的本机进程；Jev 通过官方 `https://openrouter.ai/api/alpha/decisions` 调用。该接口返回原生决策，不是 Chat Completions。Jev 的布尔概率以预先固定的 `>= 0.5` 阈值转换；评分保留连续数值，不四舍五入。两者使用相同的事实、完整题目、候选项和已有评分规则，不发送参考答案或解释。原生概率与 AGY 自报告 confidence 不作校准或数值比较。

两轮使用同一份冻结实现 [`d09f240`](https://github.com/Finn-Fengming/fast-jev/commit/d09f2408e79b32b4bec99db62af10268911c1195)，源码 hash 均为 `9f6c59b2ece1d41e07859d9b8973c02ace983af790cbd5bff00d8d49bab82b75`。后续实验启动时 HEAD 为 [`60066f4`](https://github.com/Finn-Fengming/fast-jev/commit/60066f40dfe74cc18eac7ab88527ce7a165b38f6)，增加的是前一轮证据和修订协议，未改变被测实现。各 manifest 保留真实运行时提交号及文件 hash。[开发接口检查](results/agy-jev-openrouter-dev-20260920/comparison.md)使用正式提交前的工作树快照，源码 hash 与正式实验不同；开发结果不纳入正式表，详见[来源说明](PROVENANCE.md)。原有测试案例及其先前成绩已被观察，本轮是对冻结案例的重新测量，不是新增盲测，也不能代表生产总体表现。

### 复现当前对比

需要 Node.js 22+、能够实际完成请求的本机 `agy`，以及已配置为 OpenRouter 凭据的 `OPENAI_API_KEY`。无需把密钥写入命令或配置文件。以下命令在对应源码版本的仓库根目录运行；每次 `--out` 必须使用新目录。

```bash
# 无需密钥、不调用模型的完整计划
node experiments/compare.mjs --timeout 60000 --batch-sizes 8,1 --plan \
  --out experiments/results/my-comparison-plan

# 可选：单独记录开发接口检查，不能用来替代正式结果
node experiments/compare.mjs --timeout 60000 --split dev --limit 8 --batch-sizes 8 \
  --out experiments/results/my-comparison-dev

# 复现双方60秒、先批量后单例的后续协议
node experiments/compare.mjs --timeout 60000 --batch-sizes 8,1 \
  --out experiments/results/my-comparison-test

# 不访问模型，核验原始证据并重新计算对比
node experiments/compare-report.mjs experiments/results/my-comparison-test
```

`compare.mjs` 直接使用固定模型和显式调用选项，不读取本机 fast-jev 配置来改变模型或 effort。任意预热失败即停止；任一后端连续 3 次正式失败也停止，保留已经尝试的结果并将剩余案例标为 `not_run`。不得静默重跑后只挑较好的一轮。

结果包含 `b1/agy`、`b1/jev`、`b8/agy`、`b8/jev` 四个标准实验子目录，以及完整计划、串行执行日志、预热快照和独立对比报告。`compare-report.mjs` 会重算各子报告，并验证两后端的案例、批次、源码快照、交替执行顺序、无重叠计时、原生 wire 请求 hash 和 Jev 答案转换。密钥、任意后端错误正文及账号请求标识不写入证据。

端到端正确率包含后端失败，成功条件下准确率另列，并报告 `not_run` 覆盖。评分同时展示 ≤ 0.5 容差正确率、MAE 和精确匹配。请求 p50/p95 每次调用只计一个样本；单例只能对比单例、批量只能对比相同批大小。批量均值除以案例数是摊销成本，不能当作单条响应延迟。计时包含各自调用链的进程或网络开销，不是纯模型计算时间。本轮批量各尝试 8 个请求，成功时延样本为 AGY 6 个、Jev 8 个；各自 nearest-rank p95 都是其成功样本中的最大值。

## 历史实验索引

下列 AGY、公开 Jev 资料和离线开销结果保留其原始测量含义与记录，不作为本轮配对实验的替代数据。早期 AGY 测试采用[独立冻结协议](protocols/agy-recovery-20260920.md)：单例 64 例 × 1 轮、每批 8 例模式 64 例 × 3 轮。离线固定输出只用于测量本地代码开销，外部 Jev 数字只作未匹配的历史参考。

| 实验 | 证据目录 | 测量对象 |
|---|---|---|
| agy 连通检查 | [agy-recovered-preflight-20260920](results/agy-recovered-preflight-20260920/report.json) | 真实成功；决策 20,956 ms，后端报告 7,293 ms，计时边界不同 |
| 正式单例测试 | [agy-recovered-test-single](results/agy-recovered-test-single/report.md) | 64 例 × 1 轮；62 正确、2 次超时，完整覆盖 |
| 正式批量测试 | [agy-recovered-test-batch-8](results/agy-recovered-test-batch-8/report.md) | 64 例 × 3 轮；24/24 请求成功，192/192 案例执行正确 |
| 开发集单例 | [agy-recovered-dev-single](results/agy-recovered-dev-single/report.md) | 8/8 正确，8 次请求 p50 12,570.03 ms |
| 开发集批量 | [agy-recovered-dev-batch-8](results/agy-recovered-dev-batch-8/report.md) | 8/8 正确，1 次请求 12,790.11 ms |
| 未采用的候选方案 | [agy-lean-dev-single](results/agy-lean-dev-single/report.md)、[审计](results/agy-lean-dev-audit/report.json) | 8/8 正确，但均值和 p95 未改善；保留负结果 |
| agy 单例计划 | [agy-single](results/agy-single/report.md) | 每请求 1 个案例的冻结计划，**未执行**，状态 `planned` |
| agy 批量计划 | [agy-batch-8](results/agy-batch-8/report.md) | 每请求 8 个案例的冻结计划，**未执行**，状态 `planned` |
| 封装优化 A/B | [overhead-ab](results/overhead-ab/) | 无网络、无模型推理的本地开销 |
| 初次开销探索 | [before](results/local-overhead-before/)、[after](results/local-overhead-after/) | 先行探索样本；正式比较使用上面的配对实验 |
| 外部 Jev 结果 | [研究说明](baselines/jev-public.md)、[JSON](baselines/jev-public.json) | 外部作者公开的历史结果；与本轮原生 Jev 实测分开 |

## 历史 AGY 正式测试结果

两种正式测试均遵循预先冻结协议，使用全部 64 条测试案例，覆盖率 100%。正确率以首轮案例为单位，请求计数及请求时延使用各模式全部正式轮次：

| 模式 | 首轮正确 / 已尝试案例 | 成功 / 已尝试请求 | 成功请求 p50 / p95（ms） | 全部请求 p50 / p95（ms） |
|---|---:|---:|---:|---:|
| [单例 1 轮](results/agy-recovered-test-single/report.md) | 62/64（96.88%） | 62/64 | 11,918.71 / 23,732.13 | 11,939.07 / 29,590.07 |
| [每批 8 例，3 轮](results/agy-recovered-test-batch-8/report.md) | 64/64（100%） | 24/24 | 12,815.80 / 21,160.12 | 12,815.80 / 21,160.12 |

单例的两次失败都是 30 秒限制触发的 `AGY_TIMEOUT`，保留在端到端正确率分母；62 条成功输出全部正确。16 条评分案例均完全命中，MAE 为 0；此处不依赖 ≤ 0.5 的评分容差来取得正确。单例只有一轮，跨轮一致性不可用。成功请求分位数排除失败，全部请求分位数包含失败耗时；它们都包括进程启动与封装开销，不是纯模型推理时间。合成集的成绩不能证明生产流量泛化，也不能与外部 Jev 成绩直接排名。

批量模式首轮 64/64 正确，三轮共 192/192 次案例执行正确，64/64 条案例的预测跨轮完全一致；首轮 16 条评分题全部精确命中，MAE 为 0。重复三次不增加独立测试案例数。成功请求均值为 13,539.35 ms，除以每批 8 例后为 **1,692.42 ms/例**。这是摊销耗时，单条输入仍须等待整个批次完成；不能把它称为单次响应时延或与 Jev 单次 API p50 对比。

两组均为顺序运行，请求时延样本分别为单例 64 个（成功 62 个）与批量 24 个。观察到的批量摊销成本较低，但不能据此保证其他工作负载的提速，也不能将两次单例超时直接归因于批量与否。首轮端到端正确率的 Wilson 95% 区间为单例 89.30%–99.14%、批量 94.34%–100%；共享模板的合成案例仍限制统计独立性与代表性。

[错误分类勘误](ERRATA.md)：原始单例记录将两个 `AGY_TIMEOUT` 的辅助类别误写成 `authentication`，原因是超时提示中含有 `login`，旧分类规则先匹配了该词。错误码、原始耗时、失败数量和得分均正确。两组冻结实验完成后才修复分类器，并添加 10 项回归测试；当时 113/113 测试及语法检查通过。评分输入、预测和耗时未改写。后续发布版的诊断隐私调整及探测元数据精简见[来源说明](PROVENANCE.md)。

## 固定数据与评估边界

`agy-single` 和 `agy-batch-8` 由 `--plan` 生成，全部正式案例是 `not_run`；它们一直是未执行计划，不是已经完成的 benchmark，也不是由真实请求生成的失败预测。这些历史计划对应的实际请求另存于 `agy-recovered-*` 目录；当前配对调用另存于 `agy-jev-openrouter-*` 目录，均不覆盖计划记录。

[数据集说明](data/README.md)与 [decision-suite.jsonl](data/decision-suite.jsonl)包含 96 条原创合成案例：开发集 32 条、测试集 64 条，中英文各半，覆盖分类路由、布尔判断、0–2 评分和规则决策。参考答案依据题目内的明确规则预先固定，由 AI 辅助编写，**尚未独立人工标注或复核**；被测 Gemini 未参与生成或修改参考答案。

开发集用于调参，测试前冻结设置。两集合共享任务类别和部分规则模板，因此不等同于外部独立测试集。测试后继续调整必须披露；不得修改参考答案掩盖错误。只发送 `request` 中的事实和问题，`expected`、`rationale`、split 等评估元数据不进入模型输入。数据 hash 为：

```text
f0bfdd47121bf16ee1600583ea06aa58a69aeecd8e5d679560dc1447ba696e2c
```

## 历史 AGY 开发检查与配置选择

[真实连通检查](results/agy-recovered-preflight-20260920/report.json)在 agy 1.2.7、`gemini-3.8-flash-low` 下完成。20,956 ms 是一次决策计时，7,293 ms 是后端报告时长；不将二者混作 CLI 时延，也不从一次检查推断准确率。

生产适配器与精简 agent 候选使用相同的 8 条开发案例，各正确 8/8。生产版的请求 p50 / 均值 / p95 为 **12,570.03 / 13,069.34 / 20,561.11 ms**；候选为 **11,955.33 / 13,396.23 / 25,575.76 ms**。这只是小规模顺序实验，不能证明统计显著差异；候选虽有较低 p50，均值和尾部时延未改善，因此**当时不采用候选，生产源码保持原样**。批量开发检查把同 8 个案例合入 1 次请求，全部答对，耗时 12,790.11 ms；每例 1,598.76 ms 是摊销耗时，不是每例响应延迟。

候选的独立审计观察到 agent 名称 `fast-jev`、57 个声明工具、0 个工具事件、`num_turns: 2` 和 26,492 输入 token。它不证明工具不可用，也不解释 token 与轮次计数的成因。[候选原始结果](results/agy-lean-dev-single/)和[审计记录](results/agy-lean-dev-audit/report.json)一起保留，不只报告最有利的数值。

## 复现历史 AGY 单后端实验

要求 Node.js 22+，且本机 `agy` 已安装、登录并能实际完成请求。模型列表可见不代表推理服务可用。项目默认模型为 `gemini-3.8-flash-low`；下面显式指定，避免本地配置改变实验模型。命令均从仓库根目录运行。

先冻结计划；`--plan` 只写计划和快照，不调用模型：

```bash
node experiments/run.mjs --provider agy --model gemini-3.8-flash-low --split test --repeats 3 --batch-size 1 --plan --out experiments/results/my-plan
```

用开发集检查设置；本次评测只用其中选定的 8 例做配置选择：

```bash
env -u FAST_JEV_EFFORT node experiments/run.mjs \
  --config examples/config.json --provider agy --model gemini-3.8-flash-low \
  --agy-bin agy --timeout 30000 --split dev --limit 8 --repeats 1 \
  --batch-size 1 --seed 20260920 --out experiments/results/my-dev
```

`--out` 必须是**新目录**，已有目录会报错；计划和正式运行也应使用不同目录。省略 `--out` 会生成带时间戳的目录。完整选项见 `node experiments/run.mjs --help`。可用 `--timeout 60000` 延长默认 30 秒超时，用 `--agy-bin` 指定程序；改变参数须保留到新的实验目录。

测试前冻结的[评测协议](protocols/agy-recovery-20260920.md)将单例缩为 1 轮、批量保留 3 轮；这是依据开发阶段约 13 秒的单例耗时作出的预先调整，没有减少 64 条测试案例。复现正式设置时运行：

```bash
env -u FAST_JEV_EFFORT node experiments/run.mjs \
  --config examples/config.json --provider agy \
  --model gemini-3.8-flash-low --agy-bin agy --timeout 30000 \
  --split test --repeats 1 --batch-size 1 --warmup 1 \
  --seed 20260920 --max-errors 3 --out experiments/results/my-agy-single

env -u FAST_JEV_EFFORT node experiments/run.mjs \
  --config examples/config.json --provider agy \
  --model gemini-3.8-flash-low --agy-bin agy --timeout 30000 \
  --split test --repeats 3 --batch-size 8 --warmup 1 \
  --seed 20260920 --max-errors 3 --out experiments/results/my-agy-batch-8
```

协议边界如下：

- seed 为 `20260920`，每轮按固定种子打乱顺序；并发为 1，fast-jev 无自动重试。每次请求启动新的 agy 进程；上游缓存行为未知。
- 先执行 1 次开发案例预热请求，排除在正式指标之外。预热失败即停止；正式请求连续失败 3 次也停止。未运行案例写为 `not_run`，不能当作已产生错误预测。
- 历史未执行计划两种模式均为 64 例 × 3 轮。正式协议为单例 64 例 × 1 轮、64 次正式请求；批量 64 例 × 3 轮、24 次正式请求，两种模式各加一次预热。重复调用不增加独立题目数；单例只有一轮，不报告跨轮一致性，两种模式的时延样本数不同。
- 8 例模式把各案例事实放入 `state.inputs`，问题明确只读取对应输入。它改变输入长度和请求结构，需要单独报告正确率；不能预设批量与单例等效。

若预热失败、正式预测为零，准确率及成功请求时延显示 `null` / `N/A`，不是 0% 或极速推理。失败耗时不纳入成功推理速度。

## 指标与分母

主质量指标只用第一轮正式输出（`repeat: 0`），避免把三轮重复当成三倍独立样本。分类和布尔使用严格类型与精确匹配；评分保留连续值，分别报告 MAE、归一化 MAE、完全相等率，以及绝对误差 **≤ 0.5（含边界）** 的容差正确率。容差正确不等于精确命中。

端到端正确率以已尝试案例为分母，后端错误计为失败；成功响应条件下准确率另列，并同时报告有效率、覆盖率和 `not_run`。评分 MAE 仅对有效数值计算，不能用它隐藏无效输出。Wilson 95% 区间仅基于第一轮案例，不足以证明对生产流量的泛化；模板共享也限制独立性。跨轮一致性只使用所有计划轮次均成功且有效的案例，并要求预测严格相等。

AGY 计时围绕 `decide()`，包含构造提示词/schema、agy 进程启动、服务调用、输出解析与严格校验；原生 Jev 计时围绕其请求构造、HTTP 调用、解析与校验；不含外层 Node 启动、版本探测、预热和实验落盘。**p50/p95 以请求为单位，每个请求只计一次**，采用 nearest-rank。批次总时间除以案例数是摊销时间，不是每个案例的响应延迟；不要将它与 Jev 单次 API p50 比较。吞吐率分母是正式请求耗时之和（含失败请求），不包含请求间落盘等时间，因此不等于整次运行的墙钟吞吐量。

模型返回的 confidence 是自报告支持度，不参与评分，也没有校准保证。Jev 的原生概率、原生 confidence 与 fast-jev confidence 不是同一个指标，不能直接比较数值或迁移阈值。

## 原始证据与离线重算

每个真实实验目录保存：

| 文件 | 内容 |
|---|---|
| `manifest.json` | 配置、计划顺序、环境、数据 SHA-256、案例快照 SHA-256、源码文件 hash、Git commit（可取得时）、状态 |
| `cases.jsonl` | 本次选中的完整案例快照与参考答案，用于离线审核 |
| `requests.jsonl` | 每个实际请求的阶段、案例 ID、请求 hash、耗时、解析后结果或脱敏错误；包含预热 |
| `records.jsonl` | 每案例/每轮的结果、失败或 `not_run`，包含原始预测值和运行时评分 |
| `summary.json` | 运行时初步汇总，保留不改 |
| `probe.json` | agy 版本及模型探测结果（探测成功时） |

请求日志保存的是适配器解析后的真实结果，不是完整厂商响应正文或 agy stdout。请求可由案例快照和批量规则重建，hash 用于一致性检查。

不访问模型即可重算：

```bash
node experiments/report.mjs experiments/results/my-agy-single
node experiments/report.mjs experiments/results/my-agy-batch-8
```

命令生成目录内的 `report.json` 与 `report.md`，不修改 `summary.json`。它**忽略已有 `record.score`**，用冻结参考答案和实际结果重新评分；校验快照 hash、案例/轮次覆盖、计划批次、请求重建 hash、请求与案例结果/耗时一致性。若原数据 hash 与随仓库数据一致，还核对案例与标签内容；自定义数据则以冻结快照为准。报告另记录重算代码 hash。

这些检查用于发现不一致或误修改；与结果一起保存的 hash 不是来源真实性的密码学证明。保留完整目录和对应源码版本，不能只复制汇总表。

## 历史本地封装优化的复现

产品优化复用了已经校验并分离复制的请求，减少 `decide()` 内部的重复输入验证。公共 `validateOutput()` 仍完整校验调用方输入，输出验证规则保持严格。优化前版本保留在 [decision-before-validation-reuse.mjs](variants/decision-before-validation-reuse.mjs)。

`local-overhead.mjs` 替换进程内 `fetch`，返回预先固定的正确输出，**零网络调用、零模型推理**。它只测 `decide()` 中提示词/schema 构造、序列化、固定响应解析和校验开销，包含 JIT、GC 与主机负载噪声；不能拿固定正确输出计算模型准确率。

正式 A/B 采用 5 对独立进程，交替 AB/BA 顺序；每个变体在批大小 1、8、32 下分别预热 100 次、测量 1000 次：

```bash
node experiments/compare-overhead.mjs --pairs 5 --iterations 1000 --out experiments/results/my-overhead-ab
```

`comparison.json` 保留各对结果、单次运行 p50 的中位数与范围，以及配对降幅；每个子目录保存 `samples.jsonl` 和 `summary.json`。它不是 p 值或置信区间，也不能据此推导 Gemini 推理提速。需要单独复现某个变体时：

```bash
node experiments/local-overhead.mjs --variant before-validation-reuse --iterations 1000 --warmup 100 --out experiments/results/my-overhead-before
node experiments/local-overhead.mjs --variant current --iterations 1000 --warmup 100 --out experiments/results/my-overhead-current
```

已有 [正式 A/B 结果](results/overhead-ab/comparison.json)与初次探索样本均保留，不把最有利的一次测试选作结论。

本机已完成 5 对 A/B、共 30,000 个正式计时样本（不含预热）。以下为各独立运行 p50 的中位数，不是混合所有样本后的 p50；降幅为逐对计算后取中位数：

| 批大小 | 优化前 p50 中位数（ms） | 优化后 p50 中位数（ms） | 配对降幅中位数 |
|---|---:|---:|---:|
| 1 | 0.02604 | 0.02196 | 15.60% |
| 8 | 0.08287 | 0.05529 | 33.96% |
| 32 | 0.24138 | 0.15504 | 35.73% |

这些是固定响应下的本地封装开销，不能解释为 agy 或 Gemini 推理延迟下降。环境、各次范围和全部样本见 [A/B 证据](results/overhead-ab/)。


## Jev 外部参考的使用

[公开资料研究](baselines/jev-public.md)和[机器可读数据](baselines/jev-public.json)记录第三方及官方结果、固定来源版本和具体计时方法。这些历史资料来自外部作者；本轮原生 Jev 的实际调用和同案例对比另存于[初轮30秒目录](results/agy-jev-openrouter-test-20260920/)及[后续60秒目录](results/agy-jev-openrouter-60s-test-20260920/)。不同数据集、标签、运行环境、并发、重试和计时边界的结果必须分开；不能拼接某研究最高准确率与另一研究最低时延，也不能据此宣称 fast-jev 胜出。

## Reproduction in English

The current entry point compares fresh calls to fast-jev AGY (`gemini-3.8-flash-low`) and native OpenRouter Jev (`typesafe/jev-1.13`) under the [60-second follow-up protocol](protocols/agy-jev-openrouter-60s-20260920.md). See the [comparison guide](COMPARISON.md) and [follow-up report](results/agy-jev-openrouter-60s-test-20260920/comparison.md) for actual status and coverage.

The follow-up finished as `completed_with_errors`: all 148 planned calls were attempted, and all four backend/mode groups cover 64/64 cases. Singleton correctness was AGY 59/64 with five failed requests versus Jev 64/64; batch correctness was AGY 48/64 with two failed requests versus Jev 63/64 with one score error. Successful-request p50/p95 were AGY 13.447/44.665 s and Jev 0.318/0.458 s for singleton; AGY 12.892/44.182 s and Jev 0.324/0.462 s for batches. See the table above for failure denominators and [analysis](results/agy-jev-openrouter-60s-test-20260920/analysis.md) for interpretation. Two UTC/monotonic clock warnings are retained; elapsed-time and serial-order checks using the monotonic clock passed.

The [initial 30-second attempt](results/agy-jev-openrouter-test-20260920/comparison.md) remains visible beside it: both backends attempted 15/64 singleton cases; AGY scored 8/15 with seven timeouts, and Jev scored 15/15. Three consecutive AGY failures stopped the run. The remaining 49 singleton cases and all batch cases were unrun. The later protocol revision follows these observed failures and is not a hidden retry or a new blind holdout. Never merge each case's best output across runs.

Use Node.js 22+, working local agy authentication, and `OPENAI_API_KEY` configured for OpenRouter. From the recorded source version, run `node experiments/compare.mjs --timeout 60000 --batch-sizes 8,1 --out experiments/results/my-comparison-test`. Add `--plan` for a no-credential, no-inference plan. Every output directory must be new. Recompute without model calls using `node experiments/compare-report.mjs DIRECTORY`.

The follow-up explicitly sets a 60 s deadline for both backends and runs batch-of-eight before singleton; the runner's unchanged default remains 30 s and modes 1,8. All other rules are fixed: one pass through the same 64 cases per backend/mode, serial alternating backend order, no application retries, and one excluded development warmup per backend/mode. The budget remains 148 calls including warmups. A failed warmup or three consecutive measured failures on either backend stops the entire comparison. Report all failures and unrun cases.

A separate three-case [development diagnostic](results/agy-jev-timeout-dev-20260920/README.md) succeeded with a 60 s limit and a stream observer, but did not identify the cause of the initial timeouts. No production adapter fix was made, and the observer is excluded from formal measurements. Jev uses the native Decisions API, fixed `noul >= 0.5` conversion and unrounded continuous scores. Report MAE, exact match and ≤ 0.5 tolerance separately. Compare request latency within the same mode; batch amortization is not individual response latency. Timings include integration overhead rather than isolated model compute.

Both formal attempts retain source hash `9f6c59b2ece1d41e07859d9b8973c02ace983af790cbd5bff00d8d49bab82b75`, matching implementation commit `d09f240`. The follow-up's runtime HEAD is `60066f4`; its additional evidence/protocol commit does not change the measured implementation. Earlier development artifacts retain their own uncommitted working-tree hashes. See [provenance](PROVENANCE.md). These previously observed synthetic cases are not an independently annotated production benchmark.
