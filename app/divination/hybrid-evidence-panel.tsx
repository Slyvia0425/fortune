import type { DivinationInterpretationResult } from "@/lib/contracts/divination";

const gapLabels: Record<string, string> = {
  NO_ELIGIBLE_EVIDENCE: "尚无满足生产使用条件的规则依据。",
  UNRESOLVED_CONDITION: "部分规则条件或取用分支尚未确定。",
  CHART_FACTS_INCOMPLETE: "这份历史卦盘仍缺少判断所需字段。",
  METHOD_CONFLICT: "规则之间存在尚未解决的分歧。",
  QUESTION_CONTEXT_INCOMPLETE: "需要补充问事信息。",
  RETRIEVAL_BUDGET_EXCEEDED: "本次检索已达上限，仍有依据未能完整取得。",
};
const roleNames: Record<string, string> = { parents: "父母", siblings: "兄弟", offspring: "子孙", wealth: "妻财", officials: "官鬼", self: "世", response: "应" };

export default function HybridEvidencePanel({ result }: { result: DivinationInterpretationResult }) {
  const pack = result.hybrid_evidence;
  if (!pack) return null;
  const core = result.frozen_core;
  return <section aria-label="六爻规则解释">
    <h4>六爻规则解释</h4>
    <p role="status">{result.hybrid_interpretation?.message}</p>
    {pack.gaps.length > 0 && <ul>{pack.gaps.map(gap => <li key={gap}>{gapLabels[gap] ?? "仍有判断条件需要核验。"}</li>)}</ul>}
    {pack.clarification.length > 0 && <div><h4>待补充信息</h4>{pack.clarification.map(item => <p key={item.field}>{item.question}</p>)}<p>这些问题用于说明当前解释的限制；补充前请保留本次起卦记录。</p></div>}
    {result.hybrid_interpretation?.readings.map((reading, index) => <div key={index}><p>{reading.text}</p><small>依据：{reading.evidence_ids.map(id => pack.supporting_evidence.find(u => u.entity_revision_id === id)?.entity_id ?? id).join("、")}</small></div>)}
    {core && <details><summary>本次装盘事实：六亲、世应与伏神</summary>
      <p>月建 {core.calendar.month_ganzhi} · 日辰 {core.calendar.day_ganzhi} · 旬空 {core.calendar.empty_branches.join("、")}</p>
      <table><thead><tr><th>爻位</th><th>干支</th><th>六亲</th><th>世应</th><th>动静</th></tr></thead><tbody>{core.main_lines.map(line => <tr key={line.ref}><td>{line.position}</td><td>{line.ganzhi}</td><td>{line.kin_name}</td><td>{line.position_role === "self" ? "世" : line.position_role === "response" ? "应" : "—"}</td><td>{line.moving ? "动" : "静"}</td></tr>)}</tbody></table>
      <p>伏神：{core.hidden_lines.length ? core.hidden_lines.map(line => `${line.position}爻 ${line.ganzhi} ${line.kin_name}`).join("；") : "本次无缺失六亲对应的伏神"}。伏神位置不等于已经确认可用。</p>
    </details>}
    {pack.candidate_roles.length > 0 && <details><summary>候选与选用状态</summary>{pack.candidate_roles.map(role => <p key={role.role_id}>{roleNames[role.role_id.replace("role:", "")] ?? role.role_id}：{pack.selected_use.some(use => use.role_id === role.role_id && use.line_ref === role.selected_line_ref) ? `已选 ${role.selected_line_ref}` : "仍为候选，尚未确定选用"}</p>)}</details>}
    {pack.supporting_evidence.length > 0 && <details><summary>核验规则与案例原文（{pack.supporting_evidence.length} 条）</summary>{pack.supporting_evidence.map(unit => <article key={unit.entity_revision_id}><h5>{unit.kind === "rule" ? "规则" : "案例"} · {unit.entity_id}</h5>{unit.source_quotes.map((quote, index) => <div key={index}><blockquote>{quote.quote}</blockquote><small>来源 {quote.source_revision_id} · 字符 {quote.start}–{quote.end}</small></div>)}</article>)}</details>}
    <details><summary>本次解释记录</summary><p>卦盘：{pack.chart_id}</p><p>检索记录：{pack.retrieval_run_id}</p><p>已核验依据 {pack.supporting_evidence.length} 条；待判条件 {pack.pending_conditions.length} 条；对照或不适用依据 {pack.counter_evidence.length} 条。</p></details>
  </section>;
}
