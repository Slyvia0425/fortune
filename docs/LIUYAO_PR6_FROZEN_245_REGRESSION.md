# PR6：同一冻结 245 卦盘真实回归记录

日期：2026-10-15，Asia/Hong_Kong。工程说明、修改文件清单及脱敏输入输出示例见 `docs/LIUYAO_PR6_PRODUCTION_REPAIR.md`。

## 固定输入与运行方式

- 原问题：我未来三个月能不能找到工作；数字：2、4、5。
- 冻结 chart_id：`700062f6-ab59-4c04-9e1c-04b34985681d`。
- 本卦泽雷随，第五爻动，变震为雷。复用原盘，不调用起卦、确认、Planner、检索或 LLM 取用节点。
- 同一累积快照：11 条证据，保留完整必要原文、条件、例外、来源偏移及 hash。
- 用神：程序规则 `reviewed-career-self-pr65-v1`；官鬼 main:5，世爻 main:3。
- 方向：程序重算并验证 main:3 土生 main:5 金，反向为 generated_by；模型不能覆盖这些事实。
- 模型：Qwen3.5-397B-A17B。Prompt：reasoning-compact-v3。输出：六字段 finding + synthesis，程序编译为公共 StructuredReasoningV1。
- 不读取成功缓存，每次重新调用真实模型；最终文本为已验证 finding 的程序投影，不新增写作模型调用。
- 本次是单独 PR6 回放，每次父级预算 150 秒，模型节点和初次/修复合计最多 120 秒；不是重新运行完整起卦—规划—检索流程。

## 正式结果

| 次数 | 结果 | PR6 回放耗时（秒） | 模型调用次数 | 输入 token 总计 | 输出 token 总计 |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | complete | 30.048 | 1 | 7,740 | 1,449 |
| 2 | complete | 26.384 | 1 | 7,740 | 1,315 |
| 3 | complete | 21.100 | 1 | 7,740 | 886 |
| 4 | complete | 31.249 | 1 | 7,740 | 1,323 |
| 5 | partial | 56.666 | 2 | 16,985 | 2,786 |
| 6 | complete（修复后） | 40.094 | 2 | 16,673 | 1,923 |
| 7 | complete | 30.552 | 1 | 7,740 | 1,311 |
| 8 | complete | 26.995 | 1 | 7,740 | 1,178 |
| 9 | complete（修复后） | 66.139 | 2 | 17,435 | 3,157 |
| 10 | complete | 28.714 | 1 | 7,740 | 1,312 |

- 完整通过：9/10，**90%**；首次即完整通过：7/10，70%。
- partial：1/10；failed：0/10；timeout：0/10。
- P95：**66.139 秒**，nearest-rank；十次全部进入分母，包括 partial 与修复耗时。样本只有十次，因此该算法的 P95 等于本组最大值，不代表大规模生产 SLO。
- 中位数：30.300 秒；最短：21.100 秒。
- 总计 13 次真实模型请求；输入 105,273 token、输出 16,640 token，均来自供应商 usage；finish_reason 均为 stop。
- 输入正文为 14,503 字符（不含 system prompt）；实际输出原文 1,830–2,891 字符/次请求。修复输入另外包含上次原文和字段级错误。

## 失败与修复细节

第 5 次：两次模型输出均将 `synthesis.status` 写成 `conflicting`，违反公共总体状态只允许 supported/conditional/insufficient 的约束。诊断为 `schema_invalid / REASONING_ASSESSMENT_INVALID`。没有把不合法状态静默改成成功，也没有再无限调用；七条独立通过验证的 finding 被安全保留，返回 partial，总体 conclusion=null，正文明确标记“部分分析”，不提供最终预测。

第 6、9 次：初次未经确认的进退神相关表述触发保守事实声明检查，诊断含具体路径（如 `synthesis.conclusion`、`findings[6].interpretation`）、错误文字与程序有向事实。各进行一次修复后通过。这里的通过表示结构、引用、程序事实及明确声明约束通过，不是对所有理论适用性作专家认证。

保守文本检查仍不是完整自然语言验证器，不能宣称彻底杜绝语义误报或所有不恰当推断。本组也保留了 10% 未完整通过的真实结果；若生产门槛为 100% 完整输出，本组尚未达到，不应将“有安全 partial”包装成“全部成功”。

## 修复前后对照

| 阶段 | 实际证据 | 解释 |
| --- | --- | --- |
| 历史 40 秒节点 | WORKFLOW_NODE_TIMEOUT，无有效完整推理 | 当时未保存逐次原文与 usage，不能补造首次错误原因 |
| 同一冻结盘旧 120 秒版本 | 请求总计约 206.715 秒，reasoning timeout，attempts=2，无最终文本 | 请求含前置规划和检索，不应把总时长当单次模型耗时 |
| 当前固定版本 PR6 回放 | 9/10 完整，1/10 partial，0 timeout；P95 66.139 秒 | 仅比较 PR6 阶段能力，不冒称完整系统总时延从 206 秒降至 66 秒 |

除限时外，本次还减少确定性复制工作，统一节点/单次调用的真实剩余预算，增加逐次诊断和定向修复，取消默认冗余写作模型调用。旧版未保存输出 token，无法量化旧版 token 减少比例。

## 可追溯性与隐私

正式原始记录：`.runtime/evals/pr6-production-replay-1792071091162/`。

- `summary.json`：十次结果、耗时、成功率与 P95。
- `input.json`：实际精简输入；`run-1.json` 至 `run-10.json`：各次结构化结果和最终程序渲染。
- `migration.json`：旧 PR6 冻结数据向 PR6.5 有向事实的显式引用迁移，未覆盖原文件。
- `code-manifest.json`：关键源码指纹；`artifact-manifest.json`：原始 cast、confirmation、dialogue、interpretation 文件指纹。每次真实运行后均核对，十次全部保持一致。
- 源码汇总指纹：`5c51be4410de61876806b00ac825ceebc82c75f7e5e986c7876af39eb13676db`。
- 原始文件汇总指纹：`bd1022593a7fd75365e63ed62417578c776d2028e3bef868019e947ebb8c57fc`。

逐次模型原文、修复输出、Schema 错误、耗时与 usage 位于私有 `.runtime/reasoning-diagnostics/`，目录 0700、文件 0600，通过 summary 中的 diagnostic_run_id 关联。公开响应不包含这些原文；不记录 cookie 或 API key，不进入公共知识库。

历史探索性批次与中止批次全部保留，不合并到上述固定版本十次分母。历史 80% 结果对应候选代码，并非本次 90% 结果的替代样本。

## 仓库验证

- `npm run check`：331 项测试通过，8 项显式 opt-in live 测试默认跳过；lint 零错误、4 个既有警告；全仓 TypeScript 通过。
- `npm run build`：生产构建通过。
- `FORTUNE_PR6_REPLAY=1 npx vitest run tests/pr6-replay.live.test.ts`：独立运行并完成上述十次真实调用。该测试通过表示完成并记录了全部十次，不代表每次分析都 complete；指标以上表为准。
- 未重新起卦、未新增 LLM 取用节点、未开发 PR7、未部署或推送远端。
