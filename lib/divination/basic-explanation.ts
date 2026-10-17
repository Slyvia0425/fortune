import type { DivinationEvidencePack, DivinationModernInterpretation } from "../contracts/divination";

// A local reading of selected texts; never presented as completed six-line reasoning.
export function basicExplanation(pack: DivinationEvidencePack): DivinationModernInterpretation {
  const readings = pack.evidence.map(item => ({
    evidence_id: item.evidence_id,
    modern_chinese: [
      `${item.hexagram_name}${item.line_position ? `第${item.line_position}爻` : "卦辞"}：${item.original}`,
      ...item.commentary,
    ].join("\n"),
  }));
  return {
    overall_interpretation: [
      "基础文本解释：完整六爻分析尚未完成，以下依据原卦盘与已收录的卦爻辞整理。",
      `本次问事：${pack.question}`,
      `本卦为「${pack.primary.name}」，${pack.primary.upper_trigram}上、${pack.primary.lower_trigram}下；${pack.moving_lines.length ? `第${pack.moving_lines.join("、")}爻变动，变卦为「${pack.transformed.name}」` : "没有动爻"}。`,
      `文本选取依据：${pack.selection_rule}`,
      ...readings.map(item => item.modern_chinese),
      "上述为所选经典文本及已有注解，尚未完成针对本次问事的用神、旺衰和应期综合判断，不能据此断定事情成败。",
    ].join("\n\n"),
    readings,
    contextual_reflections: [],
    uncertainties: ["这是基础文本解释，未替代完整六爻推理。可重试完整解读，沿用原卦盘。"],
    disclaimer: "仅用于传统文化学习和文本理解，不构成对现实结果的保证。",
  };
}
