# V4.1 PR-2：服务端问事确认与冻结绑定

日期：2026-10-14。此阶段为本地实施，未创建远端 PR、未提交整个脏工作区。保留了实施前已有的改动。

## 本阶段结果

聊天产生 `ready_for_confirmation` 候选，不再产生起卦请求。用户核对问题、人物、关系、背景、排除事项、三数字和时区，点击确认；服务端签发 `ConfirmedQuestionV1`。起卦只接受 `confirmation_id + request_id`，实际问题、数字和时区均读取服务端记录。

同一个确认 ID 只绑定一个 chart。确认、冻结与绑定写入私人 SQLite，使用 `BEGIN IMMEDIATE` 事务，异常回滚；并发重试返回同一个 chart。前端将 confirmation_id 同时作为固定 request_id，刷新或请求失败不会生成新的重试身份。

解释从服务端 `/frozen` 读取确认文本与背景，客户端旧 `question_context` 字段仅兼容接收且被忽略。Python 的 source-evidence/evidence 也忽略客户端重传背景。解释缓存升级为 `confirmed-fixed-use-v4`，包含 owner、chart ID/hash、confirmation ID、question hash，与旧缓存隔离；尚未接入 V4.1 Planner。

## 改动范围

- contracts：确认契约、待确认预览、服务端草稿、冻结问事响应、前端确认状态。
- `chat.ts` / `chat-gate.ts`：仅用户明确确认可起卦；三数字不跨消息拼凑、不截取四数字的前三个、不混入数字期限。
- `divination-llm.ts`：关系引用随实体 ID 映射；拒绝悬空或缺原文的关系；事实和人物背景不以模型推断冒充明示信息。
- `/api/divination/chat`：从私人运行库加载持久化会话，全历史参与本次提取；保存用户消息后先失效旧候选，再执行 D1；版本检查避免并发覆盖。
- 新增 `/api/divination/dialogue`、`/confirm`、`/frozen`：分别恢复草稿、确认当前候选、读取服务端原盘。
- `/api/divination/cast`、`/interpret`：确认引用起卦、权威背景读取、只读旧盘兼容。
- `divination-chatbot.tsx`：确认/修改按钮、确认后起卦、固定重试 ID、草稿恢复、已起卦后通过“开启新问题”进入另一个占事。
- Python endpoint/runtime：新增草稿与确认表、确认状态与属主检查、事务冻结、幂等指纹、旧写入口停用。
- `divination-signature.ts` / `confirmation_auth.py`：服务端候选写入和确认请求的签名桥接，防止浏览器直接伪造 D1 候选。
- `test-job-flow.mjs`：适配确认协议；新测试卦要求显式 `FORTUNE_CONFIRM_TEST=1`。本阶段没有运行真实模型的求职解读脚本。

## API 与数据迁移

1. 新 chat 请求发送最新用户消息、可选 conversation_id/draft_revision、message_id、timezone。历史从服务端读取，不能用客户端伪造的 assistant 历史覆盖。conversation_id 由服务器生成并绑定属主。
2. confirm 请求：`{conversation_id, revision, question_hash, confirmed:true}`。不能附带替换后的问题、数字或上下文；过期、版本不符、属主不符拒绝。
3. cast 请求：`{confirmation_id, request_id}`。旧 question/numbers/method/timezone 请求被拒绝，Python `/query` 返回 410，不能绕过确认。
4. frozen 返回原盘、原问题、确认契约、冻结 QuestionContext 与 `confirmation_status`。
5. question_hash 覆盖规范问题、待确认上下文、数字和时区；冻结幂等指纹另含确认身份和固定 method profile。修改任何确认内容需产生新候选、新确认。
6. 私人运行库增建 `question_dialogue` / `question_confirmation` 两表，不迁移古籍库、不重算旧 chart hash。旧记录标记 `legacy_unconfirmed`，原盘及浏览器已有结果可显示，不伪造确认来源或确认时间；旧记录不进入新的解释生成。
7. 候选与未冻结确认有效期为 24 小时。已冻结的同请求重试不受这一有效期影响。历史最多 128 条，达到上限要求新问题，不静默丢掉早期消息。

本地 Next 与 Python 共用项目根 `.runtime/divination-internal.key`，由 Next 首次可信写请求创建，权限 0600，目录 0700，已被 gitignore 排除。密钥不输出到前端、不记录进日志。分开部署时，两端需通过进程环境设置同一个至少 32 字符的 `DIVINATION_INTERNAL_SECRET`；不可使用 NEXT_PUBLIC 前缀。未配置或签名错误时服务端拒绝候选写入。

存储迁移为增建表，可通过回滚代码并保留新增表回退；不要删除原私人数据库或旧卦记录。回滚旧写入代码会重新开放旧准入风险，因此前后端必须配套切换，不能只回滚确认 UI。

## 验证

- `npm test`：161 passed，2 skipped（真实模型/服务用例未运行）。
- `npm run typecheck`：通过。
- `npm run build`：生产构建通过，确认/恢复/起卦相关路由编译成功。
- 本阶段 TypeScript、前端、路由和测试文件定向 ESLint：通过。
- Python 全套 `.venv/bin/python -m pytest`：516 passed，1 warning。
- Python 确认/冻结、旧混合检索、source retrieval 定向测试：31 passed。
- 4 个相关 Python 文件定向 Ruff：通过。
- `node --check scripts/test-job-flow.mjs`、`git diff --check`：通过。

覆盖：未确认拒绝 cast、候选签名不可伪造、确认原文 hash 检查、跨属主拒绝、编辑失效、超 16 条历史保留、过期拒绝、悬空关系拒绝、失败回滚、并发冻结、同确认重试、相同 request_id 改问题/数字/时区/确认 ID 拒绝、客户端背景覆写无效、旧缓存/旧盘恢复不自动起卦。

## 阶段边界

PR-2 不新增 Q1 预解析模型；仍使用 D1 + 单占事检查产生确认候选，PR-3 再接独立 Q1 的四态预检。Planner、两轮补检、结构化推理和 GraphRAG 尚未接入。

没有将单元测试的模拟 D1 输出当作真实模型跨领域稳定性的证明，也未完成真实浏览器点击与真实 LLM 的全链路验收。现有全项目 ESLint 的旧脚本 `build_stage5_final_review.cjs` 基线错误不属于本阶段修改；相关文件定向检查通过。

长期问事数据保留/清理政策尚未实施；24 小时只是确认准入有效期，不会自动删除私人记录。

## Gate

PR-2 工程与接口验收通过；确认之前无法经公开 cast/query 写入口创建卦盘，确认内容与 chart 服务端绑定。后续按 PR-3 实施 Q1/Taxonomy/F1/P1，本阶段不提前改造检索流程。
