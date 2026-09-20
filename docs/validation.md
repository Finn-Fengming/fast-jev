# fast-jev 0.1 验证记录

日期：2026-09-20。环境：macOS arm64、Node.js v26.0.0。项目要求 Node.js 22+；已添加 Node.js 22/24、Linux/macOS 的 CI 配置，但本次没有远端 CI 执行结果。

后续实验更新：当前 **103 项测试全部通过**。新增固定数据集、原始证据重算、runner 与数据隔离测试；5 对本地开销 A/B 的 30,000 个正式样本见 [experiments](../experiments/README.md)。下表保留初版 71 项测试的历史验证记录。模型质量与时延测试尚无有效输出，单例/批量的完整计划没有冒充已执行实验。

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

## 真实后端验证

生产适配器使用临时目录、stdin stream-json、JSON Schema、`--mode plan`、`--sandbox`、`--disable-slash-commands` 发起请求。模型质量与时延应使用下方命令单独测量。

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
