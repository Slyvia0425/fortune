# 知命 Fortune Teller Master

面向传统中国术数知识学习的可解释系统。项目将确定性计算、传统资料检索和现代语言解释分层处理，包含八字排盘、易卦推演、观音灵签、典籍检索与个人知识库五个前端模块。

> 本项目用于传统文化学习、知识探索和课程演示，不构成医疗、法律、投资或其他重要现实决策建议。

## 当前状态

当前分支已合并 `upstream/main` 的 `4e47900`，包含 Module 2 问卦历史、卦象解释面板和 Module 3 知识中心更新。

- 统一账户：注册、登录、退出和用户隔离可用。
- Module 4 会话历史：完整对话和结构化术数事件持久化保存，支持会话列表、消息时间线、来源和最近预览。
- Module 2 接入：用户消息、助手回复、起卦完成事件和最终解释可以写入 Module 4；普通聊天不会进入推荐或相似案例推理。
- 个人知识库：收藏、笔记、标签、人物档案、隐私设置、导出和删除接口可用。
- 知识检索：已接入 764 条结构化知识页面，支持本地详情页、原文与注释对照、来源追踪和解释面板。
- 知识图谱：概念节点、关系、规范化和对比展示可用；完整实体关系数据库仍可继续扩展。
- 易卦推演：确定性起卦、本卦、动爻、互卦、变卦、Evidence Pack 和现代中文解释流程可用；未配置 Python 服务时返回明确标记的 Mock 数据。
- 八字排盘：主分支前端和 API 契约可用；未配置 Python 服务时返回明确标记的 Mock 数据。`upstream/M1_branch` 中存在新的历法、排盘和规则实现，但尚未合并到主分支。
- 观音百签：完整结构化签库与服务端安全随机抽签可用。
- 当前验证：前端 57 项测试通过，Module 4 后端 36 项测试通过，TypeScript 和生产构建通过。

## 分支状态

- `upstream/main`：最新为 `4e47900`，已合并。
- `upstream/M3_branch`：最新为 `079c75a`，已进入主分支。
- `upstream/feat/module2a-divination-chatbot`：最新为 `ca83f34`，已进入主分支，主分支另有 `f7fdc56` 历史集成更新。
- `upstream/M1_branch`：最新为 `d12f08c`，包含大量八字历法、规则和验证数据，但尚未进入主分支，需要单独联调后再合并。
- 当前 Module 4 分支：`feat/module4-personal-agent-clean`，最新合并提交为 `9bc5698`。

## 环境要求

- Node.js 20 或更高版本
- npm 10 或更高版本
- 可选：Python 算法服务

## 本地启动

仅启动前端与 Module 4 后端：

```bash
git clone <repository-url>
cd fortune-system
npm install
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。该命令会同时启动 Next.js（3000）和 Module 4 服务（8001），并按 `Ctrl+C` 一起关闭。

启动完整本地开发环境：

```bash
npm run dev:all
```

`dev:all` 默认启动前端 3000、Python 算法服务 8000、Module 4 服务 8003，并把持久数据写入 `~/Documents/Codex/fortune-data`。可通过 `FORTUNE_DATA_DIR` 修改数据目录。

单独调试前端或 Module 4：

```bash
npm run dev:web
npm run dev:module4
```

默认端口和地址如下。Python 算法服务尚未启动时可以保持对应变量为空，系统会使用带有 Mock 标记的兼容结果：

```env
PYTHON_ALGORITHM_BASE_URL=http://127.0.0.1:8000
MODULE4_API_BASE_URL=http://127.0.0.1:8003
```

`PYTHON_BAZI_BASE_URL` 和 `PYTHON_DIVINATION_BASE_URL` 仍可作为可选覆盖项，
用于把八字与易卦拆成独立进程部署。

Python 运行环境放在项目自己的 `.runtime/` 目录。初次运行会创建隔离环境，因此第一次启动会比后续慢。

如需单独启动组合算法服务：

```bash
cd python_algorithm
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app:app --reload --port 8000
```

具体请求和返回结构见 [Python 算法接入说明](docs/API_INTEGRATION.md)。

## 常用命令

```bash
npm run dev        # 启动前端和 Module 4
npm run dev:all    # 启动前端、Python 算法和 Module 4
npm run dev:web    # 仅启动前端
npm run dev:module4 # 仅启动 Module 4
npm test           # 运行测试
npm run lint       # 运行 ESLint
npm run typecheck  # 运行 TypeScript 检查
npm run check      # 依次执行测试、Lint 和类型检查
npm run verify:stack # 对已启动的整套服务做 HTTP 契约验收
npm run verify     # 执行 check 和生产构建
npm run build      # 生产构建
npm start          # 启动生产构建
```

## 项目结构

```text
app/
  api/              Next.js 对外 API 与输入校验
  bazi/             八字页面
  divination/       易卦页面
  guanyin/          观音灵签页面
  knowledge/        典籍检索页面
  library/          个人知识库页面
lib/
  contracts/        前后端共享 TypeScript 契约
  server/           Python 服务适配器
  bazi/             八字服务入口
  divination/       起卦服务入口
  guanyin/          灵签数据校验和查询
  knowledge/        知识库检索
  module4/          Module 4 API 客户端、会话同步和类型
fortune_module4/    持久化个人服务后端、数据库迁移和测试
python_algorithm/   八字与易卦算法服务入口
data/               结构化知识数据及来源材料
sticks/             观音百签数据
docs/               集成与协作文档
tests/              自动化测试
```

算法组通常只需对照 `lib/contracts` 实现 Python 返回结构。Next.js 会通过 `lib/server/python-client.ts` 调用 Python，不需要修改 React 页面。

## API

| Method | Route | 状态 |
| --- | --- | --- |
| POST | `/api/bazi/chart` | 可用；未配置 Python 时返回 Mock，M1 新算法尚未并入主分支 |
| POST | `/api/divination/cast` | 可用；配置 Python 后执行确定性起卦 |
| POST | `/api/divination/chat` | 可用；识别问题、时间和数字并调度起卦 |
| POST | `/api/divination/interpret` | 可用；生成 Evidence Pack 和受证据约束的现代解释 |
| POST | `/api/guanyin-lot/draw` | 可用 |
| GET | `/api/knowledge/search?q=` | 可用 |
| GET | `/api/knowledge/graph?concept=` | 可用；当前为整理后的概念关系，数据库扩展待续 |
| GET | `/api/knowledge/compare?q=` | 可用 |
| GET | `/api/knowledge/explain?q=` | 可用；返回概念解释、证据状态和来源 |
| POST | `/api/session/event` | 持久化兼容接口；登录后写入 Module 4 |
| GET | `/api/module4/api/v1/sessions` | 可用；读取当前用户会话历史列表 |
| GET | `/api/module4/api/v1/sessions/{id}/events` | 可用；读取完整消息和结构化事件时间线 |
| POST | `/api/module4/api/v1/feedback` | 可用；反馈记录并生成独立反馈事件 |
| POST | `/api/user/notes` | 持久化兼容接口；登录后写入 Module 4 笔记 API |

所有浏览器端接口均返回 `lib/contracts/api.ts` 中定义的统一响应结构。

## 数据说明

主知识文件位于 `data/knowledge_sources_complete/knowledge_sources_pages.json`。原始网页和 PDF 用于来源复核，具体来源范围、版权处理和字段说明见 [数据说明](data/knowledge_sources_complete/README.md)。

根目录的原始 ZIP 包不会进入 Git；可复现项目所需的解压数据已经位于 `data/`。

## 协作约定

1. 从 `main` 拉取最新代码并创建功能分支。
2. 不提交 `.env.local`、密钥、`node_modules` 或 `.next`。
3. 修改接口结构时同步更新 `lib/contracts` 和 `docs/API_INTEGRATION.md`。
4. 提交前运行 `npm run check` 和 `npm run build`。
5. Mock 数据必须设置 `meta.mock: true` 并返回清晰 warning。
6. 会话消息只用于完整历史存档；推荐和相似案例只能读取 Module 4 的正式推理白名单事件。
7. 合并其他成员分支前先检查 `Module 4`、`lib/contracts` 和数据库迁移的兼容性。
