# 六爻 Core 与独立排盘引擎交叉验证方案

状态：已执行可重复差分测试，最新结果见第 8 节。  
目标：验证 `liuyao-decoration-v1` 已声明的确定性盘面事实；不评估占断、应期或“是否应验”。

## 1. 范围与边界

### 比较对象

| 对象 | 角色 |
| --- | --- |
| 本项目 `python_algorithm/hexagram_engine.py` + `python_algorithm/liuyao_core.py` | 被测 core；先将固定六爻状态与时刻装盘 |
| [`yaomancy/liuyao-engine`](https://github.com/yaomancy/liuyao-engine) | 独立参考实现；版本必须固定到 commit SHA |
| 《增删卜易》纳甲图及本项目已引用底本 | 分歧裁决的原始依据；不是把参考实现当作唯一真值 |

本项目保留自身的三数字起卦规则（上/下卦模八、第三数模六）。交叉测试的共同输入从六个爻开始，而非从三数字或三枚铜钱开始：

```text
fixture: lines[初爻 → 上爻] + ISO 8601 instant + IANA timezone
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
       fortune core           reference adapter
              │                     │
              └──── canonical facts ┴─── compare → diff report
```

因此，本测试不要求参考项目实现三数字起卦，也不测试随机性、问事文本、知识检索、LLM、用神选择或断语。

### 第一阶段纳入字段

1. 本卦、变卦、卦宫/八宫阶段、世爻、应爻；
2. 每一爻的位置、阴阳、动静、纳甲干支、五行、六亲、六神；
3. 日干支、月支、旬空；
4. 伏神的缺失六亲类别、位置、纳甲干支及飞伏关系。

以下字段先记录、默认不作为失败条件：节气交接、日界、旺相休囚死、十二长生、月破/日冲、暗动、墓库、化进退、伏神是否“可用”。它们依赖历法或流派口径，须通过对齐后再逐项升级为强断言。

## 2. 前置对齐（未完成不得跑正式差分）

建立 `tests/fixtures/liuyao-cross-engine/compatibility.md`，逐条记录双方版本、证据链接和结论：

| 主题 | 本项目固定口径 | 必须确认的参考实现口径 | 处理方式 |
| --- | --- | --- | --- |
| 爻序 | 初爻到上爻 | 输入/输出是否同序 | 不同则只在 adapter 显式翻转一次 |
| 爻值 | `6,7,8,9`，老阴/少阳/少阴/老阳 | bit 与 moving 的编码 | 转为共同 `yin_yang + moving` |
| 时区/日界 | 上海时区、00:00 换日 | 时区、子初换日与 datetime 精度 | 不同先隔离日历字段 |
| 月建 | 按“节”精确交接 | 节/气、历法库版本 | 节点前后各设边界 fixture |
| 纳甲/世应/六亲 | 京房八宫；本卦宫定六亲 | 表源与游魂/归魂定义 | 有冲突时回查原始表，不静默映射 |
| 伏神 | 本卦缺失六亲取本宫首卦对应爻 | 伏神表与飞神关联 | 先逐项人工复核再开启断言 |

适配器不能修改本项目生产代码、不能覆盖输出，也不能以“忽略字段”隐藏未知差异。每个排除字段必须有原因和到期阶段。

### 已核验快照（2026-10-12）

已固定并检查参考仓库 commit `53291663a4c733c4cbdfa174a8d3075475c07fd3` 的源码；这不是对未来版本的承诺。

- `cast_chart(bits, day_gan)` 的实际共同输入为 6 位 `bits`（初→上，`1` 阳、`0` 阴）与日干索引；动爻独立为 `{位置: 老阳|老阴}`。不是三数字输入。
- 用同一日干（甲）对 64 个静态本卦实跑比较，本项目与参考引擎在卦宫、卦型、世应及逐爻纳甲/五行/六亲/六神字段的差异数为 **0**。
- 上海中午时段连续 60 日实跑，月干支、日干支、旬空差异数为 **0**。
- 日界**不一致**：本项目在上海 `00:00` 换日；参考实现 `23:00` 子初换日。例：`2024-02-10 23:30 Asia/Shanghai`，本项目日柱为甲辰，参考实现为乙巳。因此 23:00–23:59 的日干支、六神及跨旬时的旬空必须标为预期口径差异，不能进“零差异”硬断言。

这意味着第一版硬断言可覆盖静态装盘字段；日历字段只覆盖双方换日规则一致的 `00:00–22:59` 样本。若要纳入 23 点后的时刻，须先由项目决定是否维持现有 `00:00` 政策或新增可选子初政策，不能通过 adapter 伪装成一致。

## 3. Fixture 设计

新目录：`tests/fixtures/liuyao-cross-engine/`。

```json
{
  "id": "qian-initial-line-moving-shanghai",
  "scope": "core_facts_v1",
  "input": {
    "lines_bottom_to_top": [9, 7, 7, 7, 7, 7],
    "instant": "2024-02-10T04:00:00Z",
    "display_timezone": "Asia/Shanghai"
  },
  "compare": {
    "required": ["hexagram", "palace", "lines.najia", "lines.kin", "lines.six_spirit", "calendar.xun_empty"],
    "informational": ["strength", "hidden.usability"],
    "expected_divergences": []
  },
  "provenance": {"author": "manual", "source": "cross-engine-v1"}
}
```

fixture 只保存非个人、可复现的盘面输入；不写入用户问题、个人资料或解释结果。每一组必须单一目的，避免一个 fixture 同时覆盖多项异常而无法定位。

### 样本集与规模

| 批次 | 数量 | 覆盖目标 | 是否阻断 CI |
| --- | ---: | --- | --- |
| A：锚点盘 | 16 | 八纯卦、七世关系、各日干起六神、无动/单动/多动 | 是 |
| B：结构矩阵 | 64 | 64 本卦，各选一个固定动爻模式 | 是 |
| C：动爻矩阵 | 64 × 64 = 4,096 | 64 本卦 × 64 种动爻掩码；静/动仅按共同事实比较 | nightly |
| D：历法边界 | 20+ | 60 日旬空抽样、上海午夜、节气前后；海外当地日界差异单列 | 阶段性 |
| E：伏神古例 | 10–20 | 缺亲、飞伏关系、游魂/归魂 | 人工审核后 |

注：B/C 通过“静态阴阳底卦 + 动爻掩码”生成；虽然本项目现有三数字入口每盘恰有一动爻，`calculate("coins", ...)` 可提供完整爻值输入。三数字算法继续由现有 384 组合测试独立覆盖。

## 4. 实现结构

```text
tests/
  fixtures/liuyao-cross-engine/
    compatibility.md
    anchors.json
    calendar-boundaries.json
    known-divergences.json
  cross_engine/
    fortune_adapter.py
    reference_adapter.py
    canonical.py
    compare.py
    test_cross_engine.py
scripts/
  run_liuyao_cross_engine.py
  report_liuyao_cross_engine.py
artifacts/liuyao-cross-engine/<run-id>/   # .gitignore；可复现报告
```

- `reference_adapter.py` 只调用固定 commit 的参考包公开 API；安装由独立开发依赖/锁文件管理，不能让生产服务导入它。
- 两个 adapter 都输出相同 schema，例如 `line[1..6].{yin_yang,moving,ganzhi,kin,six_spirit,self,response}`。
- `canonical.py` 只做中文术语、索引和布尔值的无损标准化；禁止推导或填补缺失字段。
- `compare.py` 按字段生成 `match`、`expected_divergence`、`unsupported`、`unexpected_divergence`；后者才令 CI 失败。
- 每次运行输出输入 hash、双方版本/commit、依赖版本、字段总数、差异 JSON 和 Markdown 汇总。

## 5. 差异处理与裁决

1. 先复现：保留同一 fixture、双方原始输出与版本；
2. 定位：判断是爻序/编码适配、历法口径、规则表、还是本项目缺陷；
3. 裁决：引用原始规则表或已声明工程政策；不得以多数实现投票；
4. 落档：将已确认的流派差异放进 `known-divergences.json`，说明理由、负责人、复审条件；
5. 修复：仅在裁决表明本项目违反既有契约或权威表源时改 core，并新增回归 fixture。

任何新出现的 `unexpected_divergence` 均应使 PR CI 失败；不能直接把它加入允许列表来“修绿”。

## 6. 验收标准

首轮完成条件：

- 参考实现及其许可证、commit SHA、安装步骤可复现；
- 16 个锚点盘对第一阶段必比字段 100% 一致，或每一处差异均有书面裁决；
- 至少覆盖 64 本卦、60 日旬空和节气/午夜边界；
- 生成的报告可从 fixture 与版本重新得到相同结果；
- 三数字的 384 组合测试继续独立通过，不因交叉引擎适配而改变规则。

在上述条件满足前，报告只能称为“交叉一致性检查”，不能宣称排盘已被权威认证或占断准确。

## 7. 实施顺序

1. 固定参考仓库 commit、许可证与公开 API，并填写兼容性矩阵；
2. 先实现两侧 adapter 和 16 个锚点 fixture；
3. 在本机执行、审阅每个差异后建立裁决清单；
4. 接入 PR 的锚点测试，再接入 nightly 的 4,096 结构矩阵；
5. 最后扩展历法与伏神古例，并只将已对齐字段升级为强断言。

## 8. 2026-10-15 实测与复跑

脚本：scripts/check_liuyao_cross_engine.py。生产 core 未修改。
参考仓库仍固定为 53291663a4c733c4cbdfa174a8d3075475c07fd3，并要求 clean checkout。
独立历法依赖 sxtwl==2.0.7，安装在临时目录，不加入生产依赖。

最新结果：data/liuyao_knowledge/core-cross-engine-20261015-v2/summary.json；
完整逐字段差异：同目录 differences.jsonl。

| 批次 | 输入数量 | 匹配字段数 | 已知口径差异字段数 | 非预期差异 |
| --- | ---: | ---: | ---: | ---: |
| 64 本卦 × 64 动爻掩码 | 4096 | 631552 | 19200 | 0 |
| 64 本卦 × 10 日干 | 640 | 73740 | 2340 | 0 |
| 历法：60日及交节邻域 | 384 | 1396 | 140 | 0 |
| 本系统展示时区不变性 | 256 | 1024 | 0 | 0 |
| 独立三数字映射 | 384 | 768 | 0 | 0 |

共同口径比较字段全部匹配，一致率100%；保留原始口径差异后的总字段匹配率97.0308%。
这是给定覆盖集合的实现一致性，不是“科学预测正确率”，也不是所有core字段都已得到独立认证。
字段统计按逐次断言计数；历法批次含重复时刻，不能当作384个独立日期。
展示时区与三数字是独立性质测试，不计作第二个引擎的佐证。
变卦六亲同时保存参考引擎原始输出，并另用参考引擎 _liuqin 按本卦宫计算兼容口径；后者不冒充参考默认输出。
六神结构比较使用本系统日干作为双方共同输入，日干计算另由历法批次独立比较。

已验证：卦名（乾/坤名称无损统一）、本卦宫及阶段、世应、本变卦逐爻位置/阴阳/纳甲/五行/六亲/六神、
动爻掩码、伏神身份及同位飞神、飞伏五行关系、动爻与其余本卦爻的五行/同支/冲合。
动静参考来自共同输入掩码，因为参考 cast_chart 本身不存储 moving 字段。
未验证：综合旺衰、伏神可用性、完整十二长生和 strength 所有字段；本系统没有时柱输出。

当前仍存在两类口径差异，不能假设“全部一样”：

1. 本系统上海00:00换日，参考23:00；本次日历出现140个差异字段，均为23点的日干支或旬空。
2. 本系统变卦六亲沿用本卦宫，参考 cast_chart 对变卦独立定宫；结构矩阵出现19200个六亲字段差异，六神扩展出现2340个。

海外时区方面，本系统固定上海历法；参考按当地墙钟定日。此次参考日历统一传上海墙钟及+480偏移，以同一历法时区比较；
海外展示测试仅核验本系统展示时区不会改变历法事实，没有将两边海外日界宣称为一致。

复跑（在项目根目录，参考目录和输出目录可替换）：

```bash
git clone https://github.com/yaomancy/liuyao-engine.git /tmp/fortune-core-reference-20261015
git -C /tmp/fortune-core-reference-20261015 checkout 53291663a4c733c4cbdfa174a8d3075475c07fd3
fortune_module4/.venv/bin/python -m pip install --target /tmp/fortune-cross-deps-20261015 sxtwl==2.0.7
PYTHONPATH=/tmp/fortune-cross-deps-20261015 fortune_module4/.venv/bin/python scripts/check_liuyao_cross_engine.py --reference /tmp/fortune-core-reference-20261015 --out /tmp/fortune-core-cross-new-run
```

输出目录须不存在；脚本发现非预期差异时以状态码1退出。结构输入完全枚举，不依赖随机种子。
附带运行 fortune_module4/tests/test_liuyao_core.py 和 python_algorithm/test_hexagram_engine.py，全部通过（414项）。
