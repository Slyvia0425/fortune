"use client";

import { useState } from "react";
import type { ApiEnvelope } from "@/lib/contracts/api";
import type { BaziChartRequest, BaziChartResult, BirthPlace } from "@/lib/contracts/bazi";
import { CITY_OPTIONS } from "@/lib/bazi/cities";
import { ElementsStep } from "./elements-step";
import { AdvisoryStep } from "./advisory-step";
import { PillarsStep } from "./pillars-step";

type PlaceMode = "dropdown" | "manual_coordinates";

const STEPS = [
  { id: 1, label: "出生信息" },
  { id: 2, label: "四柱排盘" },
  { id: 3, label: "五行十神" },
  { id: 4, label: "倾向对照" },
] as const;

const MINUTES = Array.from({ length: 60 }, (_, i) => i);

/**
 * Compact segmented control for binary choices.
 *
 * Styled with border weight and opacity rather than a fill colour, so it sits
 * correctly in any theme without hardcoding brand colours.
 */
function Toggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <span style={{ display: "inline-flex", gap: 2, verticalAlign: "middle" }}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            style={{
              padding: "1px 9px",
              fontSize: "0.8em",
              fontWeight: selected ? 600 : 400,
              lineHeight: 1.7,
              cursor: "pointer",
              background: "transparent",
              color: "inherit",
              border: "1px solid",
              borderColor: selected ? "currentColor" : "transparent",
              borderRadius: 3,
              opacity: selected ? 1 : 0.45,
            }}
          >
            {option.label}
          </button>
        );
      })}
    </span>
  );
}

/**
 * Degrees-and-minutes coordinate entry.
 *
 * Bounding each part separately keeps the value valid by construction — there
 * is no way to type a nonsense coordinate the way a free-text field allows.
 */
function DmsField({
  id,
  label,
  hemispheres,
  maxDegrees,
  hemisphere,
  degrees,
  minutes,
  onHemisphere,
  onDegrees,
  onMinutes,
}: {
  id: string;
  label: string;
  hemispheres: Array<{ value: string; label: string }>;
  maxDegrees: number;
  hemisphere: string;
  degrees: string;
  minutes: string;
  onHemisphere: (v: string) => void;
  onDegrees: (v: string) => void;
  onMinutes: (v: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={`${id}-deg`}>{label}</label>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <select
          aria-label={`${label}半球`}
          value={hemisphere}
          onChange={(e) => onHemisphere(e.target.value)}
          style={{ width: "auto" }}
        >
          {hemispheres.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          id={`${id}-deg`}
          // type="number" only enforces min/max on submit — it happily accepts
          // "+", "-", "e", decimals and arbitrarily large values while typing.
          // A filtered text input keeps the value valid at every keystroke.
          type="text"
          inputMode="numeric"
          maxLength={3}
          value={degrees}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "");
            if (digits === "") {
              onDegrees("");
              return;
            }
            onDegrees(String(Math.min(Number(digits), maxDegrees)));
          }}
          style={{ width: "5em", textAlign: "center" }}
        />
        <span>度</span>
        <select
          aria-label={`${label}分`}
          value={minutes}
          onChange={(e) => onMinutes(e.target.value)}
          style={{ width: "auto" }}
        >
          {MINUTES.map((m) => (
            <option key={m} value={String(m)}>
              {m}
            </option>
          ))}
        </select>
        <span>分</span>
      </span>
    </div>
  );
}

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

  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [gender, setGender] = useState<BaziChartRequest["gender"]>("unspecified");
  const [calendar, setCalendar] = useState<"solar" | "lunar">("solar");
  const [isLeapMonth, setIsLeapMonth] = useState(false);

  const [placeMode, setPlaceMode] = useState<PlaceMode>("dropdown");
  const [cityId, setCityId] = useState(CITY_OPTIONS[0].id);
  const [latHemisphere, setLatHemisphere] = useState("N");
  const [latDegrees, setLatDegrees] = useState("");
  const [latMinutes, setLatMinutes] = useState("0");
  const [lngHemisphere, setLngHemisphere] = useState("E");
  const [lngDegrees, setLngDegrees] = useState("");
  const [lngMinutes, setLngMinutes] = useState("0");

  const [result, setResult] = useState<ApiEnvelope<BaziChartResult> | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");

  const chart = result?.result ?? null;
  const unlocked = chart !== null;

  // The envelope's mock flag is set by the Next.js service wrapper, which only
  // knows whether it reached Python — not whether Python actually computed
  // anything. The chart's own meta.mock is the authoritative one. Same for
  // warnings: Python puts them on the chart, the envelope carries its own.
  const isMock = chart?.meta?.mock ?? result?.meta.mock ?? false;
  // De-duplicated: the Next.js fallback puts the same warning on both.
  const warnings = [...new Set([...(result?.warnings ?? []), ...(chart?.meta?.warnings ?? [])])];

  /** Builds the structured birth_place the contract expects, or explains why it can't. */
  function buildBirthPlace(): { ok: true; value: BirthPlace } | { ok: false; message: string } {
    if (placeMode === "dropdown") {
      const city = CITY_OPTIONS.find((option) => option.id === cityId);
      if (!city) return { ok: false, message: "请选择出生城市。" };
      return {
        ok: true,
        value: {
          country_code: city.country_code,
          country: city.country,
          city: city.city,
          latitude: city.latitude,
          longitude: city.longitude,
          source: "dropdown",
        },
      };
    }

    const latDeg = Number(latDegrees);
    const lngDeg = Number(lngDegrees);

    if (latDegrees.trim() === "" || !Number.isInteger(latDeg) || latDeg < 0 || latDeg > 90) {
      return { ok: false, message: "纬度的「度」必须是 0 到 90 之间的整数。" };
    }
    if (latDeg === 90 && Number(latMinutes) !== 0) {
      return { ok: false, message: "纬度 90 度时，分必须为 0。" };
    }
    if (lngDegrees.trim() === "" || !Number.isInteger(lngDeg) || lngDeg < 0 || lngDeg > 180) {
      return { ok: false, message: "经度的「度」必须是 0 到 180 之间的整数。" };
    }
    if (lngDeg === 180 && Number(lngMinutes) !== 0) {
      return { ok: false, message: "经度 180 度时，分必须为 0。" };
    }

    const latitude = (latHemisphere === "N" ? 1 : -1) * (latDeg + Number(latMinutes) / 60);
    const longitude = (lngHemisphere === "E" ? 1 : -1) * (lngDeg + Number(lngMinutes) / 60);

    return {
      ok: true,
      value: {
        // Rounded to avoid trailing float noise; well below the precision that
        // would shift true solar time by even a second.
        latitude: Number(latitude.toFixed(6)),
        longitude: Number(longitude.toFixed(6)),
        source: "manual_coordinates",
      },
    };
  }

  async function submit() {
    if (!date || !time) {
      setNotice("请填写出生日期和时间。");
      return;
    }

    const place = buildBirthPlace();
    if (!place.ok) {
      setNotice(place.message);
      return;
    }

    // Some browsers return "HH:mm:ss" from a time input; the contract wants "HH:mm".
    const payload: BaziChartRequest = {
      birth_date: date,
      birth_time: time.slice(0, 5),
      birth_place: place.value,
      gender,
      calendar,
      ...(calendar === "lunar" ? { is_leap_month: isLeapMonth } : {}),
    };

    setPending(true);
    setNotice("");
    try {
      const response = await fetch("/api/bazi/chart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "排盘失败");
      setResult(data);
      setStep(2);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "排盘失败");
    } finally {
      setPending(false);
    }
  }

  function goto(target: number) {
    if (target !== 1 && !unlocked) return;
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

      <section className="panel">
        {/* ---------------------------------------------------------- */}
        {/* 01 出生信息                                                  */}
        {/* ---------------------------------------------------------- */}
        {step === 1 && (
          <>
            <h2>出生信息</h2>
            <p className="panel-intro">
              仅用于本次排盘演示，不要求填写真实姓名。出生时间与地点共同决定时柱，请尽量准确。
            </p>

            <div className="form-grid">
              <div className="field">
                <label
                  htmlFor="date"
                  style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
                >
                  出生日期
                  <Toggle
                    value={calendar}
                    onChange={setCalendar}
                    options={[
                      { value: "solar", label: "公历" },
                      { value: "lunar", label: "农历" },
                    ]}
                  />
                </label>
                <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                {calendar === "lunar" && (
                  /* Deliberately not .form-note — that class is styled for
                     full-width notes in the grid and stretches this row. */
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-start",
                      gap: 6,
                      marginTop: 8,
                      fontSize: "0.82em",
                      fontWeight: 400,
                      opacity: 0.65,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isLeapMonth}
                      onChange={(e) => setIsLeapMonth(e.target.checked)}
                      style={{ margin: 0, flex: "0 0 auto", width: "auto" }}
                    />
                    <span>出生于闰月（不确定可不勾选）</span>
                  </label>
                )}
              </div>

              <div className="field">
                <label htmlFor="time">出生时间</label>
                <input id="time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>

              <div className="field">
                <label
                  htmlFor="city"
                  style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
                >
                  出生地点
                  <Toggle
                    value={placeMode}
                    onChange={setPlaceMode}
                    options={[
                      { value: "dropdown", label: "选城市" },
                      { value: "manual_coordinates", label: "填经纬度" },
                    ]}
                  />
                </label>
                <select
                  id="city"
                  value={cityId}
                  onChange={(e) => setCityId(e.target.value)}
                  disabled={placeMode === "manual_coordinates"}
                >
                  {CITY_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.country} · {option.city}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="gender">性别（用于大运顺逆）</label>
                <select
                  id="gender"
                  value={gender}
                  onChange={(e) => setGender(e.target.value as BaziChartRequest["gender"])}
                >
                  <option value="female">女</option>
                  <option value="male">男</option>
                  <option value="unspecified">不便说明</option>
                </select>
              </div>

              {placeMode === "manual_coordinates" && (
                <>
                  <DmsField
                    id="lng"
                    label="经度"
                    maxDegrees={180}
                    hemispheres={[
                      { value: "E", label: "东经" },
                      { value: "W", label: "西经" },
                    ]}
                    hemisphere={lngHemisphere}
                    degrees={lngDegrees}
                    minutes={lngMinutes}
                    onHemisphere={setLngHemisphere}
                    onDegrees={setLngDegrees}
                    onMinutes={setLngMinutes}
                  />
                  <DmsField
                    id="lat"
                    label="纬度"
                    maxDegrees={90}
                    hemispheres={[
                      { value: "N", label: "北纬" },
                      { value: "S", label: "南纬" },
                    ]}
                    hemisphere={latHemisphere}
                    degrees={latDegrees}
                    minutes={latMinutes}
                    onHemisphere={setLatHemisphere}
                    onDegrees={setLatDegrees}
                    onMinutes={setLatMinutes}
                  />
                </>
              )}

              <p className="form-note">
                提示：真太阳时、节气交界与历法校准会影响专业排盘。演示结果不用于现实决策。
              </p>
              {notice && <p className="notice">{notice}</p>}
              <button className="button button-primary" disabled={pending} onClick={submit}>
                {pending ? "排盘中……" : "生成命盘"}
              </button>
            </div>
          </>
        )}

        {/* ---------------------------------------------------------- */}
        {/* 02 四柱排盘                                                  */}
        {/* ---------------------------------------------------------- */}
        {step === 2 && chart && (
          <>
            <PillarsStep chart={chart} isMock={isMock} warnings={warnings} />
            <StepNav step={step} unlocked={unlocked} onNavigate={goto} onReset={() => setStep(1)} />
          </>
        )}

        {/* ---------------------------------------------------------- */}
        {/* 03 五行十神                                                  */}
        {/* ---------------------------------------------------------- */}
        {step === 3 && chart && (
          <>
            <ElementsStep chart={chart} isMock={isMock} />
            <StepNav step={step} unlocked={unlocked} onNavigate={goto} onReset={() => setStep(1)} />
          </>
        )}

        {/* ---------------------------------------------------------- */}
        {/* 04 命局释义                                                  */}
        {/* ---------------------------------------------------------- */}
        {step === 4 && chart && (
          <>
            <AdvisoryStep chart={chart} isMock={isMock} />
            <StepNav step={step} unlocked={unlocked} onNavigate={goto} onReset={() => setStep(1)} />
          </>
        )}

      </section>
    </div>
  );
}
