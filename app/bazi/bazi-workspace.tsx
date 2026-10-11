"use client";

import { useEffect, useRef, useState } from "react";
import type { ApiEnvelope } from "@/lib/contracts/api";
import type { BaziChartRequest, BaziChartResult } from "@/lib/contracts/bazi";
import { AdvisoryStep } from "./advisory-step";
import { BirthForm } from "./birth-form";
import { ChainStep } from "./chain-step";
import { ElementsStep } from "./elements-step";
import { PillarsStep } from "./pillars-step";
import { useBirthForm } from "./use-birth-form";

const STEPS = [
  { id: 1, label: "出生信息" },
  { id: 2, label: "四柱排盘" },
  { id: 3, label: "五行十神" },
  { id: 4, label: "倾向对照" },
  { id: 5, label: "推导链路" },
] as const;

function StepNav({
  step,
  unlocked,
  onNavigate,
  onReset,
}: {
  step: number;
  unlocked: boolean;
  onNavigate: (target: number) => void;
  onReset: () => void;
}) {
  const onLastStep = step === STEPS.length;

  return (
    <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
      {step > 1 && (
        <button className="button" type="button" onClick={() => onNavigate(step - 1)}>
          上一步
        </button>
      )}
      {step < STEPS.length && unlocked && (
        <button className="button button-primary" type="button" onClick={() => onNavigate(step + 1)}>
          下一步
        </button>
      )}
      {onLastStep && (
        <button className="button button-primary" type="button" onClick={onReset}>
          重新排盘
        </button>
      )}
    </div>
  );
}

export default function BaziWorkspace() {
  const [step, setStep] = useState(1);
  const panel = useRef<HTMLElement>(null);
  const shownStep = useRef(1);
  const section = useRef<string | null>(null);        // where on the next step to land, when it is a section rather than the top
  // A new step starts at its own top, or at the section it was asked for: the form is long, so after pressing 生成命盘 the page would
  // otherwise stay at the form's scroll position and open the chart part-way down.
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    const target = (section.current && document.getElementById(section.current)) || panel.current;
    section.current = null;
    const top = target ? target.getBoundingClientRect().top + window.scrollY - 96 : 0;
    window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
  }, [step]);

  const form = useBirthForm();
  const [result, setResult] = useState<ApiEnvelope<BaziChartResult> | null>(null);
  const [submitted, setSubmitted] = useState<BaziChartRequest | null>(null);        // the request the chart on show was made from
  const [pending, setPending] = useState(false);

  const chart = result?.result ?? null;
  const unlocked = chart !== null;

  // Warnings: Python puts them on the chart, the envelope may carry its own. De-duplicated.
  const warnings = [...new Set([...(result?.warnings ?? []), ...(chart?.meta?.warnings ?? [])])];

  async function submit() {
    const built = form.buildRequest();
    if (!built.ok) {
      form.setNotice(built.message);
      return;
    }

    setPending(true);
    form.setNotice("");
    try {
      const response = await fetch("/api/bazi/chart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(built.value),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "排盘失败");
      setResult(data);
      setSubmitted(built.value);
      setStep(2);
    } catch (error) {
      form.setNotice(error instanceof Error ? error.message : "排盘失败");
    } finally {
      setPending(false);
    }
  }

  function goto(target: number, landOn?: string) {
    if (target !== 1 && !unlocked) return;
    section.current = landOn ?? null;
    setStep(target);
  }

  return (
    <div className="page-shell workspace">
      <aside className="side-steps">
        {STEPS.map((item) => {
          const locked = item.id !== 1 && !unlocked;
          return (
            <span
              key={item.id}
              className={step === item.id ? "active" : undefined}
              onClick={() => goto(item.id)}
              role="button"
              tabIndex={locked ? -1 : 0}
              aria-disabled={locked}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  goto(item.id);
                }
              }}
              style={{ cursor: locked ? "default" : "pointer", opacity: locked ? 0.4 : 1 }}
            >
              {String(item.id).padStart(2, "0")}　{item.label}
            </span>
          );
        })}
      </aside>

      <section className="panel" ref={panel}>
        {/* ---------------------------------------------------------- */}
        {/* 01 出生信息                                                  */}
        {/* ---------------------------------------------------------- */}
        {step === 1 && (
          <BirthForm form={form} pending={pending} onSubmit={submit} />
        )}

        {/* ---------------------------------------------------------- */}
        {/* 02 四柱排盘                                                  */}
        {/* ---------------------------------------------------------- */}
        {step === 2 && chart && (
          <>
            <PillarsStep chart={chart} warnings={warnings} />
            <StepNav step={step} unlocked={unlocked} onNavigate={goto} onReset={() => setStep(1)} />
          </>
        )}

        {/* ---------------------------------------------------------- */}
        {/* 03 五行十神                                                  */}
        {/* ---------------------------------------------------------- */}
        {step === 3 && chart && (
          <>
            <ElementsStep chart={chart} />
            <StepNav step={step} unlocked={unlocked} onNavigate={goto} onReset={() => setStep(1)} />
          </>
        )}

        {/* ---------------------------------------------------------- */}
        {/* 04 命局释义                                                  */}
        {/* ---------------------------------------------------------- */}
        {step === 4 && chart && (
          <>
            <AdvisoryStep chart={chart} />
            <StepNav step={step} unlocked={unlocked} onNavigate={goto} onReset={() => setStep(1)} />
          </>
        )}

        {/* ---------------------------------------------------------- */}
        {/* 05 推导链路                                                  */}
        {/* ---------------------------------------------------------- */}
        {step === 5 && chart && submitted && (
          <>
            <ChainStep chart={chart} request={submitted} onNavigate={goto} />
            <StepNav step={step} unlocked={unlocked} onNavigate={goto} onReset={() => setStep(1)} />
          </>
        )}

      </section>
    </div>
  );
}
