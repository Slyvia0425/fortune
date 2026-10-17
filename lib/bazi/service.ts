import type { BaziChartRequest, BaziChartResult } from "@/lib/contracts/bazi";
import { callPython } from "@/lib/server/python-client";

/** The chart and the 1.2 diagnosis are computed by the Python service; there is no local stand-in. */
export async function calculateBazi(
  input: BaziChartRequest,
): Promise<{ data: BaziChartResult; warnings: string[] }> {
  const data = await callPython<BaziChartResult>("/bazi/chart", input);
  return { data, warnings: [] };
}
