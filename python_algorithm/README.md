# 八字与六爻组合确定性算法服务

安装后启动：

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app:app --reload --port 8000
```

然后在项目根目录 `.env.local` 设置：

```env
PYTHON_ALGORITHM_BASE_URL=http://127.0.0.1:8000
```

根仓库的 `npm run dev:all` 会自动使用这个端口和变量。

算法规则：六爻数组均为初爻到上爻；数字法的第一、二个数字分别决定上、下卦，按模八映射，第三数字（若有）决定动爻，否则用前两个数字之和决定动爻。互卦取本卦第 2–4 爻为下互卦、第 3–5 爻为上互卦。动爻翻转阴阳得到变卦。

# 八字确定性算法服务（`bazi/`）

与六爻共用后端服务端口，启动方式同上，无需另行配置。接口为 `POST /bazi/chart`，请求与返回结构见 `lib/contracts/bazi.ts` 与 `docs/API_INTEGRATION.md`。

测试：

```bash
.venv/bin/pytest -q
```

当前状态：`python_algorithm/bazi/engine/` 已接入确定性排盘引擎，支持公历与农历转换、真太阳时校正、四柱、五行十神、大运流年与带依据的方向建议。未配置该服务时，Next.js 会返回带 `meta.mock: true` 标记的兼容结果。

约定：返回中的天干、地支、十神等均为罗马化键名（如 `jia`、`zi`、`direct_wealth`），中文显示名由前端 `lib/bazi/display.ts` 映射，其中 `wu` 为天干「戊」、`wu_branch` 为地支「午」。`bazi/models/` 中的枚举须与 `lib/contracts/bazi.ts` 保持一致，由 `bazi/tests/test_contract_consistency.py` 校验。大运、流年仅作展示，不含吉凶判断；建议中的契合度表示与命局结构的契合程度，不表示概率。
