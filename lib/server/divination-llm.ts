import type { CastingMethod, DivinationChatMessage } from "@/lib/contracts/divination";

export interface DivinationIntent {
  question: string;
  timeRange?: string;
  method?: CastingMethod;
  numbers?: number[];
}

type ChatCompletion = { choices?: Array<{ message?: { content?: string | null } }> };

const baseUrl = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").trim().replace(/^\\?["']|\\?["']$/g, "").replace(/\/$/, "");
const apiKey = process.env.LLM_API_KEY;
const model = process.env.LLM_MODEL;
const completionUrl = baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`;

export function divinationLlmConfigured() {
  return Boolean(apiKey && model);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseIntent(content: string): DivinationIntent | null {
  const value = asRecord(JSON.parse(content));
  if (!value || typeof value.question !== "string" || !value.question.trim()) return null;
  const method = value.method === "numbers" || value.method === "random" || value.method === "coins" ? value.method : undefined;
  const timeRange = typeof value.time_range === "string" && value.time_range.trim() ? value.time_range.trim().slice(0, 80) : undefined;
  const numbers = Array.isArray(value.numbers)
    ? value.numbers.filter((number): number is number => typeof number === "number" && Number.isSafeInteger(number) && number > 0 && number <= 999_999).slice(0, 3)
    : undefined;
  return { question: value.question.trim().slice(0, 500), timeRange, method, numbers };
}

export async function extractDivinationIntent(messages: DivinationChatMessage[]): Promise<DivinationIntent | null> {
  if (!divinationLlmConfigured()) return null;
  const response = await fetch(completionUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You extract a Chinese divination request into JSON only. Return exactly {question:string,time_range:string|null,method:'numbers'|'random'|'coins',numbers:number[]}. Keep relative dates such as 今天、明天、下周、未来三个月. If the user did not explicitly choose a casting method or give numbers, use method 'random'. Use method 'numbers' only when two or three valid positive integers are supplied. Never calculate or interpret a hexagram."
        },
        ...messages.map(message => ({ role: message.role, content: message.content }))
      ]
    }),
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`LLM_SERVICE_${response.status}`);
  const payload = await response.json() as ChatCompletion;
  const content = payload.choices?.[0]?.message?.content;
  return typeof content === "string" ? parseIntent(content) : null;
}
