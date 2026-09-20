# fast-jev 0.1 验证记录

日期：2026-09-20。环境：macOS arm64、Node.js v26.0.0。项目要求 Node.js 22+。当前模型实验入口为 [AGY / 原生 Jev 对比](../experiments/COMPARISON.md)，本轮状态和指标见[60 秒后续实验报告](../experiments/results/agy-jev-openrouter-60s-test-20260920/comparison.md)。早期 AGY-only、外部 Jev 资料和离线封装开销实验作为历史证据保留。

## 当前对比实现的验证

60 秒后续实验已结束，状态 `completed_with_errors`：148/148 次计划调用全部执行，两个后端、两种模式均覆盖 64/64 案例，无 `not_run`。单例端到端正确率为 AGY **59/64**、Jev **64/64**；批量为 AGY **48/64**、Jev **63/64**。AGY 单例包含 2 次超时和 3 次 `AGY_FAILED`，批量包含 2 次超时、影响 16 条案例；成功输出全部正确。Jev 所有请求成功，批量唯一错误为评分题。成功请求时延、评分 MAE/精确匹配及全体请求分位数见[对比汇总](../experiments/COMPARISON.md#completed-60-second-follow-up)。

本轮独立报告保留 2 个 UTC 与单调时钟差异提示；单调计时的耗时一致性和串行无重叠检查通过。22 个被测源码文件 hash 保持冻结版本不变，运行时 HEAD 为 `60066f4`。失败、计时边界和[分析](../experiments/results/agy-jev-openrouter-60s-test-20260920/analysis.md)一并保留；未把完整覆盖误写成全部调用成功。初轮 30 秒部分结果仍见下文。

本机执行 `node --test --test-concurrency=1 test/*.test.mjs`，**169/169 测试通过**。此前一次并行测试中，一个模拟 AGY 子进程测试触发了 15 秒测试限制；随后完整串行重跑全部通过。测试覆盖原有生产行为，以及新增原生 Jev 类型与范围验证、固定官方 endpoint、无重试、秘密脱敏、配对调度、失败停止、计时一致性、冻结快照及原生答案重算。离线 fixture 不消耗模型额度，其固定正确答案不能充当模型准确率。

历史发布版本的 [CI](https://github.com/Finn-Fengming/fast-jev/actions/workflows/ci.yml)曾在 Node.js 22/24 × Linux/macOS 四组环境通过；这不是对本次新提交 CI 状态的声明。本轮实现测试和真实模型结果分别记录。

两轮正式调用使用同一份冻结实现 [`d09f240`](https://github.com/Finn-Fengming/fast-jev/commit/d09f2408e79b32b4bec99db62af10268911c1195)。[初轮 30 秒协议](../experiments/protocols/agy-jev-openrouter-20260920.md)按规则停止，其[完整记录](../experiments/results/agy-jev-openrouter-test-20260920/comparison.md)保留：两后端各尝试 15/64 条单例案例，AGY 8/15 正确、7 次超时，Jev 15/15 正确；连续 3 次 AGY 正式超时触发停止，剩余各 49 条单例和全部批量案例未运行。

之后在新调用前明确记录[后续协议](../experiments/protocols/agy-jev-openrouter-60s-20260920.md)：双方时限改为产品默认的 60 秒，先运行每批 8 例模式，再单例。新一轮启动 HEAD 为 `60066f4`，被测源码 hash 与初轮相同；题目、标签、模型、适配器和评分规则均未改变。双方在新目录重新调用同一组 64 条案例，各模式一轮，同样种子、顺序和批次，串行 AB/BA 交替，无应用层重试。失败停止规则保持原样。修订发生在观察到初轮失败之后，两轮完整记录并列，不补写旧记录或挑选最佳预测。

两轮之间的[三条开发案例诊断](../experiments/results/agy-jev-timeout-dev-20260920/README.md)在 60 秒时限下全部成功，耗时 11.37–14.58 秒，成功事件到进程退出约 1 秒。该观察不能确证初轮超时原因；未据此进行生产修复。转发原始流的观察代理只用于这次开发诊断，正式调用不使用代理。

Jev 使用 OpenRouter 原生 Decisions API。`noul >= 0.5` 转为布尔答案，评分保留浮点值；本轮报告同时展示评分 MAE、精确匹配和 ≤ 0.5 容差。该集原有案例与先前成绩已经被观察，因此属于固定诊断集重新测量，不是新增盲测。Jev 的概率与 AGY 自报告 confidence 不作比较。

[开发接口检查](../experiments/results/agy-jev-openrouter-dev-20260920/comparison.md)只用于确认接入，它保留正式提交前工作树的源码 hash，不计入正式质量与速度表。正式结果的源码快照、全局调度、开始/结束计时及原生答案转换由 `experiments/compare-report.mjs` 独立核验。详见[复现说明](../experiments/README.md)和[来源说明](../experiments/PROVENANCE.md)。

## 初版历史验证

| 检查 | 结果与覆盖范围 |
| --- | --- |
| `npm test` | **71 / 71 通过**，无跳过；全部为本地固定数据、模拟进程或模拟 HTTP 响应，不消耗模型额度 |
| `npm run check` | CLI、决策层、两种 provider 的语法检查通过 |
| 文档命令 | help、config、单次/批量/rank dry-run、中文输入等离线路径通过 |
| npm 打包安装 | `npm pack` 后在临时独立目录离线安装，两个 binary `fast-jev` / `fjev` 可运行，无 runtime 依赖 |
| compatible 完整 HTTP 链路 | 安装后的 `fjev` 经真实 loopback HTTP 连接发送一次 Chat Completions 请求；本地 fixture 检查 URL、Bearer header、模型和 strict schema，CLI 成功解析并校验结果 |
| 本机 agy doctor | 通过；最终版本为 **1.2.7**，存在 `gemini-3.8-flash-low`，必要 flags 均可用 |

测试重点包括：精确候选匹配、数值范围、JSON 类型、重复/缺失 ID、批量结果重排、排序并列稳定性、筛选、阈值边界、非法结果整批失败、配置优先级、错误后端参数、凭据脱敏、超时、取消、进程退出、输出上限，以及无隐式重试。

HTTP fixture 使用本地固定决策，不是真实模型。它证明安装包、CLI、HTTP transport 和结果验证能够协作，不能证明任意第三方服务的兼容性或模型质量。

## 历史 AGY 单后端推理

生产 `runAgy` 使用临时目录、stdin stream-json、JSON Schema、`--mode plan`、`--sandbox`、`--disable-slash-commands` 发起请求。

2026-09-20 的[真实检查](../experiments/results/agy-recovered-preflight-20260920/report.json)使用 agy 1.2.7 与模型 `gemini-3.8-flash-low`，退出码为 0，状态为 `ready`。决策计时为 **20,956 ms**，后端报告为 **7,293 ms**；前者包含封装与 agy 进程等耗时，不能将后者当作 CLI 响应速度。一次连通检查不代表模型准确率或时延分布。

随后，生产适配器对选定的 8 条开发案例全部答对：[单例](../experiments/results/agy-recovered-dev-single/report.md)共 8 次请求，p50 **12,570.03 ms**、均值 **13,069.34 ms**、p95 **20,561.11 ms**；[批量 8 例](../experiments/results/agy-recovered-dev-batch-8/report.md)共 1 次请求，耗时 **12,790.11 ms**。单次批量只能证明这一批调用成功；8 条开发案例也不足以支持生产质量结论。

[精简 agent 候选](../experiments/results/agy-lean-dev-single/report.md)同样答对 8/8，p50 **11,955.33 ms**，但均值 **13,396.23 ms**、p95 **25,575.76 ms** 均未改善，因此未采用；生产适配器未改动。独立[候选审计](../experiments/results/agy-lean-dev-audit/report.json)记录 agent 名称 `fast-jev`、57 个声明工具、0 个观察到的工具事件、`num_turns: 2` 与 26,492 输入 token。这不证明执行环境完全没有工具，也不据此推断 token 或轮次数值的成因。

正式测试遵循测试前冻结的[评测协议](../experiments/protocols/agy-recovery-20260920.md)：全部 64 条测试案例，单例 1 轮，8 例批量 3 轮。开发结果不替代测试集结果；公开 Jev 数字仍是不同任务与环境下的历史参考。

[正式单例结果](../experiments/results/agy-recovered-test-single/report.md)覆盖 64/64 条案例，62 次成功、2 次 `AGY_TIMEOUT`，端到端正确率 **62/64 = 96.88%**，成功响应条件下准确率 **62/62 = 100%**。全部 16 条评分题完全命中，MAE 为 0。成功请求 p50/p95 为 **11,918.71 / 23,732.13 ms**；包括失败的全部请求为 **11,939.07 / 29,590.07 ms**。两次超时保留在正确率分母中，不能通过只看成功请求掩盖。单例仅一轮，不报告跨轮一致性。

[正式批量结果](../experiments/results/agy-recovered-test-batch-8/report.md)每批 8 例，共 3 轮、24 次请求，24/24 请求成功。首轮 **64/64 = 100%** 正确，三轮共 192/192 次案例执行正确，64/64 条案例的预测跨轮完全一致。首轮评分题 16/16 完全命中，MAE 为 0。请求 p50/p95 为 **12,815.80 / 21,160.12 ms**，均值为 **13,539.35 ms**；均值除以八得到 **1,692.42 ms/例**，只是摊销耗时，不能作为单条响应时间。两种模式的请求样本数不同，按顺序运行，也不保证能复现完全相同的服务端速度。

两组正式运行之后修复了实验 runner 的辅助错误分类：超时错误提示含有 `login`，旧规则因先匹配该词而将 `AGY_TIMEOUT` 误归为 `authentication`。原始错误码正确，计分、超时限制和失败数量不受影响。原始文件保持不变；[勘误说明](../experiments/ERRATA.md)记录修复与受影响条目。这次错误分类修复未修改生产适配器、提示词、模型和评分规则。修复新增的 10 项测试与原有 103 项测试合计 **113/113 通过**。

初版对通用 OpenAI-compatible Chat Completions 的验证仅使用本地 HTTP fixture。本轮新增的远端 Jev 调用走专用 Decisions API，不等于已经实测所有通用 compatible 服务。

## 通用后端连通检查

```sh
# 先确认原始 agy 能正常推理，再测试封装
fjev doctor --live

# 或显式配置 compatible endpoint/model/key 后测试
fjev doctor --provider openai --model your-model-id --live

# 真实请求计时，不使用模拟数据冒充模型响应
npm run benchmark -- --provider agy --runs 3
```

基准脚本记录每次成功/失败和实际端到端耗时；3 个样本仅用于连通性检查，不足以声称稳定的 p95、总体准确率或校准水平。业务评估方案见 [调研文档](research-jev.md#13-无训练路线的验证方案)。

## 公开安装包与隐私处理

发布版增加固定的 AGY 错误提示和数值 token 元数据过滤，不直接输出任意后端错误
内容；通用 compatible 实验不导出本机配置的私有端点，当前原生 Jev 实验明确记录固定的公开官方 endpoint。历史探测清单仅保留被测型号与必要
参数。发布时的隐私调整没有被追溯伪装成旧实验的测量版本，旧输出、准确率和耗时保持原值；当前配对实验另存新源码快照和调用记录，见[来源说明](../experiments/PROVENANCE.md)。

`npm run package` 使用明确的文件清单生成 `dist/fast-jev.tgz` 和校验文件；
`npm run test:package` 从该归档进行全新离线安装，验证两个命令、stdin、dry-run
和包 API。用户通过[安装说明](distribution.md)中的 Release 链接安装，无需源码。
