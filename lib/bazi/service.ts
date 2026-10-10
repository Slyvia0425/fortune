import type {
  BaziChartRequest,
  BaziChartResult,
} from "@/lib/contracts/bazi";
import { createMockBaziChart } from "@/lib/bazi/mock";
import {
  callPython,
  pythonServiceConfigured,
} from "@/lib/server/python-client";

export async function calculateBazi(input: BaziChartRequest): Promise<{
  data: BaziChartResult;
  mock: boolean;
  warnings: string[];
}> {
  if (pythonServiceConfigured("bazi")) {
    const data = await callPython<BaziChartResult>("bazi", "/bazi/chart", input);
    return {
      data,
      mock: data.meta?.mock ?? false,
      warnings: data.meta?.warnings ?? [],
    };
  }

  const data = createMockBaziChart(input);
  return {
    data,
    mock: true,
    warnings: data.meta?.warnings ?? [],
  };
}
