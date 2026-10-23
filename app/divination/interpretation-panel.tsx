import type { DivinationInterpretationResult } from "@/lib/contracts/divination";
import styles from "./interpretation-panel.module.css";

export default function InterpretationPanel({ result }: { result: DivinationInterpretationResult }) {
  const modern = result.modern_interpretation ?? result.basic_interpretation;
  const reasoning=result.structured_reasoning;
  const report=modern?.explainer;
  const findingLabels={supported:"理论内有据",conditional:"有条件",conflicting:"存在不同观点",insufficient:"依据不足"};
  const { primary, transformed, moving_lines: movingLines } = result.evidence_pack;
  const movingLabel = movingLines.length ? `第 ${movingLines.join("、")} 爻` : "无动爻";

  return <section className={styles.panel} aria-labelledby="interpretation-title">
    <header>
      <p>OVERALL INTERPRETATION</p>
      <h3 id="interpretation-title">综合解释</h3>
      <span>{result.basic_interpretation && !result.modern_interpretation ? "当前为基础文本解释，完整六爻分析尚未完成。" : "结合本次卦盘、主用神与辅助角色、古籍原文和参考案例。"}</span>
    </header>
    <dl className={styles.structure}>
      <div><dt>本卦</dt><dd>{primary.name}</dd></div>
      <div><dt>上下卦</dt><dd>{primary.upper_trigram}上 · {primary.lower_trigram}下</dd></div>
      <div><dt>五行关系</dt><dd>{primary.five_element_relation}</dd></div>
      <div><dt>动爻</dt><dd>{movingLabel}</dd></div>
      <div><dt>变卦</dt><dd>{transformed.name}</dd></div>
    </dl>
    {report?<>
      <p>流程状态：{result.analysis_status==="complete"?"已完成":"未完成"}；理论分析结论：{reasoning?findingLabels[reasoning.overall_assessment.status]:"依据不足"}。流程完成不代表现实结果已确定。</p>
      {([["verdict","断语"],["advice","行动建议"],["analysis","卦理分析"]] as const).filter(([key])=>key!=="advice"||report.sections.advice.length>0).map(([key,title])=><section className={styles.overall} key={key}><h4>{title}</h4>
        {report.sections[key].length?report.sections[key].map(id=>{const claim=report.claims.find(c=>c.claim_id===id)!;return <p key={id}>{claim.kind==="practical"&&<span>现实建议：</span>}{claim.text}{claim.evidence_ids.map(eid=>{const cite=report.citations.find(c=>c.evidence_id===eid)!;return <a key={eid} href={"#explainer-evidence-"+cite.number} aria-label={"查看典籍依据 "+cite.number}>[{cite.number}]</a>;})}</p>;}):<p>暂无具备充分典籍依据的卦理行动建议。</p>}
      </section>)}
      <details><summary>典籍依据</summary>
        <p>{report.validation_mode==="integrity"?"当前为完整生成模式：程序只核对数据与引用完整性；规则适用性、条件判断和综合结论由模型生成，未作程序语义验证。":"程序已检查引用、原文与明确的事实条件；这不等于已经证明原文支持全部解释，仍须核阅理论适用性。"}</p>
        {report.citations.map(cite=><article key={cite.evidence_id} id={"explainer-evidence-"+cite.number}><h4>[{cite.number}] {cite.title}</h4><small>{cite.locator} · {cite.source_revision_id}</small><blockquote>{cite.quote}</blockquote>{cite.url&&<a href={cite.url} target="_blank" rel="noreferrer">原始来源</a>}</article>)}
        {report.claims.filter(c=>c.rule_application).map(claim=><article key={claim.claim_id}><h4>{claim.text}</h4><p>适用性：{({applicable:"条件已核对",conditional:"有条件适用",inapplicable:"不适用",insufficient:"依据不足"})[claim.rule_application!.applicability]}</p>
          {claim.rule_application!.evidence_links.map((l,i)=><p key={i}>{({supports:"支持",limits:"限制",background:"背景",contradicts:"相反依据"})[l.use]}：{l.relevance} — 原文“{l.quote}”</p>)}
          {claim.rule_application!.conditions.map((condition,i)=><p key={i}>条件（{({met:"已满足",unmet:"未满足",unknown:"待核验"})[condition.state]}）：{condition.description}</p>)}
          <p>例外核对：{claim.rule_application!.exceptions_checked.join("；")}</p>
        </article>)}
      </details>
    </>:<section className={styles.overall}>
      <h4>综合解释</h4>
      {reasoning&&<p>流程状态：{result.analysis_status==="complete"?"已完成":result.analysis_status??"未完成"}；理论分析结论：{findingLabels[reasoning.overall_assessment.status]}。流程完成不代表现实结果已确定。</p>}
      <p>{modern?.overall_interpretation ?? (reasoning?"结构化分析已保留，最终文本暂未完成；可先查看下方观察与原文依据，稍后重试不会重新起卦。":result.analysis_status==="reasoning_failed"?"结构化推理尚未通过校验，系统已保留证据与原卦盘，未绕过校验生成解读。":"现代中文综合解释暂不可用；系统保留了本次卦象结构，稍后可重新请求解释。")}</p>
    </section>}
    {reasoning&&<details><summary>结构化分析与证据依据（{findingLabels[reasoning.overall_assessment.status]}）</summary>
      {reasoning.findings.map(f=><article key={f.finding_id}><h4>{findingLabels[f.status]}</h4><p>{f.observation}</p><p>{f.interpretation}</p>
        {f.evidence_ids.map(id=>{const evidence=result.evidence_snapshot?.evidence.find(e=>e.evidence_id===id);return evidence?<blockquote key={id}>{evidence.text}<small>来源：{evidence.source_revision_id}，片段 {evidence.start_offset}–{evidence.end_offset_exclusive}{evidence.shared_source_group||evidence.same_text_group?"（存在重叠或同文来源，不作独立支持计数）":""}</small></blockquote>:null;})}
      </article>)}
      {reasoning.competing_views.map((v,i)=><p key={i}>不同观点：{v.description}</p>)}
      {reasoning.unresolved_questions.length>0&&<section><h4>未解决问题</h4><ul>{reasoning.unresolved_questions.map(q=><li key={q}>{q}</li>)}</ul></section>}
      {report&&report.gap_impacts.map(g=><p key={g.gap_id}>缺口影响（{({core:"核心",time:"时间",secondary:"次要"})[g.classification]}）：{g.reason}</p>)}
    </details>}
    <details><summary>卦爻辞原文与出处</summary>{result.evidence_pack.evidence.map(item => <article key={item.evidence_id}><h4>{item.hexagram_name}{item.line_position ? ` · 第 ${item.line_position} 爻` : " · 卦辞"}</h4><blockquote>{item.original}</blockquote><p>{item.source_ids.map(id => result.evidence_pack.sources.find(source => source.source_id === id)?.title ?? id).join("、")}</p></article>)}</details>
    <footer>{modern?.disclaimer ?? "本解释仅用于传统文化学习与文本理解，不构成医疗、法律、投资或其他现实决策建议。"}</footer>
  </section>;
}
