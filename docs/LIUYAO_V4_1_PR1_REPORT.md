# V4.1 PR-1 实施与验收记录

日期：2026-10-14。范围：前置起卦过渡 Gate 与 D1 分类修复。
本记录描述本轮本地改动，不代表已创建 GitHub PR 或完成 V4.1 全流程。

## 修改范围

- `lib/contracts/divination.ts`：新增可选 domain/question_type/event_type；保留旧 question_kind 消费者的兼容字段。
- `lib/server/divination-llm.ts`：D1 Prompt/Parser 同步领域与功能枚举，强制独立占事列表；功能映射至旧字段；统一 UTF-16 证据偏移。
- `lib/divination/chat.ts`：clarify 不附起卦请求；规则/服务不可用回退不授权起卦；多占事优先要求选择。
- `lib/divination/chat-gate.ts`：前端复用的起卦条件及明显多问的保守拦截。
- `app/divination/divination-chatbot.tsx`：起卦先经过上述 Gate。
- `tests/divination-chat.test.ts`、`tests/divination-chat-gate.test.ts`：回退、分类、多问、模糊问题、Unicode 及前端 Gate 回归。

工作区已有其他未提交改动，本轮保留这些改动，没有将整个工作区提交为一个 PR。

## 迁移与边界

PR-1 采用方案允许的过渡期 ready 门控。可靠 LLM 解析且唯一占事时仍使用旧 ready 协议；没有把 ready 冒充为 explicit_user_action 确认。
模型缺少新的领域/功能/goal_groups 字段时拒绝解析，不使用旧中文分类静默通过。
领域尚未有受控事件目录时 event_type=other；后续由 PR-3 的 taxonomy 接入。

直接调用旧 `/cast` 的服务端确认拦截、确认按钮、确认 ID、稳定草稿、冻结幂等指纹、旧盘恢复属于 PR-2，尚未实现。
因此本阶段只能验收正常聊天流程不因 clarify 起卦，不能宣称“任意客户端未确认均无法起卦”。方案 PR-1 的完整 API DoD 与 PR-2 的存储依赖需要联合验收。
明显多问的规则只是保守兜底，不是所有中文语义的确定性证明；Q1 的独立预检属于 PR-3。

## 测试与结果

- 改动前 `npm test`：131 passed，2 skipped。
- 改动后 `npm test`：145 passed，2 skipped（真实服务测试未配置，未声称线上模型已验证）。
- `npm run typecheck`：通过。
- 本轮文件定向 ESLint：通过。
- `npm run lint`：失败，旧 `scripts/build_stage5_final_review.cjs` 有 3 个 `no-require-imports` 错误；knowledge-centre 存在原有警告。
- 对 `git show HEAD:scripts/build_stage5_final_review.cjs` 使用 ESLint stdin 重跑，得到同样 3 个错误，确认属于提交基线问题。

## 阶段状态

PR-1 的代码和定向验收已通过；全项目 lint 门槛未通过，M0 服务端确认 Gate 尚未完成。
依据“每阶段测试通过后进入下一阶段”的执行要求，本轮未进入 PR-2，未接新 Planner、双轮循环、结构化推理或 GraphRAG。
下一步需处理既有 lint 基线或明确项目对既有错误的验收口径，然后按 PR-2 独立实施服务端确认与冻结绑定。
