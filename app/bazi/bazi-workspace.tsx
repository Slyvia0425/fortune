"use client";

import { useEffect, useState } from "react";
import CollectionButton from "@/app/components/collection-button";
import type { ApiEnvelope } from "@/lib/contracts/api";
import type { BaziChartRequest, BaziChartResult, BirthPlace } from "@/lib/contracts/bazi";
import { CITY_OPTIONS } from "@/lib/bazi/cities";
import { module4Api } from "@/lib/module4/api";
import { getModule4UserId } from "@/lib/module4/activity";
import type { PersonProfile } from "@/lib/module4/types";
import { ElementsStep } from "./elements-step";
import { PillarsStep } from "./pillars-step";
import {
  BRANCH_LABEL,
  DISPOSITION_LABEL,
  DOMAIN_LABEL,
  STEM_LABEL,
  TEN_GOD_LABEL,
} from "@/lib/bazi/display";

type PlaceMode = "dropdown" | "manual_coordinates";

const STEPS = [
  { id: 1, label: "出生信息" },
  { id: 2, label: "四柱排盘" },
  { id: 3, label: "五行十神" },
  { id: 4, label: "大运流年" },
  { id: 5, label: "方向推荐" },
] as const;

const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const RELATION_OPTIONS = ["本人", "家人", "亲友", "客户", "研究案例", "其他"] as const;

function coordinateParts(value: number, axis: "lat" | "lng") {
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minutes = Math.round((absolute - degrees) * 60);
  const hemisphere = axis === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return { hemisphere, degrees: String(degrees), minutes: String(Math.min(minutes, 59)) };
}

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

  const [profiles, setProfiles] = useState<PersonProfile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [personName, setPersonName] = useState("本人");
  const [personRelation, setPersonRelation] = useState("本人");
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

  useEffect(() => {
    let cancelled = false;
    module4Api
      .listPersonProfiles(getModule4UserId())
      .then((records) => {
        if (!cancelled) setProfiles(records);
      })
      .catch(() => {
        // Chart calculation remains available when the personal archive is offline.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const chart = result?.result ?? null;
  const unlocked = chart !== null;

  // The envelope's mock flag is set by the Next.js service wrapper, which only
  // knows whether it reached Python — not whether Python actually computed
  // anything. The chart's own meta.mock is the authoritative one. Same for
  // warnings: Python puts them on the chart, the envelope carries its own.
  const isMock = chart?.meta?.mock ?? result?.meta.mock ?? false;
  // De-duplicated: the Next.js fallback puts the same warning on both.
  const warnings = [...new Set([...(result?.warnings ?? []), ...(chart?.meta?.warnings ?? [])])];
  const profileActivity = {
    profileId: profileId || undefined,
    personName: personName.trim() || undefined,
    personRelation,
  };

  function applyProfile(record: PersonProfile) {
    setProfileId(record.profile_id);
    setPersonName(record.name);
    setPersonRelation(record.relation || "其他");
    setDate(record.birth_date || "");
    setTime(record.birth_time || "");
    setGender((record.gender as BaziChartRequest["gender"] | null) || "unspecified");
    setCalendar(record.calendar === "lunar" ? "lunar" : "solar");

    const place = record.birth_place || {};
    const city = typeof place.city_id === "string" ? place.city_id : "";
    if (city && CITY_OPTIONS.some((option) => option.id === city)) {
      setPlaceMode("dropdown");
      setCityId(city);
    } else if (typeof place.latitude === "number" && typeof place.longitude === "number") {
      const latitude = coordinateParts(place.latitude, "lat");
      const longitude = coordinateParts(place.longitude, "lng");
      setPlaceMode("manual_coordinates");
      setLatHemisphere(latitude.hemisphere);
      setLatDegrees(latitude.degrees);
      setLatMinutes(latitude.minutes);
      setLngHemisphere(longitude.hemisphere);
      setLngDegrees(longitude.degrees);
      setLngMinutes(longitude.minutes);
    }
    setResult(null);
    setNotice("已载入人物档案，请确认出生信息后重新生成命盘。");
    setStep(1);
  }

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
    if (!personName.trim()) {
      setNotice("请填写人物名称，以便把命盘保存到独立人物档案。");
      return;
    }
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
      try {
        const savedProfile = await module4Api.savePersonProfile(getModule4UserId(), {
          profileId: profileId || undefined,
          name: personName.trim(),
          relation: personRelation,
          gender,
          calendar,
          birthDate: date,
          birthTime: time.slice(0, 5),
          birthPlace: {
            ...(place.value as unknown as Record<string, unknown>),
            city_id: placeMode === "dropdown" ? cityId : undefined,
          },
          chartSnapshot: (data.result ?? {}) as Record<string, unknown>,
          tags: ["人物档案", personRelation],
        });
        setProfileId(savedProfile.profile_id);
        setProfiles((current) => [
          savedProfile,
          ...current.filter((item) => item.profile_id !== savedProfile.profile_id),
        ]);
      } catch (profileError) {
        setNotice(
          profileError instanceof Error
            ? `排盘完成，但人物档案保存失败：${profileError.message}`
            : "排盘完成，但人物档案保存失败。",
        );
      }
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
              每个姓名会建立独立人物档案；出生时间与地点共同决定时柱，请尽量准确。
            </p>

            <div className="form-grid">
              {profiles.length > 0 && (
                <div className="field full">
                  <label htmlFor="person-profile">载入已有人物档案</label>
                  <select
                    id="person-profile"
                    onChange={(event) => {
                      const selected = profiles.find(
                        (item) => item.profile_id === event.target.value,
                      );
                      if (selected) applyProfile(selected);
                    }}
                    value={profileId}
                  >
                    <option value="">新建人物档案</option>
                    {profiles.map((profile) => (
                      <option key={profile.profile_id} value={profile.profile_id}>
                        {profile.name} · {profile.relation || "其他"}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="field">
                <label htmlFor="person-name">人物名称</label>
                <input
                  id="person-name"
                  maxLength={128}
                  onChange={(event) => {
                    const nextName = event.target.value;
                    const selected = profiles.find((item) => item.profile_id === profileId);
                    setPersonName(nextName);
                    if (selected && nextName !== selected.name) setProfileId("");
                  }}
                  placeholder="例如：本人、父亲、客户 A"
                  required
                  value={personName}
                />
              </div>

              <div className="field">
                <label htmlFor="person-relation">档案分类</label>
                <select
                  id="person-relation"
                  onChange={(event) => setPersonRelation(event.target.value)}
                  value={personRelation}
                >
                  {RELATION_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

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
              {date && time && (
                <CollectionButton
                  {...profileActivity}
                  action="question"
                  itemType="bazi_input"
                  label="收藏出生信息"
                  module="bazi"
                  sourceId={`bazi-input:${calendar}:${date}:${time.slice(0, 5)}`}
                  step="birth-input"
                  summary={`${personName.trim() || "未命名人物"} · ${calendar === "lunar" ? "农历" : "公历"} ${date} ${time.slice(0, 5)}；出生地 ${placeMode === "manual_coordinates" ? `${latDegrees}°${latMinutes}′ / ${lngDegrees}°${lngMinutes}′` : cityId}。`}
                  tags={["八字", "出生信息"]}
                  title={`${personName.trim() || "未命名人物"} · 八字出生信息`}
                  snapshot={{ birth_date: date, birth_time: time.slice(0, 5), calendar, is_leap_month: isLeapMonth, place_mode: placeMode, city_id: cityId, latitude: latDegrees, longitude: lngDegrees }}
                />
              )}
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
              chart={chart}
              isMock={isMock}
              warnings={warnings}
              profileActivity={profileActivity}
              personName={personName}
              sessionId={result?.session_id}
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
              profileActivity={profileActivity}
              personName={personName}
              sessionId={result?.session_id}
            />
            <StepNav step={step} unlocked={unlocked} onNavigate={goto} onReset={() => setStep(1)} />
          </>
        )}

        {/* ---------------------------------------------------------- */}
        {/* 04 大运流年 — display only, no interpretation                */}
        {/* ---------------------------------------------------------- */}
        {step === 4 && chart && (
          <>
            <h2>大运流年</h2>
            <p className="panel-intro">以下为推算结果展示，不含有利与否的判断。</p>

            <div className="pillars">
              {chart.luck_cycles.map((cycle) => (
                <div className="pillar" key={cycle.start_age}>
                  <small>
                    {cycle.start_age}–{cycle.end_age} 岁
                  </small>
                  <strong>
                    {STEM_LABEL[cycle.stem]}
                    {BRANCH_LABEL[cycle.branch]}
                  </strong>
                  <small>
                    {cycle.start_year}–{cycle.end_year}
                  </small>
                </div>
              ))}
            </div>

            <p className="panel-intro">
              当前：{chart.current_period.year.year} 年{" "}
              {STEM_LABEL[chart.current_period.year.stem]}
              {BRANCH_LABEL[chart.current_period.year.branch]}　
              {STEM_LABEL[chart.current_period.month.stem]}
              {BRANCH_LABEL[chart.current_period.month.branch]} 月　
              {STEM_LABEL[chart.current_period.day.stem]}
              {BRANCH_LABEL[chart.current_period.day.branch]} 日
            </p>

            <CollectionButton
              {...profileActivity}
              action="calculation"
              itemType="bazi_luck"
              label="收藏大运流年"
              module="bazi"
              sourceId={`bazi-luck:${result?.session_id ?? "local"}`}
              step="luck-cycles"
              summary={`${personName.trim() || "未命名人物"} · 大运 ${chart.luck_cycles.map((cycle) => `${cycle.start_age}-${cycle.end_age}岁 ${STEM_LABEL[cycle.stem]}${BRANCH_LABEL[cycle.branch]}`).join("；")}；当前 ${chart.current_period.year.year} 年 ${STEM_LABEL[chart.current_period.year.stem]}${BRANCH_LABEL[chart.current_period.year.branch]}。`}
              tags={["八字", "大运", "流年"]}
              title={`${personName.trim() || "未命名人物"} · 大运与当前节气`}
              snapshot={{ luck_cycles: chart.luck_cycles, current_period: chart.current_period }}
            />

            <StepNav step={step} unlocked={unlocked} onNavigate={goto} onReset={() => setStep(1)} />
          </>
        )}

        {/* ---------------------------------------------------------- */}
        {/* 05 方向推荐                                                  */}
        {/* ---------------------------------------------------------- */}
        {step === 5 && chart && (
          <>
            <h2>方向推荐</h2>
            <p className="panel-intro">
              以下为传统命理体系下的结构契合度参考，并非对现实结果的预测。
            </p>

            {chart.advisory
              .filter((domain) => domain.domain === "career")
              .map((domain) => (
                <div key={domain.domain}>
                  <p className="kicker">{DOMAIN_LABEL[domain.domain]}</p>
                  <ul>
                    {domain.categories.map((category) => (
                      <li key={category.category} style={{ marginBottom: 12 }}>
                        <strong>
                          {category.rank}. {category.display_name}
                        </strong>
                        （契合度 {category.fit_score}）
                        {category.strengths.length > 0 && (
                          <div>优点：{category.strengths.join("；")}</div>
                        )}
                        {category.considerations.length > 0 && (
                          <div>可留意：{category.considerations.join("；")}</div>
                        )}
                        <small>
                          依据：
                          {category.citations
                            .map(
                              (citation) =>
                                `${TEN_GOD_LABEL[citation.ten_god]}（${
                                  DISPOSITION_LABEL[citation.disposition]
                                } +${citation.points}）`,
                            )
                            .join("、")}
                        </small>
                      </li>
                    ))}
                  </ul>
                  <p className="panel-intro">{domain.narrative}</p>
                </div>
              ))}

            {chart.source_refs.length > 0 && (
              <p className="form-note">
                参考文献：
                {chart.source_refs
                  .map((ref) => [ref.title, ref.edition, ref.chapter].filter(Boolean).join(" · "))
                  .join("；")}
              </p>
            )}

            <CollectionButton
              {...profileActivity}
              action="interpretation"
              evidence={chart.advisory.flatMap((domain) => domain.categories.flatMap((category) => category.citations.flatMap((citation) => citation.evidence)))}
              itemType="bazi_advisory"
              label="收藏方向依据"
              module="bazi"
              sourceId={`bazi-advisory:${result?.session_id ?? "local"}`}
              step="advisory"
              summary={`${personName.trim() || "未命名人物"} · ${chart.advisory.map((domain) => `${DOMAIN_LABEL[domain.domain]}：${domain.categories.map((category) => category.display_name).join("、")}`).join("；")}`}
              tags={["八字", "方向依据"]}
              title={`${personName.trim() || "未命名人物"} · 方向推荐依据`}
              snapshot={{ advisory: chart.advisory, disposition: chart.disposition, source_refs: chart.source_refs }}
            />

            <StepNav step={step} unlocked={unlocked} onNavigate={goto} onReset={() => setStep(1)} />
          </>
        )}
      </section>
    </div>
  );
}
