> 最新行为（integrated-v6-source-only）：用户明确取消语义审核。新流程仅检查格式与来源引用，不再执行 semantic_review、review_format 或规则／案例适用状态覆盖门槛。下方保留旧错误码用于历史记录。新增 `citations / RETRIEVED_EVIDENCE_NOT_CITED` 表示提供了检索材料但回答未引用任何一条。候选节点原有事实校验保持不变。

# 综合解释失败诊断

2026-10-12，缓存版本 `integrated-v5-diagnostics`。不改变起卦、取用或语义审核标准，本次只区分失败并记录原因。

| 阶段 | 错误码 | 含义 |
| --- | --- | --- |
| generation / semantic_review | MODEL_TIMEOUT | 当前模型调用超时 |
| generation / semantic_review | MODEL_HTTP_ERROR | 模型 HTTP 请求失败，记录状态码 |
| generation | MODEL_EMPTY_RESPONSE | 没有返回文本 content |
| format | SYNTHESIS_JSON_INVALID | 综合输出不是合法 JSON |
| format | SYNTHESIS_OUTPUT_SCHEMA_INVALID | 必需字段为空或类型不正确 |
| citations | SYNTHESIS_CITATION_INVALID | 引用未知 ID、无引用数组或空引用 |
| coverage | SYNTHESIS_REVIEW_COVERAGE_INVALID | 规则／案例审核漏项、重复、字段空缺，或排除状态与引用不一致 |
| coverage | SYNTHESIS_TEXT_COVERAGE_INVALID | 卦爻辞转述未覆盖所需 ID |
| review_format | SEMANTIC_REVIEW_FORMAT_INVALID | 复核模型未按 approved/issues 返回 |
| semantic_review | SEMANTIC_REVIEW_REJECTED | 复核模型明确提出证据不支持等问题；保留原始意见 |
| 当前调用阶段 | MODEL_REQUEST_OR_RESPONSE_ERROR | 其他传输／响应解析错误，不伪称引用问题 |

## 返回与保存

解释响应新增可选字段，不删除原 API 字段：

- `diagnostic_run_id`：成功或失败的诊断编号。
- `interpretation_diagnostic`：失败时含 `run_id/stage/code/reasons/log_saved`。
- `warnings`：面向用户的具体阶段、错误码、至多三条原因和诊断编号。

后台按唯一编号保存 `.runtime/interpretation-diagnostics/<run_id>.json`，目录权限 0700，文件权限 0600。包含 chart_id、调用阶段、请求 JSON、模型原始响应、首次失败和修正失败及最终诊断。不保存认证头、API key、会话 cookie。内容包含用户问题，属于本地私有运行日志，不应提交 Git。

同一生成流程最多修正一次。失败原因不覆盖首次失败记录；手动重试生成新诊断编号。响应缓存保留诊断信息，升级缓存版本使旧的笼统提示不再作为当前结果复用。

`semantic_review` 失败是模型复核意见，不是代码证明取用错误。当前流程先复核语义，再执行结构／引用检查，报告的是首先阻止发布的步骤；被前一阶段阻止时，不能声称后续阶段已经通过。

日志写入失败时，响应保留原因且 `log_saved=false`，不会宣称日志已保存。前端仍保留原卦盘，重试解释不重新起卦。
