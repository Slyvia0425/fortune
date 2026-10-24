import { bindGuanyinExplanationEvidence, buildGuanyinLlmGenerationRequest, hasMeaningfulGuanyinExplanationGain, validateGuanyinLlmExplanation, type GuanyinLlmExplanation } from "../guanyin/llm-explanation";
import type { GuanyinEvidenceIntegration, QuestionDomain } from "../guanyin/types";

type ChatCompletion = { choices?: Array<{ message?: { content?: string | null } }> };

const MAX_GENERATION_ATTEMPTS = 2;
const MAX_ATTEMPT_TIMEOUT_MS = 90_000;

function configuration() {
  const baseUrl = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").trim().replace(/^["']|["']$/g, "").replace(/\/$/, "");
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  const reasoningEffort = process.env.LLM_REASONING_EFFORT?.trim();
  const configuredTimeout = Number(process.env.LLM_TIMEOUT_SECONDS);
  const configuredTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout * 1000 : MAX_ATTEMPT_TIMEOUT_MS;
  const timeoutMs = Math.min(configuredTimeoutMs, MAX_ATTEMPT_TIMEOUT_MS);
  return { apiKey, model, reasoningEffort, timeoutMs, completionUrl: baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions` };
}

export function guanyinLlmConfigured() {
  const { apiKey, model } = configuration();
  return Boolean(apiKey && model);
}

export async function generateGuanyinExplanation(input: { question: string; domain: QuestionDomain; integration: GuanyinEvidenceIntegration; locale?: "zh" | "en" }): Promise<{ explanation: GuanyinLlmExplanation; model: string }> {
  const { apiKey, model, reasoningEffort, timeoutMs, completionUrl } = configuration();
  if (!apiKey || !model) throw new Error("LLM_NOT_CONFIGURED");
  if (input.integration.status !== "ready") throw new Error("INTEGRATION_NOT_READY");
  const request = buildGuanyinLlmGenerationRequest(input);
  let correction = "";
  let lastError = "LLM_INVALID_EXPLANATION";
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const response = await fetch(completionUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature: 0, max_tokens: 1_200, ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}), response_format: { type: "json_object" }, messages: [
        { role: "system", content: request.systemInstruction },
        { role: "user", content: `${JSON.stringify({ payload: request.payload, output_contract: request.outputContract })}${correction}` },
      ] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`LLM_SERVICE_${response.status}`);
    const payload = await response.json() as ChatCompletion;
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("LLM_EMPTY_EXPLANATION");
    let value: unknown;
    try { value = JSON.parse(content); } catch {
      lastError = "LLM_INVALID_JSON";
      correction = "\n上一次输出不是有效 JSON。请重新生成，只返回严格符合 output_contract 的 JSON。";
      continue;
    }
    const validated = validateGuanyinLlmExplanation(bindGuanyinExplanationEvidence(value, input.integration), input.integration, {
      mandatoryActionTopics: request.payload.realityBoundaries.mandatoryActionTopics,
      softActionGuidance: request.payload.realityBoundaries.softActionGuidance,
      questionDetails: request.payload.realityBoundaries.questionDetails,
    });
    if (!validated.valid || !validated.explanation) {
      lastError = `LLM_INVALID_EXPLANATION:${validated.errors.join("|")}`;
      correction = `\n上一次输出未通过校验：${validated.errors.join("；")}。请修正这些问题，减少重复，并重新返回完整 JSON。`;
      continue;
    }
    if (!hasMeaningfulGuanyinExplanationGain(validated.explanation, input.integration)) {
      lastError = "LLM_INSUFFICIENT_EXPLANATION";
      correction = "\n上一次输出只是复述结构化判断。请直接回答问题，并增加有证据支持的现实条件或可执行验证步骤；若确实无法增加，请保持列表为空。";
      continue;
    }
    return { explanation: validated.explanation, model };
  }
  throw new Error(lastError);
}
