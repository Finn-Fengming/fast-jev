# fast-jev 0.1 验证记录

日期：2026-09-20。环境：macOS arm64、Node.js v26.0.0。项目要求 Node.js 22+；[CI](https://github.com/Finn-Fengming/fast-jev/actions/workflows/ci.yml)已在 Node.js 22/24 × Linux/macOS 四组环境全部通过。

后续实验更新：当前 **113 项测试全部通过**，`npm run check` 通过。新增固定数据集、原始证据重算、runner 与数据隔离测试，以及 10 项错误分类回归测试；5 对本地开销 A/B 的 30,000 个正式样本与真实 agy 实验见 [experiments](../experiments/README.md)。下表保留初版 71 项测试的历史验证记录。agy 的真实成功输出、开发集及正式单例/批量测试结果见下文；原有单例/批量计划仍保留为未执行记录。

## 已通过

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

## 真实 agy 推理

生产 `runAgy` 使用临时目录、stdin stream-json、JSON Schema、`--mode plan`、`--sandbox`、`--disable-slash-commands` 发起请求。

2026-09-20 的[真实检查](../experiments/results/agy-recovered-preflight-20260920/report.json)使用 agy 1.2.7 与模型 `gemini-3.8-flash-low`，退出码为 0，状态为 `ready`。决策计时为 **20,956 ms**，后端报告为 **7,293 ms**；前者包含封装与 agy 进程等耗时，不能将后者当作 CLI 响应速度。一次连通检查不代表模型准确率或时延分布。

随后，生产适配器对选定的 8 条开发案例全部答对：[单例](../experiments/results/agy-recovered-dev-single/report.md)共 8 次请求，p50 **12,570.03 ms**、均值 **13,069.34 ms**、p95 **20,561.11 ms**；[批量 8 例](../experiments/results/agy-recovered-dev-batch-8/report.md)共 1 次请求，耗时 **12,790.11 ms**。单次批量只能证明这一批调用成功；8 条开发案例也不足以支持生产质量结论。

[精简 agent 候选](../experiments/results/agy-lean-dev-single/report.md)同样答对 8/8，p50 **11,955.33 ms**，但均值 **13,396.23 ms**、p95 **25,575.76 ms** 均未改善，因此未采用；生产适配器未改动。独立[候选审计](../experiments/results/agy-lean-dev-audit/report.json)记录 agent 名称 `fast-jev`、57 个声明工具、0 个观察到的工具事件、`num_turns: 2` 与 26,492 输入 token。这不证明执行环境完全没有工具，也不据此推断 token 或轮次数值的成因。

正式测试遵循测试前冻结的[评测协议](../experiments/protocols/agy-recovery-20260920.md)：全部 64 条测试案例，单例 1 轮，8 例批量 3 轮。开发结果不替代测试集结果；公开 Jev 数字仍是不同任务与环境下的历史参考。

[正式单例结果](../experiments/results/agy-recovered-test-single/report.md)覆盖 64/64 条案例，62 次成功、2 次 `AGY_TIMEOUT`，端到端正确率 **62/64 = 96.88%**，成功响应条件下准确率 **62/62 = 100%**。全部 16 条评分题完全命中，MAE 为 0。成功请求 p50/p95 为 **11,918.71 / 23,732.13 ms**；包括失败的全部请求为 **11,939.07 / 29,590.07 ms**。两次超时保留在正确率分母中，不能通过只看成功请求掩盖。单例仅一轮，不报告跨轮一致性。

[正式批量结果](../experiments/results/agy-recovered-test-batch-8/report.md)每批 8 例，共 3 轮、24 次请求，24/24 请求成功。首轮 **64/64 = 100%** 正确，三轮共 192/192 次案例执行正确，64/64 条案例的预测跨轮完全一致。首轮评分题 16/16 完全命中，MAE 为 0。请求 p50/p95 为 **12,815.80 / 21,160.12 ms**，均值为 **13,539.35 ms**；均值除以八得到 **1,692.42 ms/例**，只是摊销耗时，不能作为单条响应时间。两种模式的请求样本数不同，按顺序运行，也不保证能复现完全相同的服务端速度。

两组正式运行之后修复了实验 runner 的辅助错误分类：超时错误提示含有 `login`，旧规则因先匹配该词而将 `AGY_TIMEOUT` 误归为 `authentication`。原始错误码正确，计分、超时限制和失败数量不受影响。原始文件保持不变；[勘误说明](../experiments/ERRATA.md)记录修复与受影响条目。生产适配器、提示词、模型和评分规则均未修改。修复新增的 10 项测试与原有 103 项测试合计 **113/113 通过**。

本次没有用户指定的远端 OpenAI-compatible endpoint、模型和凭据，因而只做了 compatible 协议验证，没有宣称已完成该远端模型的在线验证。

## 在可用后端上复测

```sh
# 先确认原始 agy 能正常推理，再测试封装
fjev doctor --live

# 或显式配置 compatible endpoint/model/key 后测试
fjev doctor --provider openai --model your-model-id --live

# 真实请求计时，不使用模拟数据冒充模型响应
npm run benchmark -- --provider agy --runs 3
```

基准脚本记录每次成功/失败和实际端到端耗时；3 个样本仅用于连通性检查，不足以声称稳定的 p95、总体准确率或校准水平。业务评估方案见 [调研文档](research-jev.md#13-无训练路线的验证方案)。
