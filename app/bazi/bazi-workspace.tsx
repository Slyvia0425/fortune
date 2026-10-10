"use client";

import { useEffect, useState } from "react";
import type { ApiEnvelope } from "@/lib/contracts/api";
import type { BaziChartRequest, BaziChartResult, BirthPlace, EvidenceRef } from "@/lib/contracts/bazi";
import type { CityHit } from "@/lib/bazi/city-search";
import type { LunarCheck } from "@/lib/bazi/lunar-check";
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
  const [gender, setGender] = useState<BaziChartRequest["gender"] | "">("");
  const [calendar, setCalendar] = useState<"solar" | "lunar">("solar");
  const [isLeapMonth, setIsLeapMonth] = useState(false);
  // A lunar date cannot go through <input type="date">: 二月三十 is a real lunar
  // date but not a Gregorian one, so the browser would refuse to hold it.
  const [lunarYear, setLunarYear] = useState("");
  const [lunarMonth, setLunarMonth] = useState("1");
  const [lunarDay, setLunarDay] = useState("1");

  const [placeMode, setPlaceMode] = useState<PlaceMode>("dropdown");
  // Result of the server-side lunar-date check, keyed by the input it was run on
  // so a stale answer is never shown against a newer date.
  const [lunarResult, setLunarResult] = useState<{ key: string; check: LunarCheck } | null>(null);
  // Set when the user follows an evidence reference from the strength breakdown
  // to the character it names; seq re-mounts the pillars page for each new one.
  const [evidenceFocus, setEvidenceFocus] = useState<{ ref: EvidenceRef; seq: number } | null>(null);
  const [cityQuery, setCityQuery] = useState("");
  const [cityHits, setCityHits] = useState<CityHit[]>([]);
  const [city, setCity] = useState<CityHit | null>(null);
  const [cityLoading, setCityLoading] = useState(false);
  const [latHemisphere, setLatHemisphere] = useState("N");
  const [latDegrees, setLatDegrees] = useState("");
  const [latMinutes, setLatMinutes] = useState("0");
  const [lngHemisphere, setLngHemisphere] = useState("E");
  const [lngDegrees, setLngDegrees] = useState("");
  const [lngMinutes, setLngMinutes] = useState("0");

  const [result, setResult] = useState<ApiEnvelope<BaziChartResult> | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");

  const lunarDate = /^\d{4}$/.test(lunarYear)
    ? `${lunarYear}-${lunarMonth.padStart(2, "0")}-${lunarDay.padStart(2, "0")}`
    : "";
  const birthDate = calendar === "lunar" ? lunarDate : date;
  const lunarKey = `${lunarDate}|${isLeapMonth}`;
  useEffect(() => {
    if (calendar !== "lunar" || !lunarDate) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/bazi/lunar?date=${lunarDate}&leap=${isLeapMonth}`, {
          signal: controller.signal,
        });
        const data: ApiEnvelope<LunarCheck> = await res.json();
        if (data.result) setLunarResult({ key: lunarKey, check: data.result });
      } catch {
        // network failure: leave unchecked; the server rejects a bad date at submit anyway
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [calendar, lunarDate, isLeapMonth, lunarKey]);

  const lunarCheck = calendar === "lunar" && lunarResult?.key === lunarKey ? lunarResult.check : null;
  const lunarMessage = lunarCheck && !lunarCheck.valid ? lunarCheck.message : null;

  // Debounced GeoNames search. Typing after a selection clears it (see onChange).
  useEffect(() => {
    const q = cityQuery.trim();
    if (!q || (city && city.name === q)) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setCityLoading(true);
      try {
        const res = await fetch(`/api/bazi/cities?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        const data: ApiEnvelope<CityHit[]> = await res.json();
        setCityHits(data.result ?? []);
      } catch {
        if (!controller.signal.aborted) setCityHits([]);
      } finally {
        if (!controller.signal.aborted) setCityLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [cityQuery, city]);

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
      if (!city) return { ok: false, message: "请从搜索结果中选择出生城市。" };
      return {
        ok: true,
        value: {
          country_code: city.country_code,
          city: city.name,
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
    if (!birthDate || !time) {
      setNotice("请填写出生日期和时间。");
      return;
    }

    if (!gender) {
      setNotice("请选择性别（用于确定大运顺逆）。");
      return;
    }

    if (calendar === "lunar" && lunarMessage) {
      setNotice(lunarMessage);
      return;
    }

    const place = buildBirthPlace();
    if (!place.ok) {
      setNotice(place.message);
      return;
    }

    // Some browsers return "HH:mm:ss" from a time input; the contract wants "HH:mm".
    const payload: BaziChartRequest = {
      birth_date: birthDate,
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
    if (target === 2) setEvidenceFocus((prev) => (prev ? null : prev));
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
                {calendar === "solar" ? (
                  <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                ) : (
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      id="date"
                      type="number"
                      inputMode="numeric"
                      min={1900}
                      max={2100}
                      placeholder="年（1900–2100）"
                      aria-label="农历年"
                      value={lunarYear}
                      onChange={(e) => setLunarYear(e.target.value)}
                    />
                    <select
                      aria-label="农历月"
                      value={lunarMonth}
                      onChange={(e) => setLunarMonth(e.target.value)}
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                        <option key={m} value={String(m)}>
                          {m} 月
                        </option>
                      ))}
                    </select>
                    <select aria-label="农历日" value={lunarDay} onChange={(e) => setLunarDay(e.target.value)}>
                      {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={String(d)}>
                          {d} 日
                        </option>
                      ))}
                    </select>
                  </div>
                )}
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
                {lunarMessage && (
                  <small role="alert" style={{ color: "var(--red, #a13b31)" }}>
                    {lunarMessage}
                  </small>
                )}
                {lunarCheck?.valid && lunarCheck.solar_date && (
                  <small style={{ opacity: 0.7 }}>对应公历 {lunarCheck.solar_date}</small>
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
                <input
                  id="city"
                  type="text"
                  autoComplete="off"
                  placeholder="输入城市英文名，如 Shanghai"
                  value={cityQuery}
                  disabled={placeMode === "manual_coordinates"}
                  onChange={(e) => {
                    setCityQuery(e.target.value);
                    setCity(null);
                    if (!e.target.value.trim()) setCityHits([]);
                  }}
                />
                {placeMode === "dropdown" && cityHits.length > 0 && (
                  <ul
                    role="listbox"
                    style={{ listStyle: "none", margin: 0, padding: 0, border: "1px solid var(--line)" }}
                  >
                    {cityHits.map((hit) => (
                      <li key={hit.id} role="option" aria-selected={false}>
                        <button
                          type="button"
                          style={{ width: "100%", textAlign: "left", padding: "9px 12px", background: "transparent", border: 0, cursor: "pointer" }}
                          onClick={() => {
                            setCity(hit);
                            setCityQuery(hit.name);
                            setCityHits([]);
                          }}
                        >
                          {hit.name}
                          {hit.alias ? ` (${hit.alias})` : ""} · {hit.country_code}
                          <small style={{ opacity: 0.6 }}>
                            {"  "}
                            {hit.latitude.toFixed(2)}, {hit.longitude.toFixed(2)}
                          </small>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {placeMode === "dropdown" && (
                  <small style={{ opacity: 0.7 }}>
                    {city
                      ? `已选：${city.name}（${city.country_code}），经度 ${city.longitude.toFixed(2)}°`
                      : cityLoading
                        ? "搜索中…"
                        : "城市数据来自 GeoNames，暂只支持英文名；找不到可切换到「填经纬度」。"}
                  </small>
                )}
              </div>

              <div className="field">
                <label htmlFor="gender">性别（用于大运顺逆）</label>
                <select
                  id="gender"
                  value={gender}
                  onChange={(e) => setGender(e.target.value as BaziChartRequest["gender"] | "")}
                >
                  <option value="">请选择</option>
                  <option value="female">女</option>
                  <option value="male">男</option>
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
            <PillarsStep
              key={evidenceFocus?.seq ?? 0}
              chart={chart}
              isMock={isMock}
              warnings={warnings}
              focus={evidenceFocus?.ref ?? null}
            />
            <StepNav step={step} unlocked={unlocked} onNavigate={goto} onReset={() => setStep(1)} />
          </>
        )}

        {/* ---------------------------------------------------------- */}
        {/* 03 五行十神                                                  */}
        {/* ---------------------------------------------------------- */}
        {step === 3 && chart && (
          <>
            <ElementsStep
              chart={chart}
              isMock={isMock}
              onShowEvidence={(ref) => {
                setEvidenceFocus((prev) => ({ ref, seq: (prev?.seq ?? 0) + 1 }));
                setStep(2);
              }}
            />
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
