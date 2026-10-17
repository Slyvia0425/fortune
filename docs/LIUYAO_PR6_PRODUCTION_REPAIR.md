# PR6 Structured Reasoning 生产修复

日期：2026-10-15（Asia/Hong_Kong）。范围：当前 PR1–PR6.5 集成代码；未开发 PR7，未新增 LLM 取用节点，未重新起卦。

## 当前状态：接口已整合，固定版本真实验收已完成

21:24:25，`lib/server/divination-llm.ts` 在本任务未对该文件发起编辑时被改回只接受数字 timeoutMs 的版本，本次新增的 PlannerRequestOptions、PlannerCallMetadata、analysisModelIdentity 和 usage 回调消失。经用户确认后，在保留文件其他改动的基础上重新整合这些接口，并保持原有数字超时参数兼容。

重新整合后，全仓检查通过：331 项测试、lint 零错误（4 个既有警告）、TypeScript 和生产构建均通过。最终真实回放逐次核对源码与原始冻结文件指纹，十次均保持一致。

最终新批次为 `.runtime/evals/pr6-production-replay-1792071091162/`：**10 次中 9 次 complete、1 次 partial、0 次 failed、0 次 timeout；完整通过率 90%，P95=66.139 秒**（nearest-rank，包含全部十次及修复时间）。首次即完整通过为 7/10；共发生 13 次真实模型请求。不能将 partial 算作完整成功，也不能据此声称已经 100% 稳定上线。

历史候选版 `.runtime/evals/pr6-production-replay-1792070334881/` 的 8/10 complete、2/10 partial、P95=58.608 秒仅作调试历史。其中原文泛论触发方向误报的问题已经区分原文/假设与当前断言，并让修复提示包含具体字段、错误文字和程序方向。历史及中止批次均未与最终固定版本混合统计。

完整逐次耗时、token 和剩余问题见 `docs/LIUYAO_PR6_FROZEN_245_REGRESSION.md`。

## 1. 修复内容与文件清单

| 文件 | 本次职责 |
| --- | --- |
| `lib/server/reasoning-config.ts`（新增） | 统一 PR6 调用、节点、修复、输出 token 和全局预算常量 |
| `lib/server/workflow-budget.ts` | 内层 deadline 取节点/父级剩余时间的较小值，已中止时剩余时间为零 |
| `lib/server/divination-llm.ts` | 保留第四参数数字兼容，增加类型化 options；调用限时钳制到真实剩余时间，提供模型/usage/finish_reason 回调 |
| `lib/divination/reasoning-input.ts`（新增） | 验证后构建精简输入、短引用别名和必要证据清单；完整保留选中原文及 provenance |
| `lib/divination/reasoning-output.ts`（新增） | 六字段模型 finding 编译为公共 V1；字段级引用错误；独立验证并挽救部分 finding |
| `lib/divination/structured-reasoning.ts` | 冻结身份、事实与程序取用一致性验证；有向事实与未验证推导保护；区分完整/部分校验 |
| `lib/divination/fact-claim-guard.ts`（新增） | 检查明确表达的角色变更、反向生克和把未验证进退神当既定事实的表述 |
| `lib/divination/analysis-plan.ts` | Planner 文本中的明确生克/取用声明也不能违背程序事实 |
| `lib/server/structured-reasoning-llm.ts` | compact-v3 提示；一次有针对性的格式/引用修复；超时不盲重试；默认最终文本由程序投影 |
| `lib/server/reasoning-diagnostics.ts`（新增） | 逐次诊断分类、耗时、token、结束原因、Schema 错误与私有原始输出 |
| `lib/server/reasoning-stage.ts` | 完整缓存保持兼容；partial 只渲染验证通过部分且禁止最终结论，不污染完整检查点 |
| `app/api/divination/interpret/route.ts` | 传递已验证冻结记录；公开安全诊断编号，不公开模型原始输出 |
| `lib/contracts/divination.ts` | 加法兼容：analysis_status 增加 partial，公共 StructuredReasoningV1 字段不变 |
| `lib/server/reasoning-replay.ts`（新增） | 原始 245 私有数据的只读离线回放与 PR6.5 事实引用迁移 |
| `tests/pr6-production.test.ts`（新增） | 输入、引用、方向、角色、部分回退、错误分类与诊断单元测试 |
| `tests/pr6-replay.live.test.ts`（新增） | 同一冻结卦盘 10 次无缓存真实调用，逐次落盘并统计成功率/P95 |
| `tests/pr6-transport.test.ts` | 单次限时、内层剩余预算钳制、usage、截止中止测试 |
| `tests/structured-reasoning.test.ts` | 空证据必须 failed；旧契约、修复、恢复与预算回归 |
| `tests/analysis-plan-route.test.ts` | compact 模型契约、确定性文本投影与 PR6.5 路由回归 |
| `tests/fixtures/reasoning-fixture.ts` | 合成测试使用匹配冻结身份的取用记录 |

## 2. 错误原因与预算

旧记录已经证明：40 秒节点曾超时；调为 120 秒后，求职 245 的完整解释请求仍耗时约 206.7 秒并返回 `reasoning / WORKFLOW_NODE_TIMEOUT / attempts=2`。这 206.7 秒是含规划、检索的请求总时间，不是单次模型时间。旧日志没有保存首次尝试输出及错误，不能事后断言第一次一定是 JSON 或引用错误。

当前代码核对发现的实际问题：

1. `boundedWorkflow` 虽合并中止信号，但曾向内层继续传父级 deadline。修复请求可能按全局剩余时间计算，而不知道自己的节点已接近截止。
2. 旧输出要求模型逐字复制 observation、长 ID、缺口、hash 等确定性内容。现在由程序生成这些字段，模型只输出 finding 与 synthesis。
3. 旧重试循环把超时、JSON、引用和其他异常混在一起；现在只对 invalid_json、schema_invalid、invalid_reference 且剩余至少 15 秒时允许修复一次，发送上次原文与错误路径。timeout 和传输失败不重复相同请求。
4. 旧最终写作只做逐字复制，仍需要模型调用，额外引入延迟和失败。默认改为程序投影，不增写判断；兼容的显式自定义 writer 测试入口保留。
5. 实际模型可能引用合法 ID 却把关系或未验证趋势写错。现在除结构引用校验，还检查明确的方向冲突和用神变更；进退神查询只查定义，不将其自动升级成已成立的盘面事实。

预算统一于 `reasoning-config.ts`：单次最多 120 秒、节点最多 120 秒（初次与修复共享）、整体解释最多 420 秒。实际单次限时进一步取节点/全局剩余时间较小值，并预留诊断处理余量。已有旧流程默认 30 秒模型调用不被放宽。PR6 输出上限 6000 token，不截断输入中的必要原文。

PR6.5 已经支持第四参数数字，本次没有假定这个兼容修复不存在；新增 options 仍兼容原有数字调用，类型检查覆盖两种形式。

## 3. 脱敏输入与输出示例

以下是结构节选，不是实际发给模型的截断输入。生产输入保留被选中证据的完整原文、全部必要条件和例外。示例中的身份及原文仅为脱敏展示。

```json
{
  "version": "reasoning-input-v2",
  "confirmed_question": {
    "confirmation_id": "[redacted]",
    "question_hash": "[redacted]",
    "normalized_question": "我未来三个月能不能找到工作",
    "time_constraint": {"kind": "duration", "expression": "未来三个月", "evidence": "[redacted]"}
  },
  "use_role_decision": {
    "rules_version": "reviewed-career-self-pr65-v1",
    "primary": {"role": "officials", "main_line_refs": ["main:5"], "hidden_line_refs": [], "location_status": "main"},
    "auxiliary": [{"role": "self", "main_line_refs": ["main:3"], "hidden_line_refs": [], "location_status": "main"}]
  },
  "fact_catalog": {
    "chart_hash": "[redacted]",
    "facts": [{"fact_id": "F10", "type": "line_relationship", "subject_ref": "main:3", "object_ref": "main:5", "value": {"source_element": "土", "target_element": "金", "element_relation": "generates", "relation_id": "[redacted]"}}]
  },
  "allowed_tasks": [{"task_id": "task_04_relation_check", "parent_task_id": "task_04_relation_check", "fact_refs": ["F11", "F10"], "required_evidence_ids": ["E2"], "definitions_only": false}],
  "evidence": [{"evidence_id": "E2", "text": "[展示脱敏；真实请求保留完整必要原文]", "task_ids": ["task_04_relation_check"], "rounds": [1], "provenance": {"source_revision_id": "[redacted]", "quote_hash": "[redacted]", "origins": "[完整真实来源偏移记录]"}}],
  "unresolved_gaps": ["[真实缺口列表]证据停止不代表条件已满足"]
}
```

若有已确认背景、关系、过程状态或排除项，输入 builder 也保留这些冻结信息，不传完整历史对话、检索分数和重复的问事分析对象。

模型只输出以下形状（本示例仅展示一项任务；完整输出必须覆盖实际全部任务）：

```json
{
  "findings": [{
    "task_id": "task_04_relation_check",
    "fact_refs": ["F11", "F10"],
    "evidence_ids": ["E2"],
    "status": "conditional",
    "interpretation": "程序事实为世爻生官鬼。能否据此应用所引理论，仍须核验双方状态及原文前提，不能倒置方向或直接推断录用结果。",
    "limitations": ["所引规则的适用条件尚未全部核验。"]
  }],
  "synthesis": {"status": "conditional", "conclusion": "仅可作有条件的传统解释，不能确定现实求职结果。", "limitations": ["其余重要条件仍存在缺口。"]}
}
```

程序负责将短别名解析回当前目录真实 ID，补齐 finding_id、规范 observation、competing_views、完整 unresolved_questions 及公共 overall_assessment，再经过 V1 校验。模型不能输出额外用神或 observation 字段来覆盖程序结果。

## 4. 诊断、回退与隐私

- 分类：timeout、invalid_json、schema_invalid、invalid_reference、insufficient_evidence；另保留 transport_error，不把 HTTP 失败冒充 Schema 错误。
- 逐次保存：模型标识、Prompt 版本、耗时、输入字符数、输出字符数、输入/输出 token（供应商未返回时为 null）、finish_reason、实际调用限时、具体错误路径和原始输出。
- 私有目录 `.runtime/reasoning-diagnostics/` 为 0700，文件 0600；不记录密钥、cookie、鉴权头或完整提示词，不写公开知识库或公开 API。模型原文仍可能包含隐私，部署方需设置受控访问和保留期限。
- 已通过验证的部分 finding：仅返回 partial，整体 conclusion=null，明确部分未完成；通过程序模板渲染，不调用旧模型绕过校验，也不保存成完整 reasoning 检查点。
- 无有效 finding 或空证据：reasoning_failed，modern=null。保留原冻结盘和累积证据供重试。
- 身份、事实或程序取用不一致：拒绝交付；知识身份改变仍由原有 assertFresh 检查拦截。

## 5. 验收方法与边界

使用已保存 chart_id `700062f6-ab59-4c04-9e1c-04b34985681d`，本卦泽雷随、第五爻动、变震为雷，累积 11 条证据。回放不调用 cast、confirm、Planner、检索或取用模型；每次不读取 reasoning 成功缓存，真实调用已配置模型。

原始保存数据早于 PR6.5：回放器用同一 core 重新派生有向事实，明确迁移旧 fact_refs；依据原句开头的“我”及精确偏移补回旧 Q1 漏掉的显式主体，再由已审定程序规则决定官鬼 main:5 / 世爻 main:3。旧关系任务自由文本改为程序中性描述。所有迁移仅存在于回放上下文，原始冻结文件、卦盘、问题及证据原文不覆盖。迁移清单、core/snapshot hash 均私有落盘；不冒充旧 fact_id 仍可直接适配新派生版本。

验证 main:3 土 → main:5 金为 generates，反向为 generated_by；用神仍是程序决定。完整结果再次通过公共 V1 校验；final text 仅投影已验证 finding，并保留程序观察、限制与缺口。

这是一张冻结卦盘的离线真实模型回放，不等于跨所有专题或用户的线上质量/SLO 验收；不会据此声称文字的全部理论适用性已获专家认证。语法方向保护是保守规则，不是完整自然语言证明。原文相关性与隐含语义仍需更多评测。

## 6. 自动测试和真实统计

全仓 331 项通过，8 项显式 live 测试默认跳过；本次另外独立启用真实回放测试，完成全部十次。`npm run check`、TypeScript、生产构建通过。lint 为零错误、4 个既有警告。

最终回放使用 Qwen3.5-397B-A17B、reasoning-compact-v3。精简输入正文 14,503 字符；供应商报告首次请求输入 7,740 token。13 次实际请求总计输入 105,273、输出 16,640 token，结束原因均为 stop。输入/输出 token 是供应商 usage，不是按字符估算。原始旧版本未保存 usage，因此不编造 token 减少百分比。

唯一 partial 为模型两次返回不合法的 `synthesis.status="conflicting"`；公共总体状态只允许 supported/conditional/insufficient。系统未放宽该契约，而是保留七条已验证 finding、将总体结论置 null，按 partial 呈现。这个剩余 Schema 问题真实计入未完整成功；若上线要求所有请求均输出完整推理，当前 90% 样本结果仍未达到该要求。

探索性 compact-v2 回放：10 次中 7 次 complete、3 次 partial，P95=57.679 秒，未发生 timeout；不作为最终版本成功率。校验器调整中的中止批次也保留原始记录，不混入最终固定版本 10 次的分母。

复现命令（读取本机受控 `.env.local`；会发生真实模型调用）：

```sh
FORTUNE_PR6_REPLAY=1 npx vitest run tests/pr6-replay.live.test.ts
```

可用 `FORTUNE_PR6_REPLAY_SOURCE` 指定另一份已保存且通过身份校验的同类 245 原始目录；不使用新起卦代替回放。
