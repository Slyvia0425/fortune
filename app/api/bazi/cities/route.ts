import { failure, success } from "@/lib/contracts/api";
import type { CityHit } from "@/lib/bazi/city-search";
import { CITY_OPTIONS } from "@/lib/bazi/cities";
import { getPython, pythonServiceConfigured } from "@/lib/server/python-client";

const SYSTEM = "bazi-cities-v1";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!q || q.length > 64) {
    return failure(SYSTEM, "VALIDATION_ERROR", "q 必须是 1 到 64 个字符。");
  }

  if (pythonServiceConfigured()) {
    try {
      const hits = await getPython<CityHit[]>(`/bazi/cities?q=${encodeURIComponent(q)}&limit=10`);
      return Response.json(success(hits, { system: SYSTEM }));
    } catch (error) {
      return failure(
        SYSTEM,
        "ALGORITHM_SERVICE_ERROR",
        "城市搜索服务调用失败。",
        { cause: error instanceof Error ? error.message : "unknown" },
        502,
      );
    }
  }

  // No Python service: fall back to the short built-in list so the form still works.
  const needle = q.toLowerCase();
  const hits: CityHit[] = CITY_OPTIONS.filter((c) => c.city.toLowerCase().includes(needle))
    .slice(0, 10)
    .map((c) => ({
      id: c.id,
      name: c.city,
      country_code: c.country_code,
      latitude: c.latitude,
      longitude: c.longitude,
      timezone: "",
    }));
  return Response.json(
    success(hits, { system: SYSTEM, mock: true, warnings: ["Python 服务未配置，仅搜索内置的少量城市。"] }),
  );
}
