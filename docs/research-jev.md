# Jev 完整调研与 fast-jev 实现建议

调研日期：**2026-09-20**。资料以当日可访问的一手产品文档、维护者源码仓库及评测作者原始报告为准。

本项目按最新需求命名为 **fast-jev**：首版支持本机 **agy** 和 **OpenAI-compatible API** 两种后端；复用现有模型，不训练模型。下文的接口设计与验收方案是本项目建议，不代表 Jev 官方功能，也不代表已经完成性能实测。

## 1. 结论与证据边界

Jev 最值得复用的设计是：**把判断限制为已知答案空间，把复杂业务拆成原子判断，再让普通代码组合结果**。它很适合分类、分流、相关性判断和按规则评分。对于 fast-jev，推荐做一个薄、可验证、适合管道组合的决策 CLI，让已经可用的 agy 或兼容 API 负责模型调用。

需要清楚区分三件事：

| 对象 | 是什么 | 本项目与它的关系 |
| --- | --- | --- |
| TypeSafe AI / System One API | 托管决策服务和接口 | 研究其产品模式；不要求用户接入 TypeSafe |
| Jev | TypeSafe 的 System One 模型 | 借鉴答案类型，不能宣称复制了其训练或推理架构 |
| `jevon` / `jev` 及其他同名 CLI | 调用 TypeSafe 的社区工具 | 借鉴命令体验；fast-jev 使用自己的 provider 与输出契约 |

模型与服务的定位来自 [TypeSafe Introduction](https://docs.typesafe.ai/introduction)；`jevon` 仓库明确其 `jev` 二进制是 TypeSafe API 的 CLI / MCP 客户端，仓库所有者为 `douglance`，不应误写为 TypeSafe 模型本身或官方唯一 CLI。[jevon 仓库](https://github.com/douglance/jevon)

本报告采用以下证据标记：

- **接口事实**：官方文档明确给出的请求、字段、限制。
- **厂商报告**：训练方法、时延、成本收益和评估结果，保留其测量条件。
- **独立报告**：评测作者自己的数据与结论；本次没有重新调用 Jev 复测。
- **本项目判断**：从上述材料推导出的工程建议，后续仍需测试。

此次工作是资料调研，**没有 Jev 与 Gemini 的同环境对照实测**，也没有从本报告推出 Gemini 的吞吐量、准确率或概率校准水平。

## 2. Jev 是什么，为什么值得关注

Jev 于 **2026-09-15** 发布 early access，发布者是 TypeSafe 创始人 Diogo Almeida。官方将其称为 System One 模型：输入状态，输出受限的决策结果，放弃自由文本生成。发布文章提到新的模型架构、并行采样器，以及 RLCD（Reinforcement Learning for Calibrated Decisions）。这些是厂商对内部技术的公开描述。[官方发布文章](https://typesafe.ai/blog/introducing-system-one-models-and-jev)

官方强调的工作流不是“模型完成一切”，而是将判断嵌入可检查的程序：独立问题交给模型，规则、计算和动作交给代码。System One 的名称借用《思考，快与慢》的概念，不表示它与某一传统统计模型、JEPA 或任意“小模型”技术等价。[System One 概念](https://docs.typesafe.ai/concepts/system-one)

**本项目判断：**近期关注度与三个产品特征有关：接口接近函数返回值；大量 agent 步骤本来就是封闭判断；低调用成本让持续检查比最终一次复审更容易实现。这是对其传播原因的解释，不是市场调查。社区已出现数据库扩展、agent 工具和独立评估，但本报告不使用 star 数、目录条目数或社交热度推断生产成熟度。

## 3. 三种决策原语

| 原语 | 问题形态 | 输入约束 | 主要结果 | 正确理解 |
| --- | --- | --- | --- | --- |
| Choice | “属于哪一种？” | 命名候选集合 | `choice`、`probabilities`、`confidence` | 在候选中选择概率最大的一个 |
| Score | “处于哪个程度？” | 从低到高的有序描述 | `score`、`probabilities`、`confidence`、`legend` | 等级索引的概率加权均值 |
| Noul | “这个命题是否成立？” | 是非命题，可补 true/false 描述 | `noul` | “是”的概率；不是程度分数 |

### 3.1 Choice：封闭集合选择

Choice 的候选是 `criteria` 映射，最多 255 个选项；返回完整分布，概率和为 1。`choice` 是最大概率选项。候选名称和描述参与判断，问题 ID 只负责映射。列表可能不完整时，应加入 `other` 或“信息不足”等合法结果。[Choice 文档](https://docs.typesafe.ai/primitives/choice)

**本项目建议：**候选应尽量互斥。若一个输入可同时属于多个类别，使用多条独立 Noul，或明确选择“主要类别”的业务规则；不能把多标签问题强行解释成单标签分类。

### 3.2 Score：有语义的有序等级

Score 使用 2–10 个从低到高排列的等级描述，等级索引从 0 开始。若有三个等级，结果范围为 0–2；例如分布 `[0.1, 0.6, 0.3]` 的分数为 `0×0.1 + 1×0.6 + 2×0.3 = 1.2`。这是本报告构造的算例，不是模型实测。官方要求用具体场景描述等级，避免只有数字或把多个维度塞进一条评分。[Score 文档](https://docs.typesafe.ai/primitives/score)

**本项目建议：**比较方案时分别评价“影响范围”“是否有替代方案”“实施成本”，在代码里按明确权重组合；不要要求模型输出一个无法解释的“综合 87 分”。

### 3.3 Noul：命题概率

Noul 返回 `[0,1]` 中的数：靠近 1 表示倾向“是”，靠近 0 表示倾向“否”，中间值表示不确定。原生 Noul **没有独立 `confidence` 字段**。例如“是否存在阻断问题”的概率与“问题有多严重”的程度不是同一个概念。[Noul 文档](https://docs.typesafe.ai/primitives/noul)

**本项目建议：**命名应正向、明确，一条问题只测一个条件。例如分别问“是否涉及支付”和“是否要求退款”，再由代码组合；阈值应按误判成本决定。

## 4. API 契约与模型边界

### 4.1 请求与响应

TypeSafe 原生端点是 `POST https://api.typesafe.ai/v1/systemone`，使用 Bearer API key。顶层由 `model`、`state`、`questions` 构成；`state` 接受字符串、对象或数组，`questions` 用调用方定义的 ID 映射问题。结果含同 ID 的 `answers`、实际模型版本和 token 用量。[HTTP API reference](https://docs.typesafe.ai/api)

下面是根据契约自行构造的请求示意，未实际发送：

```json
{
  "model": "jev-latest",
  "state": {
    "ticket": "昨天付款后扣了两次钱，麻烦查一下。",
    "receipt_count": 2
  },
  "questions": {
    "route": {
      "type": "choice",
      "instructions": "应由哪个团队首先处理？",
      "criteria": {
        "payments": "支付失败、重复扣款或账单问题",
        "product": "产品功能异常",
        "other": "以上均不适用或信息不足"
      }
    },
    "duplicate_charge": {
      "type": "noul",
      "instructions": "用户是否明确报告重复扣款？"
    }
  }
}
```

这是封闭问题评估接口，不是聊天补全接口。官方列出的常见错误包括认证失败 `401`、输入校验失败 `422`、限流 `429` 和过载 `529`；建议对限流和过载采用退避。[HTTP API 错误与重试](https://docs.typesafe.ai/api#errors)

### 4.2 当前版本与限额快照

截至调研日期，官方 Models 页给出的信息为：

| 项目 | 官方文档值 |
| --- | --- |
| 版本 | `jev-1.13.0` |
| 别名 | `jev-latest`、`jev-preview` 当时均指向该版本 |
| 输入模态 | 文本；不接受原生图像、音频、视频 |
| 上下文 | 整个请求 64k tokens；`state` 加最长单个问题不超过 32k |
| 限流 | 250,000 tokens/s、1,200 requests/min；官方注明会动态调整 |
| 输入价格 | 每百万输入 tokens $0.042；输出免费 |
| 语言 | 英语是主要训练语言，其他语言需在自身数据上验证 |

别名会随发布移动；固定模型 ID 更利于重复评估。官方也说明客户无需微调或 LoRA，主要通过状态、问题和判据适配业务。[Models](https://docs.typesafe.ai/models)

上述限制只属于当日 Jev 服务；**不能搬到 Gemini 或其他 compatible provider 上当作其能力声明**。

## 5. 工作原理：公开信息能说明什么

官方的高层解释是：面向结构化决策训练，按状态同时评估多个受限问题，避免逐 token 写出任意文本。对于共享状态的一组问题，官方将其描述为并行、相互隔离的评估；额外问题增加输入 tokens，但通常只轻微增加响应时间。[Introduction](https://docs.typesafe.ai/introduction)

RLCD 的公开目标是概率与实际结果相符。比如在大量预测中，被赋予 0.8 概率的事件应约有 80% 成立；这是群体统计含义，不是单次必然正确。官方说明了训练方向，但本次核查的资料没有给出可供独立复现的完整训练协议、奖励实现、权重或参数规模。[AI primer](https://docs.typesafe.ai/introduction/machine-learning-primer)

**不能据此推断**它必然采用某个具体 backbone、分类头、logit 提取公式、量化方案或公开论文中的结构；社区“复刻”也不证明原模型用了同一技术。fast-jev 的目标是复用产品接口模式，而非在没有权重和训练细节时重建 Jev。

这里最关键的工程差别是：将多个问题写进一次 Gemini prompt，只是**单次调用包含多项输出**。除非后端明确提供这种保证，不能称这些输出在模型内部并行、独立或互不干扰。输出越长，生成式模型通常仍需付出更多生成工作；具体增幅必须实测。

## 6. 概率、confidence 与“零幻觉”

### 6.1 三个概念不能混用

| 概念 | 含义 | 不能代表什么 |
| --- | --- | --- |
| `probabilities` | 对候选结果分配的概率 | 未评测时不能证明数字具有频率意义 |
| `confidence` | 对分布集中程度的摘要 | 不是自动等于最大概率，也不是单次正确率保证 |
| Calibration | 多次预测中概率与真实频率的匹配程度 | 不是 JSON 合法、数值和为 1 或回答语气坚定 |

TypeSafe 的 confidence 文档说明它从分布计算，分布集中时较高、分散时较低；该页**没有公布具体计算公式**。因此不能把最大概率、熵或 top-2 差距之一冠以“官方同款 confidence”。[Confidence](https://docs.typesafe.ai/confidence)

**本项目建议：**fast-jev 对 Gemini / compatible 模型生成的数值使用 `probability_source: "self_reported"`、`calibrated: false` 等可检查标记。如果定义自己的 confidence，应公开公式与含义。阈值只是分流规则；没有标签集验证时，不宣称“超过 0.9 就有 90% 正确率”。

### 6.2 “零幻觉”的实际范围

发布文章把 schema 匹配保证作为“零幻觉/零类型错误”图表的依据，并明确其 0% 不是经验测量。可以把它理解为不会生成答案空间之外的类型或选项；不能扩展为“所有业务判断都对”。[官方发布文章的 type-safety 说明](https://typesafe.ai/blog/introducing-system-one-models-and-jev)

fast-jev 能做的保证更具体：**只向下游返回通过本地契约校验的结果，否则报告错误**。这不等价于后端永不输出非法 JSON，也不等价于语义正确。对于极小舍入误差，可按明确容差归一化；对于缺键、额外候选、NaN、负数、严重失衡的分布应拒绝，不能静默修成“看起来可信”的结果。

## 7. 速度与成本：数字、条件和可比较性

官方发布文章给出 **70–500 ms** 的端到端响应范围，并说明其测量通常来自美国西岸设备；首页倍数来自自建 workflow 评估，官方承认那些收益可能偏向现实收益的较高端。短、信息密集输入也有利于演示效果。上述数字不构成全球网络、所有输入长度或任意并发下的服务保证。[官方发布文章](https://typesafe.ai/blog/introducing-system-one-models-and-jev)

按 Models 页的输入单价，若**实际计费输入**恰为 1,000 tokens，则每次为 `$0.000042`，100 万次约 `$42`；若为 10,000 tokens，则每次 `$0.00042`。这是按公开单价做的算术示例，不是测量结果；问题、判据等也可能影响实际计费输入。价格口径见 [Models](https://docs.typesafe.ai/models)。

截至本次访问，Vercel AI Gateway 的 Jev 页显示促销免费，并注明 **2026-09-25** 结束；其网关模型 ID 为 `typesafe-ai/jev`。促销、不同接入渠道和 TypeSafe 原生定价需分开，不能据此写“Jev 永久免费”。[Vercel Jev 页面](https://vercel.com/ai-gateway/models/jev)

**fast-jev 的速度应拆开测：**

```text
总耗时 = CLI 启动 + 本地校验/提示构造 + 后端启动与认证
       + 网络/排队 + 模型处理与生成 + 响应解析
```

agy 子进程启动可能占比明显；HTTP compatible provider 可能减少启动开销，但仍有网络与推理耗时。批量能摊薄固定成本，也可能增大响应、错误影响范围与上下文干扰。不能在测量前声称 fast-jev 达到 Jev 的毫秒级性能、价格或倍数。

## 8. 评估证据：已有结果及其限度

### 8.1 官方 workflow evals

官方评估覆盖安全事件、agent trace、发票与客服四类工作流。它假定工作流代码正确，使用 GPT-6 Astra 与 Claude Fable 5.1 高思考配置输出的平均值作参考，其余模型采用服务商默认 reasoning 设置。因此其“accuracy”首先衡量与参考模型共识的一致性，不能直接理解为人工核实的业务真值准确率。[官方 Workflow evals](https://evals.typesafe.ai/)

这类评估说明“相同工作流下拆分判断与整段提示之间存在值得考察的差异”，但不能证明所有任务、所有中文资料或所有组织规则都有相同收益。

### 8.2 独立原始报告

截至调研日，已经能找到独立原始评测，不宜继续笼统声称“完全没有第三方数据”。以下是作者报告，**本次没有复跑或审核全部原始请求**：

| 原始研究 | 作者报告的观察 | 主要限制 |
| --- | --- | --- |
| `AbdelStark/jev-benchmarks` | 300 个样本的三任务 pilot；Jev 在 AG News、Banking77/BTZSC 准确率较好，在 Emotion 上概率质量明显较差 | 每任务仅 100 条；部分阈值在同一切片选择和评价；不是通用排行榜 |
| `jujumilk3/jev-calibration-audit` | API-only 审计；观察候选 abstain 选项、不同问法、分组问题和语言的影响 | 特定数据和判据；结果不能直接迁移为本项目阈值 |
| `RINNECODER/jev-behavior-study` | 受控任务中，问题表述、选项顺序、上下文表达会改变结果；简单题通过不代表复杂版本可靠 | 合成、任务特定实验；重复调用不等于独立新样本 |

来源：[概率与选择性风险 pilot](https://github.com/AbdelStark/jev-benchmarks)、[API 校准审计](https://github.com/jujumilk3/jev-calibration-audit)、[行为研究](https://github.com/RINNECODER/jev-behavior-study)。

第一份 pilot 的例子具有实际意义：AG News / Banking77 上的好结果，没有延伸成 Emotion 上的校准保证。研究还明说本地 GLiNER 与托管 Jev 的时延比较是部署测量，不是标准化算力比较。[pilot 方法与限制](https://github.com/AbdelStark/jev-benchmarks)

两份研究对选项顺序影响给出的观察也不同：一份算术小样本发现明显差别，另一份审计的测试集合未发现 argmax 翻转。更合理的结论是把顺序、候选措辞与样本领域纳入实验变量，而不是选择一份结果推广到所有情况。[行为研究](https://github.com/RINNECODER/jev-behavior-study)、[校准审计](https://github.com/jujumilk3/jev-calibration-audit)

## 9. 已知局限与应用场景

官方 2026-09-17 更新的 Jev 1.13 局限页列出：字面理解、精确数字与日期、多步间接推理、无关长上下文、对抗内容、矛盾判据，以及跨问题不保证逻辑恒等关系。它也承认 state 中的注入指令可能影响结果；不能把类型安全当成提示注入防护。[Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13)

以下是结合这些边界给 fast-jev 的任务选择建议：

| 场景 | 推荐用法 | 验收重点 |
| --- | --- | --- |
| 工单与意图分流 | Choice，加入其他/不确定路径 | 每类误分成本、少数类召回 |
| RAG 候选筛选 | Noul 或有清晰等级的 Score | 检索质量、排序指标、查询间分数可比性 |
| 多维方案评估 | 每维一条 Score，代码加权 | rubric 是否单维、排名稳定性 |
| agent 输出检查 | 原子问题评估是否符合明确标准 | 假阴性、漏检、对抗文本 |
| 批量内容标注 | 同一问题集处理多条输入 | 吞吐、失败隔离、中文质量 |
| 精确计数、日期运算 | 优先解析器和普通代码 | 精确结果，不使用概率代替算术 |
| 新方案生成、开放推理 | 使用相应生成或推理流程 | 不以封闭候选伪装开放答案 |

官方 Patterns 提供多问题预先询问、按 confidence 分流、多维组合评分、意图路由等模式。它们可作为程序结构参考，真正的阈值、执行权限与业务动作仍由调用方决定。[Patterns](https://docs.typesafe.ai/patterns)

**本项目建议：**fast-jev 默认只返回决策数据，不把候选字符串当作 shell 命令执行。下游动作由显式代码控制。请求外部模型的文本应限于当前判断所需内容，日志默认避免保存完整输入；这同时减少传输量、上下文干扰和排错时的数据暴露。

## 10. CLI 与生态

### 10.1 jevon 值得借鉴的体验

`jevon` 提供单项 `ask`、批量 `classify`、`doctor` 和模型列表，并提供 MCP、skill、命令 schema 及多种输出格式。环境变量与显式参数优先级清晰，`doctor` 用于解释配置。对 fast-jev 最有价值的是统一的结构化输入输出与故障诊断，不必把所有集成功能同时搬进首版。[jevon](https://github.com/douglance/jevon)

该仓库同时提供其他功能说明，但文档与命令实现可能快速变化；本报告不把它的 README 视为 fast-jev 的兼容承诺。

### 10.2 生态快照

| 层级 | 代表项目 | 对 fast-jev 的启发 |
| --- | --- | --- |
| 官方 SDK | Python `typesafe-sdk`、JavaScript `@typesafe-ai/sdk` | 输入输出类型与错误应稳定、可复用 |
| 官方 LLM 对照适配器 | `system-one-adapter-python` | 通用 LLM 可以承载同类问题契约，但需要结构校验和错误处理 |
| 网关与框架 | Vercel AI Gateway / evaluation 接口 | 不同接入层命名与类型可能不同，应隔离 transport |
| 数据库扩展 | `realZachi/pg-jev` | 决策可嵌入 SQL 过滤、分类、排序 |
| agent 与研究工具 | CLI、MCP、筛选工具、上述独立评测 | 既要方便 agent 使用，也要能记录失败与评估结果 |

官方 SDK 来源：[Python](https://docs.typesafe.ai/sdk/python)、[JavaScript](https://docs.typesafe.ai/sdk/javascript)。数据库项目由其维护者说明为非 TypeSafe 官方关联项目：[pg-jev](https://github.com/realZachi/pg-jev)。网关来源：[Vercel](https://vercel.com/ai-gateway/models/jev)。

官方 `system-one-adapter-python` 已提供用普通 LLM 替代 System One 调用的做法，支持结构化或提示式输出、概率或离散答案、纠错重试与延迟记录。这为“无训练封装决策接口”提供了直接参考，但不证明其与 Jev 的概率语义或内部执行等价。[官方 LLM adapter](https://github.com/typesafe-ai/system-one-adapter-python)

## 11. fast-jev：可以复用什么，不能等价什么

| 维度 | 可实现的封装价值 | 不能据此宣称 |
| --- | --- | --- |
| 决策接口 | Choice / Score / Noul 风格的统一结构 | 使用了 Jev 模型或 RLCD |
| 候选限制 | 本地校验候选集合、类型与数值 | 后端在生成过程中绝不会越界 |
| 多问题调用 | 同状态的一组问题尽量一次发送 | 后端原生并行、问题严格隔离 |
| 概率输出 | 收集模型自报分布、公开校验规则 | 自报数字经过统计校准 |
| 分流 | 显式阈值、uncertain 状态、退出码 | 高 confidence 等于业务正确 |
| 性能 | 短输出、减少往返、可控并发 | 70–500 ms 或比 Jev 更快 |
| 成本 | 复用 agy 登录与已有 API 账户 | 免费或沿用 TypeSafe 价格 |
| 模型适配 | 用户选定模型、固定可用 ID | 某个兼容端点一定支持所有模型和 schema 特性 |

本项目默认 agy 模型配置采用 `gemini-3.8-flash-low`。本机 `agy models` 已列出 `-low`、`-medium`、`-high` 标识；模型后缀与显式 effort 必须一致，例如 `-medium` 配 `--effort low` 会冲突。这是 **agy 模型标识与本机配置观察**，不应仅凭名称推导 Google 官方型号、价格、上下文或上线范围；模型列表可用也不等于真实推理已通过。OpenAI-compatible provider 的模型由用户配置，不静默替换成另一个后端或模型。

**首版落地说明：**fast-jev 0.1 使用 `choice`、`boolean`、有上下界的数值 `score`，每项另附模型自报 `confidence`，元数据标记 `confidence_kind: "self_reported"` 和 `calibrated: false`。首版不返回候选概率分布，数值 score 不是 Jev 等级概率的期望值，boolean 也不是 Noul 概率。下面涉及分布、派生值等内容属于后续设计建议，不是首版兼容承诺；实际用法以中英文 README 为准。

## 12. 首版实现建议

本节是设计建议；已经实现的命令、默认值和示例以仓库 README 为准。

### 12.1 小而明确的 provider 分层

```text
参数 / stdin / 文件
        ↓
统一问题与输入校验
        ↓
提示及输出契约构造
        ↓
Provider 接口
    ├── agy：本机可执行文件，继承已有认证
    └── OpenAI-compatible：配置的 endpoint、API key、model
        ↓
响应提取 → 严格本地校验 → 计算派生结果
        ↓
JSON / JSONL / 简洁文本 + 耗时与状态
```

公共层负责问题类型、概率校验、派生 score、阈值、格式和错误。provider 只处理执行/HTTP 协议、响应外层包裹、用量和错误转换，避免各后端产生不同业务语义。

### 12.2 agy provider

- 首先探测本机可执行文件与帮助，按实际支持的非交互参数启动。
- 复用本机认证；不再要求额外 TypeSafe key。
- 参数使用进程参数数组传递，输入通过适合该 CLI 的安全通道发送，不拼接 shell 命令。
- 必须区分 stdout 决策结果与 stderr 诊断，兼容结构化响应外层中的实际文本字段。
- 设置有限超时、输出大小与取消处理；不能因登录提示或挂起进程无限等待。
- 不请求文件修改、网络浏览或 shell 执行能力；决策任务仅需要模型推断。

### 12.3 OpenAI-compatible provider

- endpoint、model、凭据独立配置，提供 `/chat/completions` 类协议适配。
- `strict JSON Schema`、`JSON mode`、仅提示 JSON 应作为可配置能力；不能假设“compatible”意味着全量支持严格 schema。
- 优先使用可用的结构化输出，但最终仍执行同一套本地校验。
- 不静默降级到另一个供应商，不在错误中回显 API key。
- 区分认证、限流、服务端错误、协议不兼容、输出截断、格式不合法；重试有次数和时间上限。
- 只有 provider 返回真实用量才显示 token 数；未知成本标为未知，不编造估算账单。

### 12.4 简洁 CLI 的核心面

建议首版优先提供四类入口：单次判断、批量判断、配置诊断、查看帮助/版本。普通用户用一条命令问一个问题；高级用户用 JSON 问题集表达多个判断。输入覆盖参数、文件和 stdin；输出覆盖完整 JSON 与只取结果的简洁形式。批量至少保证记录 ID、输入顺序和逐条错误可追踪。

不必在首版加入常驻服务、向量数据库、训练管线和复杂工作流 DSL。MCP 可以后续复用同一决策库，前提是核心 CLI 的行为已经稳定。

### 12.5 输出与失败语义

建议每次响应记录 provider、请求模型、后端报告的实际模型（若有）、耗时、有效答案与概率来源。`calibrated: false` 应可被机器读取。Choice 和 Score 的衍生值应由程序从经校验的分布计算，减少同一响应内的互相矛盾。

“uncertain”与“调用失败”必须分开：前者是有效结果但未达业务阈值，后者没有可用决策。不要在失败时默认选择第一个候选或输出 `false`。若保留自动重试，应在计时中包含重试成本，不把重试后的成功伪装为首轮成功。

## 13. 无训练路线的验证方案

### 13.1 工程契约验证

用假 provider 或固定响应覆盖以下关键路径，避免测试依赖账户、实时网络和实际模型：

| 范围 | 必须验证的行为 |
| --- | --- |
| 输入 | 空状态、重复候选、不合法 question type、超大输入、文件错误 |
| 输出 | 非 JSON、遗漏问题、额外候选、越界数值、全零概率、不合法总和 |
| 派生值 | Choice 选择规则、Score 期望值、阈值边界和 unknown 路径 |
| 进程 | agy 不存在、非零退出、超时、取消、stdout 混入日志 |
| HTTP | 认证失败、限流、非 JSON 错误、输出截断、不支持 response format |
| 批量 | 顺序与 ID 保留、单条失败、并发上限、空输入 |
| CLI | JSON 结果只写 stdout、诊断写 stderr、错误退出码稳定 |

然后对本机 agy 和用户已配置的 compatible endpoint 各做小规模真实 smoke test。应明确区分“测试通过”“真实后端可用”与“模型质量达标”三种结论。

### 13.2 质量评估

构建与预期用途匹配的小型标签集，建议第一轮覆盖中文工单路由、是否满足条件、按 rubric 评分和候选排序；同时包括英文、信息不足、混合类别、对抗文本和长无关内容。训练不是本任务的一部分，标签集用于评估与阈值选择。

记录问题版本、候选顺序、输入、模型配置、输出、失败与时延。冻结测试集；在开发切片上改提示与阈值，在未参与调优的留出集上报告结果，避免把调出来的效果当泛化能力。

| 要回答的问题 | 建议指标 |
| --- | --- |
| 是否选对 | Accuracy、macro-F1、按类 precision/recall、混淆矩阵 |
| 排序是否有用 | nDCG@k 或与业务相关的 top-k 指标 |
| 概率是否可信 | Brier score、NLL、reliability diagram；ECE 报分箱规则与样本量 |
| 阈值是否有用 | 覆盖率与接受结果中的错误率，按阈值绘制关系 |
| 是否稳定 | 重复请求、候选重排、等义改写、单问与多问差异 |
| 是否够快 | p50/p95 端到端耗时、冷启动/热调用、失败率与吞吐 |

二元 Brier score 可按 `mean((p - y)^2)` 计算。评估 Choice 时使用候选概率，不把自定义 confidence 当作同一概率；多分类 Brier 的求和/平均约定需写明。ECE 单个数字容易受分箱和样本量影响，不能单独作为“已校准”的证明。

### 13.3 性能对照协议

分别记录 1、5、20 个问题，短/中/长输入，单条/小批量，可控并发，至少有足够多重复来估计 p95。固定输出信息量，公平比较 agy 与 compatible provider；若将来接入 Jev 对照，也使用同一数据、相同候选、相近的重试与计时起止点。

优化优先级建议：先减少无关输入和重复调用，再减少不需要的输出，最后根据测量调整批量与并发。若 CLI 启动占主导，应单独量化后再决定是否需要常驻进程；不要先增加复杂架构。

### 13.4 验收建议

首版发布可先以这些可验证条件为门槛：配置好的 agy 能直接调用；compatible endpoint 能独立配置；三类判断都有稳定 JSON 契约；非法输出不会成为默认业务决定；批量可追踪失败；中英文 README 能独立指导安装、配置、命令使用与排错。

模型质量与时延门槛应根据真实任务设置，不在本报告虚构“准确率 ≥99%”或“p95 <200 ms”。如需要业务自动执行，只在留出集上满足相应错误预算后开放对应阈值路径。

## 14. 最终建议与待核实事项

建议实施 fast-jev。其价值是给已有模型提供**简单、统一、可验证的快速决策入口**，并让 agy 与 compatible API 共享一套使用体验。无训练的首版在工程上可行，官方 LLM adapter 也说明这是一条有实际用途的路线；竞争力应从安装体验、响应开销、输出稳定性和任务实测中获得。[官方 LLM adapter](https://github.com/typesafe-ai/system-one-adapter-python)

当前仍需在实现阶段核实：

1. 本机 agy 的具体版本、可用模型标识、非交互输入输出与认证行为。
2. compatible endpoint 的真实模型、鉴权、schema/JSON 支持和用量字段。
3. Gemini 在本项目中文决策集上的质量、自报概率分布与留出集阈值。
4. 两种后端的冷启动、p50/p95、批量收益及错误行为。
5. 实际传输和日志内容是否符合使用者对本机与远端处理的预期。

对外描述应使用“Jev 风格的结构化决策 CLI”，避免写成“复刻 Jev 模型”“零幻觉”“已校准”或“保证毫秒级”。

## 15. 可追溯资料索引

下列页面均在 2026-09-20 核查。动态页面、价格和别名可能在之后变化。

| 编号 | 来源 | 本报告使用范围 |
| --- | --- | --- |
| S01 | [TypeSafe 发布文章，2026-09-15](https://typesafe.ai/blog/introducing-system-one-models-and-jev) | 发布、技术主张、时延与宣传口径限制 |
| S02 | [Introduction](https://docs.typesafe.ai/introduction) | 产品定位、原子问题、共享状态 |
| S03 | [System One](https://docs.typesafe.ai/concepts/system-one) | 模型类别与工作流定位 |
| S04 | [Choice](https://docs.typesafe.ai/primitives/choice) | 候选、概率分布、结果语义 |
| S05 | [Score](https://docs.typesafe.ai/primitives/score) | 有序等级、期望值 |
| S06 | [Noul](https://docs.typesafe.ai/primitives/noul) | 二元命题与概率 |
| S07 | [Confidence](https://docs.typesafe.ai/confidence) | 分布摘要与概率区别 |
| S08 | [HTTP API](https://docs.typesafe.ai/api) | 端点、结构、错误与重试 |
| S09 | [Models](https://docs.typesafe.ai/models) | 型号、限额、单价、语言 |
| S10 | [AI primer](https://docs.typesafe.ai/introduction/machine-learning-primer) | RLCD 公开目标、校准解释 |
| S11 | [Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13) | 官方已知失败模式 |
| S12 | [Patterns](https://docs.typesafe.ai/patterns) | 分流与组合模式 |
| S13 | [Workflow evals](https://evals.typesafe.ai/) | 官方评估方法 |
| S14 | [jevon](https://github.com/douglance/jevon) | 社区 CLI / MCP 能力 |
| S15 | [官方 Python SDK](https://docs.typesafe.ai/sdk/python) | SDK 生态 |
| S16 | [官方 JavaScript SDK](https://docs.typesafe.ai/sdk/javascript) | SDK 生态 |
| S17 | [官方 system-one-adapter-python](https://github.com/typesafe-ai/system-one-adapter-python) | 通用 LLM 的决策适配参考 |
| S18 | [Vercel Jev](https://vercel.com/ai-gateway/models/jev) | 网关接入与促销快照 |
| S19 | [pg-jev](https://github.com/realZachi/pg-jev) | 数据库应用生态 |
| S20 | [jev-benchmarks](https://github.com/AbdelStark/jev-benchmarks) | 独立 pilot 与方法限制 |
| S21 | [jev-calibration-audit](https://github.com/jujumilk3/jev-calibration-audit) | 独立 API 观察 |
| S22 | [jev-behavior-study](https://github.com/RINNECODER/jev-behavior-study) | 受控任务与表述敏感性 |
