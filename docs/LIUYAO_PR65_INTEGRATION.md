# PR6.5 冻结卦盘关系层集成

依据用户提供的 Downloads/README.md 实现。README 无附带 Python 包源码，因此采用现有 TypeScript 服务与事实目录契约实现；不修改 Python 起卦和装卦函数。

## 已接入

- fact-relations.ts：校验 core_version、完整性标志、爻位和 ref 唯一性、阴阳动静、干支字段一致性、地支五行、六亲基准、世应、同位变爻及伏神飞神引用。
- deriveCoreRelations：全部30条本卦有向爻对，加每个动爻与对应变爻的双向关系、每个飞伏对的双向关系。关系包含五行方向、同支、六冲、六合；ID绑定调用者提供的冻结 chart_hash 和引擎版本。
- 对已有飞伏关系和动变回头关系快照作一致性校验。函数不修改输入，不生成吉凶、应期、综合旺衰或伏神可用性。
- extractAnalysisFacts 将角色相关的关系选入现有 Fact Catalog，保留 relation_id；Planner 使用原有 fact_id 白名单，PR5/PR6 继续使用同一目录，方向描述由程序呈现。
- reviewed-career-self-pr65-v1：已校验问题必须为 career.new_job 或 career.promotion，且 subject_actor_id 明确指向 querent。官鬼为主、世为辅；多候选、仅伏神或缺失均返回未决。没有明确主体时不猜“本人”。
- 其他专题在确定性取用模块返回 unsupported，调用层保持原有 LLM + fixed-rules 校验流程。并未把未审定专题扩展为确定性规则。
- 引擎与取用规则版本进入现有 Planner checkpoint 版本身份，避免复用旧派生结果。

## 验证与限制

tests/fact-relations.test.ts 回放实际 2,4,5 冻结盘，确认 main:3 土 → main:5 金为 generates，反方向为 generated_by；覆盖稳定ID、输入不变、飞伏双向、篡改拒绝、多官鬼未决与主体缺失。

当前校验器检查契约内部一致性，不替代冻结盘的服务端 hash/签名验证，也不重新计算纳甲表、八宫表或历法。调用者仍须使用已验证的服务端冻结盘和已确认问题。

未新增公开端点、数据库迁移或独立关系缓存；复用现有具备冻结身份的 Planner checkpoint。未进行部署或声称通过生产权限、撤销、完整续跑与性能发布门禁。

PR6 transport 参数不一致已修复：requestPlannerJson 接受可选第四参数 timeoutMs。未传入时保持 min(LLM_TIMEOUT_MS, 30000)；PR6 可传入120000，超出上限、非整数或非正值拒绝。workflowFetch 继续合并节点/全局截止信号，初次请求和一次修正共享节点预算。

## 完整回归结果

- npm run check：307项前端测试通过，7项显式 opt-in 真实模型测试跳过；lint 零错误、4个既有警告；TypeScript 检查通过。
- fortune_module4/.venv/bin/python -m pytest --maxfail=0 -ra（在 fortune_module4 目录）：521项通过。
- ../fortune_module4/.venv/bin/python -m pytest -q -ra（在 python_algorithm 目录）：48项通过。
- tests/pr6-transport.test.ts：普通30秒、PR6 120秒、无效参数拒绝、共享节点截止信号中止请求均覆盖。
- tests/analysis-plan-route.test.ts 新增 PR6.5 全流程回归：真实245冻结盘、确定性本人取用、方向事实、Planner、双轮证据、推理、最终写作、重试checkpoint复用贯通；LLM和HTTP边界受控模拟。另有真实SQLite检索回放测试通过。
- ESLint 为 .cjs 显式允许 CommonJS require，保留其他规则。
- npm run build：生产构建成功，包含起卦、确认、Planner、解读等API路由。

上述结果确认本地集成链路；未运行付费真实模型端到端测试，不能据此声称生产模型质量或延迟已经验证。
