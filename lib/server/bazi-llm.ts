import { buildReadingRequest, checkReading, type BaziFacts, type Reading, type ReadingLocale } from "@/lib/bazi/interpretation";

type ChatCompletion = { choices?: Array<{ message?: { content?: string | null } }> };

/** The same environment variables as the other model-backed features, so one setting serves them all. */
function configuration() {
  const baseUrl = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").trim().replace(/^["']|["']$/g, "").replace(/\/$/, "");
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  const reasoningEffort = process.env.LLM_REASONING_EFFORT?.trim();
  const configuredTimeout = Number(process.env.LLM_TIMEOUT_SECONDS);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? Math.min(configuredTimeout, 600) * 1000 : 120_000;
  return { apiKey, model, reasoningEffort, timeoutMs, completionUrl: baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions` };
}

export function baziLlmConfigured() {
  const { apiKey, model } = configuration();
  return Boolean(apiKey && model);
}

/**
 * Asks the model for the reading and returns it only if it passes the checks. A failed check is sent back once with its reasons; a second
 * failure throws, and the route answers with the rule-based reading instead.
 */
export async function generateBaziReading(facts: BaziFacts, locale: ReadingLocale): Promise<{ reading: Reading; model: string }> {
  const { apiKey, model, reasoningEffort, timeoutMs, completionUrl } = configuration();
  if (!apiKey || !model) throw new Error("LLM_NOT_CONFIGURED");
  const request = buildReadingRequest(facts, locale);
  let correction = "";
  let lastError = "LLM_INVALID_READING";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(completionUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: request.systemInstruction },
          { role: "user", content: `${JSON.stringify({ payload: request.payload, output_contract: request.outputContract })}${correction}` },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`LLM_SERVICE_${response.status}`);
    const content = ((await response.json()) as ChatCompletion).choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("LLM_EMPTY_READING");
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      lastError = "LLM_INVALID_JSON";
      correction = "\n上一次输出不是有效 JSON。请重新生成，只返回严格符合 output_contract 的 JSON。";
      continue;
    }
    const checked = checkReading(value, facts, locale);
    if (checked.valid && checked.reading) return { reading: checked.reading, model };
    lastError = `LLM_INVALID_READING:${checked.errors.join("|")}`;
    correction = `\n上一次输出未通过校验：${checked.errors.join("；")}。请修正这些问题后重新返回完整 JSON。`;
  }
  throw new Error(lastError);
}
