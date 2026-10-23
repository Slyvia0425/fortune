import { failure, success } from "@/lib/contracts/api";
import { buildBaziFacts, ruleBasedReading, type ReadingLocale } from "@/lib/bazi/interpretation";
import { calculateBazi } from "@/lib/bazi/service";
import { algorithmFailure, readBirthRequest } from "@/lib/server/bazi-route";
import { baziLlmConfigured, generateBaziReading } from "@/lib/server/bazi-llm";

const SYSTEM = "bazi-interpretation-v1";

/**
 * 现代解读. The body is the birth request the chart was made from, plus an optional `locale`. The chart is recomputed here, so the
 * facts the model sees are the engine's and not whatever a client sends back. A model answer that fails the checks, or no model at all,
 * gives the rule-based reading, labelled as such.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return failure(SYSTEM, "INVALID_JSON", "请求体必须是 JSON 对象。");
  }
  // `locale` is not part of a birth request, so it is taken out before the request is validated.
  const { locale: requested, ...birthBody } = body ?? {};
  const birth = await readBirthRequest(new Request(request.url, { method: "POST", body: JSON.stringify(birthBody) }), SYSTEM);
  if (!birth.ok) return birth.response;
  const locale: ReadingLocale = requested === "en" ? "en" : "zh";

  let chart;
  try {
    chart = (await calculateBazi(birth.value)).data;
  } catch (error) {
    return algorithmFailure(SYSTEM, error);
  }
  const facts = buildBaziFacts(chart);

  if (baziLlmConfigured()) {
    try {
      const generated = await generateBaziReading(facts, locale);
      return Response.json(success({ source: "llm", reason: null, locale, model: generated.model, reading: generated.reading, evidence: facts.evidence }, { system: SYSTEM }));
    } catch (error) {
      const cause = error instanceof Error ? error.message : "unknown";
      return Response.json(
        success({ source: "rules", reason: "failed", locale, model: null, reading: ruleBasedReading(chart, facts, locale), evidence: facts.evidence }, { system: SYSTEM, warnings: [`LLM_FALLBACK:${cause}`] }),
      );
    }
  }
  return Response.json(success({ source: "rules", reason: "not_configured", locale, model: null, reading: ruleBasedReading(chart, facts, locale), evidence: facts.evidence }, { system: SYSTEM }));
}
