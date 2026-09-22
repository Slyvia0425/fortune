# 知命 Fortune Teller Master

面向传统中国术数知识学习的可解释系统。项目将确定性计算、传统资料检索和现代语言解释分层处理，包含八字排盘、易卦推演、观音灵签、典籍检索与个人知识库五个前端模块。

> 本项目用于传统文化学习、知识探索和课程演示，不构成医疗、法律、投资或其他重要现实决策建议。

## 当前状态

- 观音百签：完整结构化签库与服务端安全随机抽签。
- 知识检索：已接入 764 条结构化知识页面。
- 八字排盘：前端和 API 契约完成；未配置 Python 服务时返回明确标记的 Mock 数据。
- 易卦推演：前端和 API 契约完成；未配置 Python 服务时返回明确标记的 Mock 数据。
- 知识图谱：接口与展示骨架完成，实体关系数据待入库。
- 会话和笔记：接口完成，目前使用进程内存，服务重启后清空。

## 环境要求

- Node.js 20 或更高版本
- npm 10 或更高版本
- 可选：Python 算法服务

## 本地启动

```bash
git clone <repository-url>
cd fortune-system
npm install
npm run dev:all
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。`dev:all` 会同时启动组合算法服务、
Module 4 后端和前端，并把持久数据写入 Codex 数据目录。

默认端口和地址：

```env
PYTHON_ALGORITHM_BASE_URL=http://127.0.0.1:8000
MODULE4_API_BASE_URL=http://127.0.0.1:8003
```

`PYTHON_BAZI_BASE_URL` 和 `PYTHON_DIVINATION_BASE_URL` 仍可作为可选覆盖项，
用于把八字与易卦拆成独立进程部署。

数据目录默认是 `~/Documents/Codex/fortune-data`，可通过 `FORTUNE_DATA_DIR` 修改；
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
npm run dev        # 启动开发服务器
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
  session/          临时会话与笔记存储
data/               结构化知识数据及来源材料
sticks/             观音百签数据
docs/               集成与协作文档
tests/              自动化测试
```

算法组通常只需对照 `lib/contracts` 实现 Python 返回结构。Next.js 会通过 `lib/server/python-client.ts` 调用 Python，不需要修改 React 页面。

## API

| Method | Route | 状态 |
| --- | --- | --- |
| POST | `/api/bazi/chart` | 契约完成，等待 Python 算法 |
| POST | `/api/divination/cast` | 契约完成，等待 Python 算法 |
| POST | `/api/divination/chat` | 可用；追问必要信息并调度起卦或抽签 |
| POST | `/api/guanyin-lot/draw` | 可用 |
| GET | `/api/knowledge/search?q=` | 可用 |
| GET | `/api/knowledge/graph?concept=` | Mock 图谱 |
| GET | `/api/knowledge/compare?q=` | 可用 |
| POST | `/api/session/event` | 临时内存存储 |
| POST | `/api/user/notes` | 临时内存存储 |

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
