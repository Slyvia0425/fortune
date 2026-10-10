import { success } from "@/lib/contracts/api";
import { calculateBazi } from "@/lib/bazi/service";
import { algorithmFailure, readBirthRequest } from "@/lib/server/bazi-route";

const SYSTEM = "bazi-chart-v1";

export async function POST(request: Request) {
  const birth = await readBirthRequest(request, SYSTEM);
  if (!birth.ok) return birth.response;

  try {
    const output = await calculateBazi(birth.value);
    return Response.json(
      success(output.data, {
        system: SYSTEM,
        sessionId: crypto.randomUUID(),
        // The chart carries the classical sources it relied on; surface them in the envelope so callers get citations
        // without reaching into the reasoning trace.
        sources: output.data.source_refs,
        warnings: output.warnings,
        mock: output.data.meta?.mock ?? false,
      }),
    );
  } catch (error) {
    return algorithmFailure(SYSTEM, error);
  }
}
