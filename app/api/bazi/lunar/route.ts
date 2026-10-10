import { failure, success } from "@/lib/contracts/api";
import type { LunarCheck } from "@/lib/bazi/lunar-check";
import { getPython, pythonServiceConfigured } from "@/lib/server/python-client";

const SYSTEM = "bazi-lunar-check-v1";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const date = params.get("date") ?? "";
  const leap = params.get("leap") === "true";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return failure(SYSTEM, "VALIDATION_ERROR", "date 必须是 YYYY-MM-DD。");
  }

  // Without the Python service there is no lunar calendar to check against;
  // let the form through rather than block it on a check that cannot run.
  if (!pythonServiceConfigured()) {
    return Response.json(
      success<LunarCheck>({ valid: true, solar_date: null, message: null }, {
        system: SYSTEM,
        mock: true,
        warnings: ["Python 服务未配置，未校验农历日期。"],
      }),
    );
  }

  try {
    const result = await getPython<LunarCheck>(
      `/bazi/lunar-date?date=${encodeURIComponent(date)}&leap=${leap}`,
    );
    return Response.json(success(result, { system: SYSTEM }));
  } catch (error) {
    return failure(
      SYSTEM,
      "ALGORITHM_SERVICE_ERROR",
      "农历校验服务调用失败。",
      { cause: error instanceof Error ? error.message : "unknown" },
      502,
    );
  }
}
