> 2026-10-12 integrated-v3：模型使用短引用别名，接口仍返回原始引用 ID。综合解释增加规则／案例覆盖检查及独立 LLM 证据复核，最多一次修正并复核；不通过时 `modern_interpretation` 仍为 null，不发布草稿。复核为模型判断，不代表规则引擎已证明正确。

> 2026-10-12 行为更新：解释链路改为「候选用神分析 → 综合解释」。`modern_interpretation.overall_interpretation` 保持字段名，但内容现融合 core、允许使用的检索规则／案例、通过校验的候选分析与卦爻辞。`contextual_reflections.evidence_ids` 也可引用本次检索材料的 `entity_revision_id`。前端仅呈现综合解释；详见 `LIUYAO_INTEGRATION_CHANGELOG.md` 的 integrated-v1 记录。

# 六爻系统前后端输入输出与合并契约 v1

记录日期：2026-10-12。这是当前实现的集成基线，不表示回答质量已经验收。本轮只记录接口，保留已有行为；后续回答优化不得悄悄改变这些接口。代码类型以 `lib/contracts/divination.ts`、`lib/contracts/api.ts` 为准，Python内部请求以 `fortune_module4/app/api/v1/endpoints/liuyao_hybrid.py` 为准。

## 1. 系统边界与调用顺序

| 层 | 职责 | 不应承担的职责 |
| --- | --- | --- |
| 浏览器 `/divination` | 收集对话、三个数字、浏览器时区；保存本轮chart_id；显示结果 | 不计算纳甲/历法，不自行构造core事实 |
| Next.js API | 问题理解LLM、转发起卦/检索、古文转述与候选分析LLM、Guardian | 不重新计算服务端冻结盘 |
| Python Module4 | 起卦算法、历法与六爻字段、冻结盘持久化、权限校验、规则/案例混合检索 | 不信任客户端上传的盘面 |
| 知识库 | 已发布规则与案例、原文来源、向量及版本 | 不接收本轮教学题作为生产知识 |

```text
POST /api/divination/chat（多轮，返回clarify或ready）
  → 有cast_request且本轮尚无卦盘：POST /api/divination/cast
  → ready且已有chart_id：POST /api/divination/interpret
      → Python /evidence：读取归属当前会话的冻结盘并检索
      → 古文转述 + 六爻候选分析（最多一次修正）
      → 返回卦盘、证据和解释状态
```

**实际时序**：clarify也可能带cast_request；现前端会先冻结盘，再继续追问。LLM明确要求追问的某些分支不带cast_request，因此尚不起卦。不得把clarify等同于“未起卦”。同一页面本轮已经有盘时，不因后续补充信息自动重新起卦。解释只在ready后触发。

## 2. 浏览器公共API包装

三条接口均返回 `ApiEnvelope<T>`：

```json
{
  "result": {},
  "system": "divination-cast-v3",
  "source_refs": [],
  "session_id": null,
  "warnings": [],
  "error": null,
  "meta": {"mock": false, "version": "1.0.0", "generated_at": "ISO时间"}
}
```

成功时读取result；失败时result为null、error含code/message及可选details。meta.version是公共包装版本，**不是core、Prompt或知识库版本**。source_refs为来源对象数组。前端先检查HTTP状态与result，再检查业务状态，不能将HTTP 200等同于解释生成成功。

## 3. POST /api/divination/chat

输入：

```json
{"messages":[{"role":"user","content":"我是妻子，问丈夫此次出行是否平安，数字18、27、9"}]}
```

messages必须是数组；role为user/assistant；当前实现仅处理最后16条，每条content裁剪到500字符、去空白，无效条目忽略。没有有效消息返回400。调用方应保留用户补充和助手追问，不只发最后一句。

输出result为 `DivinationChatReply`：

| 字段 | 类型/含义 |
| --- | --- |
| status | clarify / ready |
| message | 展示给用户的追问或确认文本 |
| suggestions | string[]，可空 |
| cast_request | 可选；question、method=three_numbers、numbers=[n1,n2,n3] |
| extraction | 可选；source=llm/rules/unavailable，question/time_range/method/numbers/fallback_reason |
| question_context | 可选；下面的结构化问题理解，不是core盘面 |

`QuestionContext`字段：raw_question；initiator、number_provider、perspective_person；target_entities、relationships；topic_candidates；goal、question_kind、process_stage、time_expression；known_facts；assumptions、exclusions、ambiguities、goal_groups；parser_status=parsed/unavailable/invalid。

其中QuestionField为 `{value, provenance, verification_status, evidence?}`：value可为null；provenance为user_explicit/conversation_explicit/model_inference/unknown；verification_status为confirmed/extracted/unknown。evidence含text、start_offset、end_offset_exclusive及可选message_id。target_entities含entity_id/label/kind/provenance/evidence；relationships含from_entity_id/to_entity_id/relation/provenance/evidence。

question_kind公开类型为feasibility/timing/status/choice/reason；前置LLM内部模板与解析细节不作为对接方协议。应原样传递服务端返回的question_context，不自行拼装或把模型推断当成用户确认。

## 4. POST /api/divination/cast

输入：

```json
{
  "question":"我是妻子，问丈夫此次出行是否平安",
  "method":"three_numbers",
  "numbers":[18,27,9],
  "request_id":"9bb61c5b-5747-4a53-996c-f4335b6d6456",
  "timezone":"Asia/Hong_Kong"
}
```

- question必填，非空字符串，最多500字符。
- method必填，只支持three_numbers。
- numbers必填，严格3个正安全整数，范围1至9007199254740991，保持顺序，不能发数字字符串。对话数字提取目前仅识别1至6位数字；直接API与对话提取范围不同。
- request_id建议由调用方生成UUID并保留，网络重试使用同一值；省略时Next生成。不要每次重试生成新ID。
- timezone为IANA时区；缺省Asia/Shanghai。时间由后端冻结，客户端不传cast_at。
- 类型中的conversation_id当前不转发、不用于会话归属。未知字段不应发送；Next当前起卦入口未严格拒绝全部多余字段，Python请求模型拒绝多余字段。

输出 `DivinationCastResult`：chart_id、chart_hash；primary/transformed/mutual/opposite/reversed；moving_lines；core_facts；core_receipt；traditional_meaning、contextual_interpretation（算法/兼容展示文本，不是候选LLM正式结果）。兼容旧盘时部分装盘字段可缺失，调用方不能伪造补齐。

每个HexagramView含number/name/upper_trigram/lower_trigram/lines。lines从初爻到上爻，6老阴、7少阳、8少阴、9老阳。moving_lines为1至6的爻位。

core_receipt含request_id/cast_id/raw_numbers/validated_numbers/raw_question/submitted_at/cast_at/timezone/timezone_source，以及casting_algorithm_id/version、calendar_policy_id、core_version、method_profile_id/version、question_parser_version。现实现submitted_at等于cast_at，timezone_source固定写client（即使使用默认值）；不要据此认定真实客户端提交时间或显式时区选择。

### core_facts

| 字段 | 内容 |
| --- | --- |
| core_version | 六爻装配版本 |
| calendar | 日月干支、地支、旬首旬空、历法/展示时区和时间、历法政策 |
| palace | trigram、element、stage、self_position、response_position |
| main_lines / transformed_lines / hidden_lines | 本卦、变卦、伏神记录数组 |
| *_lines_complete | 各组盘面是否完整，布尔值 |
| moving_line_interactions | 后端额外输出的动爻交互关系 |
| capability_gaps / interpretation_limits | 缺失能力及解释限制 |

每爻：ref、position、yin_yang_value、yin_yang、age、moving、stem、branch、ganzhi、element、kin、kin_name、kin_basis、position_role、six_spirit、strength。ref形如main:1/hidden:2/transformed:1；kin为parents/siblings/offspring/wealth/officials；position_role为self/response/null。

strength含policy_id、month_seasonal_label、month_relation、day_relation、month_break、day_clash、xun_empty、month_life_stage、day_life_stage、overall_strength、overall_strength_status。综合旺衰为null时代表仍需结合规则判断，不代表弱。关系字段包含element_relation/same_branch/clash/combine。

本卦爻可能另含transformation（line_ref、return_relation、life_stage_at_changed_branch）；伏神可能含flying_line_ref、usable=null、usability_status。上述部分后端扩展字段尚未全量声明在TS接口中，应保留传输，不自行推断缺失值。变卦六爻不等于六条实际动爻变出。

## 5. POST /api/divination/interpret

输入：

```json
{"chart_id":"服务端返回的UUID","chart_hash":"服务端返回的哈希","question_context":{}}
```

上例question_context是位置示意，实际应传chat返回的完整对象，也可省略。只允许chart_id/chart_hash/question_context三个键；chart_id必填UUID；chart_hash可选但建议回传用于一致性检查。不得传numbers、question、core_facts、知识库版本或review开关。该入口不重新起卦。

输出result为 `DivinationInterpretationResult`：

| 字段 | 含义 |
| --- | --- |
| frozen_core | 原服务端冻结盘的core事实 |
| evidence_pack | 周易卦爻辞证据包，独立于六爻取用规则 |
| modern_interpretation | 周易文本转述，可为null |
| model_used | 可选，古文转述模型；不是两个LLM的完整追踪记录 |
| hybrid_evidence | 六爻规则与案例检索证据包 |
| hybrid_interpretation | 六爻候选LLM分析与Guardian结果 |

古文转述与候选分析可各自成功或失败。不能因modern_interpretation为null隐藏已成功的候选分析，反之亦然。

### hybrid_interpretation

- status：generated / insufficient / unavailable。
- readings：`[{text,evidence_ids}]`；生成失败时为空。
- analysis：仅成功时存在，含question_understanding、candidates、selection、uncertainties。
- validation：references_and_core_facts / references_and_frozen_context / not_generated。表示校验范围，不表示古籍语义已被证明。
- message：面向用户的状态说明。
- attempts：可选，逐次 `{attempt:1或2,status:accepted/rejected/request_error,raw_output:string或null,errors:[{code,path,message}]}`。
- validation_errors：可选，最终失败原因；修正请求失败时也可含前次错误。

候选含candidate_id/role/origin/line_refs/evidence_ids/reason/conditions/known_facts/missing_conditions/exceptions。origin为main/hidden/moving_transformation。known_facts由程序按条件引用生成，不是LLM输出字段。conditions含condition/status(met/not_met/unknown)/fact_refs/evidence_ids。

selection含candidate_id/line_ref/evidence_ids/reason；未选定时两个ID均为null，**generated仍可表示“成功分析，但不足以选定”**。question_understanding.missing_information非空时不能选定。

最多一次修正，两次均完整校验。不把被拒绝的raw_output当成正式解读。attempts随API返回；目前没有新增数据库持久化审计表。生产日志不要直接记录含个人问事内容的完整响应。

### hybrid_evidence

主要字段：chart_id/chart_hash/core_version/method_profile_id、knowledge_release_id、retrieval_run_id、status、facts、query_plan、retrieval_trace、reasoning_mode、reasoning_evidence、supporting_evidence、pending_conditions、counter_evidence、candidate_roles、selected_use、gaps、clarification、interpretation_contract。embedding_profile_id、method_profile_version、tokenizer_version、case_support_available等是后端扩展元信息。

reasoning_evidence单元含entity_id/entity_revision_id/kind/usage/summary/source_quotes/condition_evaluation/conflict_group_ids/not_for_interpretation。规则还带rule_type/rule_contract/condition_details；案例带case_context（资料完整性、case_group_id、remaining_issues等）。source_quotes含source_revision_id/quote/quote_hash/start/end/url及可能的passage_id/offset_unit。排名信息channel_ranks/rrf_score不是规则适用结论。

模型引用entity_revision_id，不是source_revision_id。候选/条件/选用只引用规则；案例usage=analogy_only只可在readings解释中引用。送LLM时服务端将reasoning_evidence拆成rule_evidence和case_evidence；浏览器证据包仍使用reasoning_evidence。

36条规则尚非全量可执行规则，因此candidate_roles/selected_use可能为空，status可能为evidence_insufficient，但model_reasoning_allowed=true且有允许使用的规则时仍可生成文字分析。界面以hybrid_interpretation.status判断实际分析结果，不以selected_use是否为空判断模型失败。

## 6. Python内部API：不要与浏览器接口混用

| 路由（均POST） | 输入 | result |
| --- | --- | --- |
| /api/v1/liuyao/hybrid/cast | question,numbers,request_id?,timezone?；不带method | DivinationCastResult |
| /api/v1/liuyao/hybrid/evidence | chart_id,question_context? | {cast,question,hybrid_evidence} |
| /api/v1/liuyao/hybrid/query | question,numbers,request_id? | 旧规则引擎检索结果，不是当前网页主链路 |

Python成功包装含result/source_refs/system/session_id/warnings/error，没有Next的meta；source_refs为字符串数组。验证错误可能使用FastAPI的detail结构。Next适配层负责转成公共API错误，不让浏览器依赖Python错误正文。

浏览器同源请求由Next获取登录token，或设置httpOnly匿名cookie `fortune_divination_session`；Python接收Bearer token或X-Anonymous-Session。归属校验在读取冻结盘时执行。保留cookie才能继续读取匿名盘；chart_id不是跨用户访问凭据。

## 7. 幂等、失败和空值

- request_id用于owner范围的起卦幂等。同ID同数字返回原冻结盘；不同数字或时区被拒绝。当前实现允许同ID下问题文本变化，但不会覆盖原冻结问题，补充语境通过question_context传入。
- 保留chart_id/chart_hash；补问、重试解释不调用cast。新问题需要新起卦时应显式启动新一轮，不复用旧盘冒充新盘。
- chat：无效输入400；cast：无效输入422；interpret：无效字段422、hash不一致409；服务故障通常502，后端知识快照缺失503，盘不存在/不属于当前会话404。
- 顶层error非空表示API失败；HTTP200但hybrid_interpretation.status=unavailable表示证据已返回、解释未生成。前端展示message及原文，不自动重新起卦。
- null表示未知；空数组表示当前无条目；可选字段缺失表示兼容/未提供。三者不可互换。
- callHybrid超时90秒；候选LLM每次默认60秒、上限90秒，最多两次。部署网关不能按一次短请求的时限截断整个解释链路。

## 8. 合并与部署交接

Next环境变量：MODULE4_API_BASE_URL（推荐，仅服务端）、LLM_BASE_URL、LLM_API_KEY、LLM_MODEL、LLM_TIMEOUT_MS、LLM_DISABLE_THINKING。Python向量配置见app/core/config.py及.env.example，包括EMBEDDING_PROVIDER、OPENAI_EMBEDDING_MODEL/BASE_URL/API_KEY等。密钥只放各自环境，不能提交.env或放入NEXT_PUBLIC变量。

当前必需知识快照目录：`data/liuyao_knowledge/stage9-text-reasoning-v2`，包含knowledge.sqlite3、probe_baseline.json、发布与向量相关文件；不要只合并代码或报告而遗漏数据。向量provider必须通过快照探针匹配，否则降级关键词/结构化检索并记录SEMANTIC_PROVIDER_UNAVAILABLE。

运行时盘和检索记录：`fortune_module4/.runtime/liuyao-hybrid.sqlite3`，应独立持久化，不提交用户运行数据。已有项目的Module4配置与依赖安装按其README；两端分别启动。此文不变更项目部署方式。

建议合并顺序：契约类型与校验器 → Python core/冻结盘/快照/检索 → Next服务适配与API → UI → 测试和文档。具体提交前审核git diff，当前工作区有其他任务已有修改，不应未经检查直接git add全部。

离线验证：`npx vitest run tests/model-use-analysis.test.ts tests/liuyao-hybrid-client.test.ts tests/divination-web-hybrid.test.ts` 和 `npx tsc --noEmit`。真实模型测评为显式启用的tests/liuyao-e2e.live.test.ts，会使用付费服务，不放普通CI默认流程。

## 9. 后续迭代边界与已知限制

本轮暂不优化：规则漏召回、专题规则泛化、前置对话效果、语义正确率。已有12题仅覆盖固定问题上下文与盘面后的链路，不是全前后端验收。

兼容迭代可更换Prompt、模型、排序和知识版本，但保持公共字段名、枚举、null语义、origin及ID规则。新增可选字段需更新TS类型、本文和契约测试；删除/改名/改变含义需新版本和迁移说明。不要复用meta.version冒充业务版本。

当前需明确保留的限制：QuestionContext和内部检索facts.question是不同结构；客户端返回的question_context用于检索上下文，不等于已验证的用户事实；TS尚未完整表达所有Python扩展字段；收据部分时间/来源字段为近似记录；前端新请求自动生成UUID，网络失败后的UI幂等重试尚非完整实现；尝试记录尚无独立生产审计表。

本轮没有执行git commit/push，没有声称已完成仓库级全量合并或部署验收。
