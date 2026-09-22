import type {
  DivinationCastRequest,
  DivinationCastResult,
  HexagramView,
} from "@/lib/contracts/divination";
import { enrichDivinationReading } from "@/lib/divination/reading";
import { callPython, pythonServiceConfigured } from "@/lib/server/python-client";

const hex = (
  number: number,
  name: string,
  upper_trigram: string,
  lower_trigram: string,
  lines: Array<6 | 7 | 8 | 9>,
): HexagramView => ({ number, name, upper_trigram, lower_trigram, lines });

export async function castDivination(
  input: DivinationCastRequest,
): Promise<{ data: DivinationCastResult; mock: boolean; warnings: string[] }> {
  if (pythonServiceConfigured("divination")) {
    const data = await callPython<DivinationCastResult>("divination", "/divination/cast", input);
    return { data: enrichDivinationReading(data), mock: false, warnings: [] };
  }

  const data = enrichDivinationReading({
    primary: hex(3, "水雷屯", "坎", "震", [9, 8, 8, 8, 7, 8]),
    moving_lines: [1],
    mutual: hex(23, "山地剥", "艮", "坤", [8, 8, 8, 8, 8, 7]),
    transformed: hex(8, "水地比", "坎", "坤", [8, 8, 8, 8, 7, 8]),
    traditional_meaning: "模拟传统释义，待知识证据与算法结果接入。",
    contextual_interpretation: "这是接口联调用的模拟解释，不代表正式占断。",
  });

  return {
    data,
    mock: true,
    warnings: ["Python 起卦算法服务尚未配置，当前返回契约兼容的模拟结果。"],
  };
}
