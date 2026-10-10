import { failure, success } from "@/lib/contracts/api";
import type { CityHit } from "@/lib/bazi/city-search";
import { getPython, pythonServiceConfigured } from "@/lib/server/python-client";

const SYSTEM = "bazi-cities-v1";

/** City search for the birth form. The cities live with the Python service (GeoNames); there is no short stand-in list here. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!q || q.length > 64) {
    return failure(SYSTEM, "VALIDATION_ERROR", "q 必须是 1 到 64 个字符。");
  }
  if (!pythonServiceConfigured()) {
    return failure(SYSTEM, "ALGORITHM_SERVICE_NOT_CONFIGURED", "八字算法服务未配置，无法搜索城市；请改用「填经纬度」。", undefined, 503);
  }

  try {
    const hits = await getPython<CityHit[]>(`/bazi/cities?q=${encodeURIComponent(q)}&limit=10`);
    return Response.json(success(hits, { system: SYSTEM }));
  } catch (error) {
    return failure(SYSTEM, "ALGORITHM_SERVICE_ERROR", "城市搜索服务调用失败。", { cause: error instanceof Error ? error.message : "unknown" }, 502);
  }
}
