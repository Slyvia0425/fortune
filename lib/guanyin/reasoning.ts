import { retrieveGuanyinSemanticEvidence } from "./semantic";
import { analyzeGuanyinQuestion } from "./question-intent";
import type {
  GuanyinReasoningStatement,
  GuanyinPracticalGuidance,
  GuanyinSemanticEvidenceItem,
  GuanyinStructuredReasoning,
  QuestionDomain,
} from "./types";

const statementTemplates: Readonly<Record<string, string>> = Object.freeze({
  "theme.new_beginning": "事情呈现重新开始、重建或重新立基的主题。",
  "theme.opportunity": "文本显示存在有利条件或成事机会，但这本身不等于应立即行动。",
  "theme.integrity": "处理此事时应以守正、诚信和本分为基本原则。",
  "theme.help_from_others": "事情可能得到他人、师长或可靠关系的帮助。",
  "theme.foundation": "事情与既有根基、长期积累或传承有关。",
  "theme.deception": "当前主题涉及辨别误导、虚假信息或不可靠关系。",
  "theme.effort_without_result": "继续投入不一定能在短期得到相应成果。",
  "theme.relationship_harmony": "传统文本显示双方关系具有和合倾向，但不代表任何一方已经作出承诺。",
  "theme.medical_support": "传统文本表示可能遇到合适的帮助或方法，但不能据此判断已经康复。",
  "action.advance": "在现实条件确认具备后，可以审慎推进。",
  "action.hold": "当前更适合维持现状，暂不作较大改变。",
  "action.wait": "当前更适合等待条件、消息或时机进一步成熟。",
  "action.seek_help": "可以主动向可靠的师长、专业人士或关系寻求帮助。",
  "action.verify": "行动前应核对信息、承诺和现实条件。",
  "pattern.difficulty_then_relief": "发展轨迹倾向先经历阻碍，之后逐渐缓解。",
  "pattern.delayed_success": "事情存在实现可能，但结果偏晚，需要等待或积累。",
  "pattern.obscured_then_clear": "当前局势或信息尚有遮蔽，之后才可能逐渐明朗。",
  "pattern.steady_growth": "事情倾向通过持续积累逐步成长，而非立即完成。",
  "pattern.repeated_failure": "当前方式可能造成反复投入和重复受阻。",
  "time.autumn_winter": "传统文本明确提到秋季或冬季；这属于传统时间提示，不是可验证期限。",
  "time.wait_for_timing": "结果依赖后续时机成熟，文本没有给出可验证的具体日期。",
  "risk.rushing": "仓促推进可能放大阻碍或损失。",
  "risk.false_promise": "眼前利益、承诺或关系可能不够可靠。",
  "risk.uncertainty": "当前事实、条件或结果尚不明确。",
  "risk.wasted_effort": "继续沿用相同方法可能增加消耗而缺少成果。",
  "risk.household_instability": "家宅或家庭事务仍有不安、阻碍或照护压力，需要优先处理现实问题。",
  "risk.hidden_harm": "签文包含需要谨慎核实的风险象征，但不能证明现实中存在伤害、敌意或具体加害者。",
  "risk.reversal": "表面顺利的局势仍可能出现不利变化，应核查疑点并保留可撤回空间。",
  "risk.apparent_threat": "当前情境看似有威胁，但尚不足以证明会造成实际伤害。",
  "risk.goal_distortion": "当前目标或期待可能偏离现实，需要重新校准；这不表示必然受到他人欺骗。",
  "symbol.creation": "“开天辟地”象征开创、重建和建立新秩序。",
  "symbol.tree": "“松柏栋梁”象征经受考验、长期成长并最终成材。",
  "symbol.moon_cloud": "“云遮月”象征事实暂被遮蔽、局势尚未明朗。",
  "symbol.fish_dragon": "“鱼跃龙门”象征积累之后出现处境跃迁。",
  "symbol.swallow_nest": "“燕子衔泥”象征反复建设但成果暂不稳定。",
});

function makeStatement(text: string, evidence: readonly GuanyinSemanticEvidenceItem[]): GuanyinReasoningStatement {
  return Object.freeze({
    text,
    tagIds: Object.freeze(evidence.map((item) => item.tag.id)),
    sourceIds: Object.freeze(evidence.map((item) => item.sourceId)),
  });
}

function statementsFor(evidence: readonly GuanyinSemanticEvidenceItem[], type: GuanyinSemanticEvidenceItem["tag"]["type"]) {
  return Object.freeze(evidence
    .filter((item) => item.tag.type === type)
    .map((item) => makeStatement(statementTemplates[item.tag.id] ?? item.tag.description, [item])));
}

function findEvidence(evidence: readonly GuanyinSemanticEvidenceItem[], tagId: string) {
  return evidence.find((item) => item.tag.id === tagId);
}

function buildCoreJudgment(evidence: readonly GuanyinSemanticEvidenceItem[], primaryIntent: GuanyinStructuredReasoning["questionAnalysis"]["primaryIntent"]): GuanyinReasoningStatement | null {
  const hold = findEvidence(evidence, "action.hold");
  const wait = findEvidence(evidence, "action.wait");
  const advance = findEvidence(evidence, "action.advance");
  const rushing = findEvidence(evidence, "risk.rushing");
  const wastedEffort = findEvidence(evidence, "risk.wasted_effort");
  const waitForTiming = findEvidence(evidence, "time.wait_for_timing");
  const verify = findEvidence(evidence, "action.verify");
  const seekHelp = findEvidence(evidence, "action.seek_help");
  const opportunity = findEvidence(evidence, "theme.opportunity");
  const externalHelp = findEvidence(evidence, "theme.help_from_others");
  const obscuredThenClear = findEvidence(evidence, "pattern.obscured_then_clear");
  const autumnWinter = findEvidence(evidence, "time.autumn_winter");
  const harmony = findEvidence(evidence, "theme.relationship_harmony");
  const householdRisk = findEvidence(evidence, "risk.household_instability");
  const difficultyThenRelief = findEvidence(evidence, "pattern.difficulty_then_relief");
  const medicalSupport = findEvidence(evidence, "theme.medical_support");
  const falsePromise = findEvidence(evidence, "risk.false_promise");
  const reversal = findEvidence(evidence, "risk.reversal");
  const apparentThreat = findEvidence(evidence, "risk.apparent_threat");
  const effortWithoutResult = findEvidence(evidence, "theme.effort_without_result");
  const integrity = findEvidence(evidence, "theme.integrity");
  const hiddenHarm = findEvidence(evidence, "risk.hidden_harm");
  const goalDistortion = findEvidence(evidence, "risk.goal_distortion");

  if (primaryIntent === "timing" && autumnWinter) return makeStatement("传统文本把较有利的时段指向秋季或冬季；可先准备，进入所指时段且现实条件具备后再分阶段行动。", [autumnWinter]);
  if (primaryIntent === "travel_start" && advance) return makeStatement("文本明确支持启程；是否实际出发仍应以行程、安全和健康条件为准。", [advance]);
  if (primaryIntent === "career_change" && (opportunity || externalHelp || obscuredThenClear)) return makeStatement("当前资料只显示可能存在支持或后续转机，不足以支持立即辞职或作出其他不可逆职业决定。宜先保留现职，用投递、面试或小范围合作核实岗位、薪资、发展条件和退出方案，再决定是否转换。", [opportunity ?? externalHelp ?? obscuredThenClear!]);
  if (primaryIntent === "relationship_commitment" && harmony && hold) return makeStatement("当前不宜强行推进或催促承诺，但关系并非全然悲观；可先保持沟通并逐步处理现实阻碍。", [harmony, hold]);
  if (primaryIntent === "relationship_commitment" && harmony) return makeStatement("关系基础整体偏有利，可以主动沟通并确认双方真实意愿，但不应把和合倾向当作已经确定关系。", [harmony]);
  if (primaryIntent === "family_change" && householdRisk) return makeStatement("家庭事务仍存在现实不安或阻碍，暂不宜只凭稳定基础推进新安排；应先处理具体问题。", [householdRisk]);
  if (primaryIntent === "family_change" && difficultyThenRelief && !hold && !wait) return makeStatement("当前不宜因为暂时波折就立即作出重大、不可逆的改变。可以先处理眼前问题并作必要的小幅调整；若没有紧急风险，可观察局势是否逐渐缓解后再决定。", [difficultyThenRelief]);
  if (medicalSupport) return makeStatement("传统文本表示可能获得合适的医疗帮助或方法，但这不能证明已经康复，也不能代替专业评估。", [medicalSupport]);
  if (primaryIntent === "obligation_fulfillment" && (integrity || hold)) return makeStatement("已有承诺不宜继续搁置。应核对内容、期限和履行能力；能够履行的应制定计划落实，无法按原约完成的应主动说明、协商并留下记录。", integrity ? [integrity] : [hold!]);
  if (primaryIntent === "credibility_check" && falsePromise) return makeStatement("该消息存在失实或落空风险；未经独立验证，不应采信、付款或作出承诺，其他帮助信息不能冲抵这一风险。", [falsePromise]);
  if (primaryIntent === "risk_assessment" && apparentThreat) return makeStatement("当前看似存在威胁，但尚无充分证据证明会造成实际伤害。应把疑虑拆成可验证事项：明确高危迹象先暂停保护，可疑线索先核查并限制投入，只有主观担忧时不必自动退缩。", [apparentThreat]);
  if (reversal && hold) return makeStatement("表面进展仍有反转可能，暂不宜高成本或不可逆推进。应保留稳定安排并逐项核查疑点；关键事实验证后，可用小规模、可撤回的步骤测试。", [reversal, hold]);
  if (effortWithoutResult && findEvidence(evidence, "risk.uncertainty") && verify) return makeStatement("当前信息真假难辨且现有路径阻力较大，不宜扩大投入或作不可逆决定。应先核实关键事实、暂停新增承诺，并设置观察期限、止损和退出条件。", [findEvidence(evidence, "risk.uncertainty")!, effortWithoutResult, verify]);
  if (hiddenHarm && (hold || wait)) return makeStatement("签文中的风险象征不能证明现实中有人加害。应先区分可验证事实、可疑线索和主观担忧；如有现实安全疑虑，优先保护自身、控制损失、保存证据并主动寻求可信或正式支持，这不是被动忍受伤害。", [hiddenHarm, ...(hold ? [hold] : []), ...(wait ? [wait] : [])]);
  if (difficultyThenRelief && hold && wait) return makeStatement("当前不宜因受压而立即公开冲突或作不可逆决定，但也不等于忍受现实伤害。应先核实事实、保护自身、保存证据并使用合适渠道处理，再根据条件决定后续行动。", [difficultyThenRelief, hold, wait]);
  if (opportunity && hold) return makeStatement("机会信息尚不足以支持立即改变现状。可先保留稳定基础，同时用低成本、可逆的小步骤核实机会；验证关键条件后再决定是否扩大行动。", [opportunity, hold]);
  if (goalDistortion && wastedEffort) return makeStatement("当前目标或期待可能与现实存在偏差，不宜继续原样加码。应暂停新增投入、核实目标是否仍合理，并改用短周期、可衡量的方法测试；调整后仍反复无进展时，再考虑退出。", [goalDistortion, wastedEffort]);

  if (wastedEffort && waitForTiming) return makeStatement("暂不适合继续加大投入，宜先停止无效消耗并等待条件变化；这不等于彻底放弃。", [wastedEffort, waitForTiming]);
  if (wastedEffort && hold) return makeStatement("当前方法正在增加消耗或扩大问题，不宜原样继续或继续加码。应先停止无效做法、控制损失并保留已有成果，再查明原因、调整方案；这不等于放弃目标。", [wastedEffort, hold]);
  if (wait && rushing) return makeStatement("当前倾向暂缓行动并等待条件成熟，避免仓促推进。", [wait, rushing]);
  if (hold && wait && verify) return makeStatement("当前倾向暂缓重大决定并维持现状，同时先核实消息来源和现实条件。", [hold, wait, verify]);
  if (hold && wait) return makeStatement("当前倾向维持现状并等待时机，不宜急于改变。", [hold, wait]);
  if (advance) return makeStatement("文本支持在现实条件确认具备后审慎推进。", [advance]);
  if (hold) return makeStatement("当前倾向维持现状，暂不作较大改变。", [hold]);
  if (wait) return makeStatement("当前不宜强推，可先做好准备并观察条件；条件逐渐成熟时再顺势行动。", [wait]);
  if (verify) return makeStatement("面对未经证实的信息或承诺，当前应先核对来源和现实条件，再决定是否行动。", [verify]);
  if (seekHelp) return makeStatement("当前可以主动接近可靠的师长、专业人士或关系，借助外部支持推进问题。", [seekHelp]);
  if (opportunity) return makeStatement("文本显示存在有利条件，但没有行动标签支持立即推进。", [opportunity]);

  const pattern = evidence.find((item) => item.tag.type === "pattern");
  if (pattern) return makeStatement(statementTemplates[pattern.tag.id] ?? pattern.tag.description, [pattern]);
  const theme = evidence.find((item) => item.tag.type === "theme");
  if (theme) return makeStatement(statementTemplates[theme.tag.id] ?? theme.tag.description, [theme]);
  return null;
}

function buildPracticalGuidance(evidence: readonly GuanyinSemanticEvidenceItem[], domain: GuanyinStructuredReasoning["domain"], primaryIntent: GuanyinStructuredReasoning["questionAnalysis"]["primaryIntent"]): readonly GuanyinPracticalGuidance[] {
  const tagIds = new Set(evidence.map((item) => item.tag.id));
  const guidance: GuanyinPracticalGuidance[] = [];
  const add = (text: string, category: GuanyinPracticalGuidance["category"]) => guidance.push(Object.freeze({ text, basis: "system_safety", category }));

  if (domain === "travel" && tagIds.has("action.hold")) {
    add("目前不宜主动进行非必要搬迁，可先看房、比较成本并做准备；若存在安全、健康、合同到期等紧迫原因，应以现实需要为先。", "decision_safety");
  }
  if (domain === "career" && tagIds.has("action.wait") && tagIds.has("risk.rushing")) {
    add("暂缓辞职、签约等难以撤回的决定，不妨先了解机会、投递和面试，待岗位、薪资与发展条件明确后再选择。", "decision_safety");
  }
  if (domain === "career" && primaryIntent === "career_change") {
    add("在新机会的岗位、薪资、稳定性、发展空间和录用条件得到独立确认前，优先保留现职；可以先投递、面试、试做或小范围合作，用低成本、可撤回的方式验证，不因签文倾向直接辞职。", "decision_safety");
  }
  if (tagIds.has("theme.opportunity") && !tagIds.has("action.advance")) {
    add("可先确认资源、风险和关键条件，再采用分阶段、可回退的方式试探，不把“有利”直接理解成“立即全力推进”。", "decision_safety");
  }
  if (tagIds.has("pattern.difficulty_then_relief") && tagIds.has("action.hold") && tagIds.has("action.wait")) {
    add("先处理现实压力：记录事实、保存证据并选择合适渠道求助；避免冲动报复或仓促作出难以撤回的决定。", "decision_safety");
  }
  if (tagIds.has("risk.hidden_harm")) {
    add("若存在现实威胁、胁迫、持续伤害或违法行为，应立即采取安全措施并联系可信人士、单位正式渠道或当地专业机构，不必为了等待时机而延误保护。", "decision_safety");
  }
  if (domain === "marriage" && tagIds.has("action.verify")) {
    add("先与当事人直接沟通并核对消息来源；若涉及暴力、控制或人身安全，应优先保护自己并寻求现实支持，不必等待。", "relationship_safety");
  }
  if (primaryIntent === "relationship_commitment") {
    add("关系是否推进应以双方明确、持续的同意为前提，并先沟通期待、边界与现实条件。", "relationship_safety");
  }
  if (primaryIntent === "travel_start") {
    add("启程前应核对证件、天气、交通、健康与应急安排；存在现实安全风险时，以现实信息为准。", "decision_safety");
  }
  if (primaryIntent === "family_change") {
    add("若涉及人身安全、照护中断、医疗需要或基本生活风险，应优先采取现实保护和必要调整，不应为了等待而延误处理。", "decision_safety");
  }
  if (domain === "health") {
    add("健康解读仅用于理解传统文本，不能用于诊断、停药或替代治疗；症状持续、加重或涉及紧急风险时，应及时咨询合格医疗专业人员。", "health_safety");
  }
  if (domain === "wealth") {
    add("财富解读不构成投资或交易保证；涉及资金时，应核对合同、费用、风险与自身承受能力，必要时咨询合格专业人士。", "financial_safety");
  }
  return Object.freeze(guidance);
}

export interface BuildGuanyinReasoningInput { signId: unknown; domain: QuestionDomain; question: string }

export function buildGuanyinStructuredReasoning({ signId, domain, question }: BuildGuanyinReasoningInput): GuanyinStructuredReasoning {
  const questionAnalysis = analyzeGuanyinQuestion(question, domain);
  const retrieval = retrieveGuanyinSemanticEvidence(signId, domain, questionAnalysis.intents);
  const evidence = retrieval.tags;
  const uncertainties = [
    "本结果表达的是传统签文的文本倾向，不是对现实结果的保证。",
    `本次仅按 ${retrieval.domain} 领域筛选；其他领域的限定标签未参与判断。`,
  ];
  if (!evidence.some((item) => item.tag.type === "time")) uncertainties.push("相关证据没有提供明确时间信息。");
  if (!evidence.some((item) => item.tag.type === "action")) uncertainties.push("相关证据没有形成明确的行动倾向，应结合现实条件判断。");
  if (retrieval.coverage === "unavailable") uncertainties.push("该签尚未进入已复核语义样本，当前不能生成基于标签的判断。");
  const primarySafetyAnswer = questionAnalysis.safetyFlags.includes("medical_decision")
    ? Object.freeze({
      text: "不要仅根据签文自行停止检查、用药或治疗；是否调整或停止，应由合格医疗专业人员结合症状、检查结果和治疗反应决定。",
      basis: "system_safety" as const,
      category: "health_safety" as const,
    })
    : null;

  return Object.freeze({
    signId: retrieval.signId,
    domain: retrieval.domain,
    question,
    questionAnalysis,
    coverage: retrieval.coverage,
    coreJudgment: buildCoreJudgment(evidence, questionAnalysis.primaryIntent),
    themes: statementsFor(evidence, "theme"),
    trends: statementsFor(evidence, "pattern"),
    actions: statementsFor(evidence, "action"),
    risks: statementsFor(evidence, "risk"),
    timing: statementsFor(evidence, "time"),
    symbols: statementsFor(evidence, "symbol"),
    primarySafetyAnswer,
    practicalGuidance: buildPracticalGuidance(evidence, retrieval.domain, questionAnalysis.primaryIntent),
    uncertainties: Object.freeze(uncertainties),
    evidence,
  });
}
