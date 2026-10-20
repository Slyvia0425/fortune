# 六爻网页接线与验证

> 合并请以 [2026-10-12 输入输出契约](LIUYAO_INTEGRATION_CONTRACT_V1.md) 为准。本文是2026-10-10历史记录；匿名会话、question_context、模型原文推理、候选输出和一次修正均已更新，不应直接按下文旧行为对接。

2026-10-10。本轮把网页接到 `liuyao-decoration-v1` 冻结卦盘和混合检索。没有修改起卦／装盘算法，没有自动发布知识库。

## 实际链路

1. 网页仍只提交三个数字与原问题，另带 request_id 和浏览器时区。
2. Next `/api/divination/cast` 转发到 Module 4 `/api/v1/liuyao/hybrid/cast`。Module 4 调用既有算法与装盘模块，保存用户所属的不可变卦盘。网页不再另调用独立 Python 算法接口重复起卦。
3. 网页解释请求仅提交 chart_id、chart_hash。Next `/api/divination/interpret` 从 `/api/v1/liuyao/hybrid/evidence` 读取服务端原问题和冻结盘；客户端不能替换原问题、盘面或审核状态。
4. 每次解释重新应用发布／撤销／方法等资格过滤并保存检索审计；不会因重新解释而重算起卦时间。
5. 《周易》卦爻辞继续按卦序和爻位精确取文；六爻规则使用混合证据包，两层解释分别呈现。
6. 六爻规则证据不足时不调用规则解释模型，直接展示缺口。证据充分时模型仅收到已适用证据、冻结 core 与已确认 selected_use；返回段落须通过引用集合、chart_hash、method_profile_id 检查。无效输出整体拒绝，保留依据。

引用／上下文检查不是对任意自然语言含义的全面验证，也没有宣称完成自由文本 Guardian 的事实语义校验。现有 Python `guardian.validate_claims` 仍是独立结构化声明检查器，本轮网页采用与输出格式对应的 TypeScript 引用及冻结上下文校验。

## 网页展示

- 六爻规则解释、缺失条件和必要补问。
- 可展开查看月建、日辰、旬空、六亲、世应、动静和伏神位置；不把伏神存在写成可用。
- 候选与最终选用分开显示；只有出现在 selected_use 的项显示为已选用。
- 规则与案例原文、来源版本和字符偏移；卦爻辞原文另列。
- 模型不可用时仍保留引用和卦盘。清理旧版展示缓存，新请求不会因失败而恢复上一卦的结果。

网页入口沿用已有账户 cookie，以当前账户访问冻结盘。未登录时提示登录，不回退到共享的默认用户卦盘。后端自身仍沿用项目原有身份依赖；生产部署需按既有账户配置关闭 legacy user header，不能将开发环境身份配置误当生产权限。

## 验证结果

- TypeScript：全量 54 项通过，其中本轮新增 6 项，覆盖服务端原问题／冻结盘使用、客户端盘面与哈希篡改、模型失败保留证据、引用验证、真实模型入口缺证时零调用。
- Python：`test_knowledge_hybrid.py` 与 `test_liuyao_core.py` 合计 428 项通过。新增 HTTP 集成测试验证同一 request_id 重试、相同 chart_hash、用户所有权隔离、拒绝额外 facts、只创建一个冻结记录。
- 实际本地 Module 4 HTTP 试查：完整六爻、`core_version=liuyao-decoration-v1`，起卦／返回盘／检索包哈希一致。当前生产证据为零，缺口为 NO_ELIGIBLE_EVIDENCE、UNRESOLVED_CONDITION；不再出现 CHART_FACTS_INCOMPLETE。使用单独开发测试身份与示例问事，未改动真实知识库资格。
- TypeScript 类型检查、目标 ESLint、目标 Ruff、diff 格式检查通过。
- `next build --webpack` 成功。默认 Turbopack 在本机 PostCSS 子进程端口绑定时收到 Operation not permitted；未绕过权限，使用 Next 官方支持的 Webpack 构建。
- 浏览器检查新版匿名入口；未使用用户账号凭据执行登录后的真实模型占问。已登录数据链路通过上述 HTTP 集成与 Next 路由测试验证。

## 本地运行

本次启动 Module 4 在 `127.0.0.1:8001`，重建并重启网页在 `localhost:3000`，网页配置 `MODULE4_API_BASE_URL=http://127.0.0.1:8001`。独立算法服务原有 8000 端口未停止；本轮网页起卦不再依赖它。`.env.example` 的 Module 4 示例端口同步为 8001，避免与独立算法服务混淆。

重新启动开发环境可使用仓库已有的 `npm run dev`；生产模式本地复现：

```bash
# fortune_module4 目录
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8001

# 仓库根目录，另一个终端
npm run build -- --webpack
MODULE4_API_BASE_URL=http://127.0.0.1:8001 npm start -- -p 3000
```

网页接线已完成。当前需要继续完成的是规则可执行编码与生产发布，不能将其与“core 未装盘”或“网页未接线”混为一谈。本轮不改变该发布门槛。
