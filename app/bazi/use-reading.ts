import { useEffect, useMemo, useState } from "react";
import type { BaziChartRequest } from "@/lib/contracts/bazi";
import type { EvidenceItem, Reading } from "@/lib/bazi/interpretation";
import { useI18n } from "@/lib/i18n";

export interface ReadingResult {
  source: "llm" | "rules";
  /** Why the templates were used: no model is connected, or the model's answer did not pass the checks. */
  reason: "not_configured" | "failed" | null;
  model: string | null;
  reading: Reading;
  evidence: EvidenceItem[];
}

export interface ReadingState {
  status: "idle" | "loading" | "done" | "error";
  result: ReadingResult | null;
  regenerate: () => void;
}

type Settled = { key: string; ok: boolean; result: ReadingResult | null };

/**
 * 现代解读 for the chart on show. It starts as soon as the engine has returned the chart, so the text is usually ready by the time the
 * reader reaches it, and starts again when the interface language changes or on request. While a new one is being written the last one
 * stays on screen, dimmed.
 */
export function useBaziReading(request: BaziChartRequest | null): ReadingState {
  const { locale } = useI18n();
  const [nonce, setNonce] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const key = useMemo(() => (request ? JSON.stringify([request, locale, nonce]) : ""), [request, locale, nonce]);

  useEffect(() => {
    if (!request) return;
    let current = true;
    fetch("/api/bazi/interpret", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...request, locale }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message ?? "reading failed");
        if (current) setSettled({ key, ok: true, result: data.result as ReadingResult });
      })
      .catch(() => {
        if (current) setSettled((previous) => ({ key, ok: false, result: previous?.result ?? null }));
      });
    return () => {
      current = false;
    };
  }, [request, locale, key]);

  if (!request) return { status: "idle", result: null, regenerate: () => {} };
  const regenerate = () => setNonce((value) => value + 1);
  if (settled?.key === key) return { status: settled.ok ? "done" : "error", result: settled.result, regenerate };
  return { status: "loading", result: settled?.result ?? null, regenerate };
}
