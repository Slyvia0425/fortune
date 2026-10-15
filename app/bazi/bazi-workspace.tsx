"use client";

import { useEffect, useRef, useState } from "react";
import CollectionButton from "@/app/components/collection-button";
import type { ApiEnvelope } from "@/lib/contracts/api";
import type { BaziChartRequest, BaziChartResult } from "@/lib/contracts/bazi";
import {
  decimalToDms,
  joinDate,
  joinLunarDate,
  joinTime,
  splitDate,
  splitTime,
} from "@/lib/bazi/birth-input";
import { getModule4UserId } from "@/lib/module4/activity";
import { module4Api } from "@/lib/module4/api";
import type { PersonProfile } from "@/lib/module4/types";
import { useI18n } from "@/lib/i18n";
import { AdvisoryStep } from "./advisory-step";
import { BirthForm } from "./birth-form";
import { ChainStep } from "./chain-step";
import { ElementsStep } from "./elements-step";
import { PersonArchive } from "./person-archive";
import { PillarsStep } from "./pillars-step";
import { displayName, personKey, type BaziProfileActivity } from "./profile-activity";
import { useBirthForm } from "./use-birth-form";
import styles from "./bazi-chart.module.css";

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
  const { t } = useI18n();
  const onLastStep = step === STEPS.length;

  return (
    <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
      {step > 1 && (
        <button className="button" type="button" onClick={() => onNavigate(step - 1)}>
          {t("上一步")}
        </button>
      )}
      {step < STEPS.length && unlocked && (
        <button className="button button-primary" type="button" onClick={() => onNavigate(step + 1)}>
          {t("下一步")}
        </button>
      )}
      {onLastStep && (
        <button className="button button-primary" type="button" onClick={onReset}>
          {t("重新排盘")}
        </button>
      )}
    </div>
  );
}

export default function BaziWorkspace() {
  const { t } = useI18n();
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
  const [profileNotice, setProfileNotice] = useState("");

  // Who the chart belongs to. Kept beside the form rather than inside it: it is
  // not an input to the calculation, only a name the records are filed under.
  const [profiles, setProfiles] = useState<PersonProfile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [personName, setPersonName] = useState("本人");
  const [personRelation, setPersonRelation] = useState<string>("本人");

  useEffect(() => {
    let cancelled = false;
    module4Api
      .listPersonProfiles(getModule4UserId())
      .then((records) => {
        if (!cancelled) setProfiles(records);
      })
      .catch(() => {
        // The chart still computes when the personal archive is unreachable.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const chart = result?.result ?? null;
  const unlocked = chart !== null;

  const profileActivity: BaziProfileActivity = {
    profileId: profileId || undefined,
    personName: personName.trim() || undefined,
    personRelation,
  };

  /** Fills the form from a stored profile. The chart is cleared: the stored one may no longer match the inputs. */
  function applyProfile(record: PersonProfile) {
    setProfileId(record.profile_id);
    setPersonName(record.name);
    setPersonRelation(record.relation || "其他");
    form.setCalendar(record.calendar === "lunar" ? "lunar" : "solar");
    if (record.calendar === "lunar") {
      const [year = "", month = "1", day = "1"] = (record.birth_date ?? "").split("-");
      form.setLunar({ year, month: String(Number(month)), day: String(Number(day)) });
    } else {
      form.setDateParts(splitDate(record.birth_date ?? ""));
    }
    form.setTimeParts(splitTime(record.birth_time ?? ""));
    form.setGender((record.gender as BaziChartRequest["gender"]) ?? "");
    form.setIsLeapMonth(false);        // the profile does not carry the leap-month flag; the date check above will say if it is needed

    const place = record.birth_place ?? {};
    const cityId = typeof place.city_id === "string" ? place.city_id : "";
    const cityName = typeof place.city === "string" ? place.city : "";
    if (cityId && cityName && typeof place.latitude === "number" && typeof place.longitude === "number") {
      form.setPlaceMode("dropdown");
      form.chooseCity({
        id: cityId,
        name: cityName,
        country_code: typeof place.country_code === "string" ? place.country_code : "",
        latitude: place.latitude,
        longitude: place.longitude,
        timezone: typeof place.timezone === "string" ? place.timezone : "",
      });
    } else if (typeof place.latitude === "number" && typeof place.longitude === "number") {
      form.setPlaceMode("manual_coordinates");
      form.setLat(decimalToDms("lat", place.latitude));
      form.setLng(decimalToDms("lng", place.longitude));
    }

    setResult(null);
    setSubmitted(null);
    setStep(1);
    form.setNotice(t("已载入人物档案，请确认出生信息后重新生成命盘。"));
  }

  function clearProfile() {
    setProfileId("");
    setPersonName("本人");
    setPersonRelation("本人");
  }

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
    setProfileNotice("");
    try {
      const response = await fetch("/api/bazi/chart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(built.value),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? t("排盘失败"));
      // The chart is stored against the person whose birthday it is: the agent
      // reads a person's records back as one history, so an unnamed chart would
      // be unusable later. A failure here must not cost the user the chart.
      try {
        const saved = await module4Api.savePersonProfile(getModule4UserId(), {
          profileId: profileId || undefined,
          name: personName.trim() || "未命名人物",
          relation: personRelation,
          gender: built.value.gender,
          calendar: built.value.calendar,
          birthDate: built.value.birth_date,
          birthTime: built.value.birth_time,
          birthPlace: built.value.birth_place as unknown as Record<string, unknown>,
          chartSnapshot: (data.result ?? {}) as Record<string, unknown>,
          tags: ["人物档案", personRelation],
        });
        setProfileId(saved.profile_id);
        setProfiles((current) => [
          saved,
          ...current.filter((item) => item.profile_id !== saved.profile_id),
        ]);
      } catch (profileError) {
        setProfileNotice(
          profileError instanceof Error
            ? t("排盘完成，但人物档案未能保存：{message}", { message: profileError.message })
            : t("排盘完成，但人物档案未能保存。"),
        );
      }
      setResult(data);
      setSubmitted(built.value);
      setStep(2);
    } catch (error) {
      form.setNotice(error instanceof Error ? error.message : t("排盘失败"));
    } finally {
      setPending(false);
    }
  }

  function goto(target: number, landOn?: string) {
    if (target !== 1 && !unlocked) return;
    section.current = landOn ?? null;
    setStep(target);
  }

  // The birth input as it stands in the form, for the record the user can file
  // before the chart is even computed.
  const birthDateText =
    form.calendar === "lunar"
      ? joinLunarDate(form.lunar.year, form.lunar.month, form.lunar.day)
      : joinDate(form.dateParts);
  const birthTimeText = joinTime(form.timeParts);
  const birthPlaceText =
    form.placeMode === "dropdown"
      ? form.city?.name ?? t("未选择城市")
      : `${form.lat.degrees}°${form.lat.minutes}′${form.lat.hemisphere} / ${form.lng.degrees}°${form.lng.minutes}′${form.lng.hemisphere}`;

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
              {String(item.id).padStart(2, "0")}　{t(item.label)}
            </span>
          );
        })}
      </aside>

      <section className="panel bazi-panel" ref={panel}>
        {profileNotice ? <p className="notice">{profileNotice}</p> : null}

        {/* ---------------------------------------------------------- */}
        {/* 01 出生信息                                                  */}
        {/* ---------------------------------------------------------- */}
        {step === 1 && (
          <>
            <PersonArchive
              profiles={profiles}
              profileId={profileId}
              personName={personName}
              personRelation={personRelation}
              onName={setPersonName}
              onRelation={setPersonRelation}
              onSelect={applyProfile}
              onClear={clearProfile}
            />
            <BirthForm form={form} pending={pending} onSubmit={submit} />
            {birthDateText && birthTimeText ? (
              <div className={styles.collectRow}>
                <CollectionButton
                  {...profileActivity}
                  action="question"
                  evidence={[`${form.calendar === "lunar" ? "农历" : "公历"} ${birthDateText} ${birthTimeText}`, `出生地 ${birthPlaceText}`]}
                  itemType="bazi_input"
                  label="收藏出生信息"
                  module="bazi"
                  sourceId={`bazi-input:${personKey(profileActivity)}:${form.calendar}:${birthDateText}:${birthTimeText}`}
                  step="birth-input"
                  summary={`${displayName(profileActivity)} · ${form.calendar === "lunar" ? "农历" : "公历"} ${birthDateText} ${birthTimeText}；出生地 ${birthPlaceText}。`}
                  tags={["八字", "出生信息"]}
                  title={`${displayName(profileActivity)} · 八字出生信息`}
                  snapshot={{
                    birth_date: birthDateText,
                    birth_time: birthTimeText,
                    calendar: form.calendar,
                    is_leap_month: form.isLeapMonth,
                    place_mode: form.placeMode,
                    place: birthPlaceText,
                  }}
                />
              </div>
            ) : null}
          </>
        )}

        {/* ---------------------------------------------------------- */}
        {/* 02 四柱排盘                                                  */}
        {/* ---------------------------------------------------------- */}
        {step === 2 && chart && (
          <>
            <PillarsStep chart={chart} warnings={warnings} profileActivity={profileActivity} />
            <StepNav step={step} unlocked={unlocked} onNavigate={goto} onReset={() => setStep(1)} />
          </>
        )}

        {/* ---------------------------------------------------------- */}
        {/* 03 五行十神                                                  */}
        {/* ---------------------------------------------------------- */}
        {step === 3 && chart && (
          <>
            <ElementsStep chart={chart} profileActivity={profileActivity} />
            <StepNav step={step} unlocked={unlocked} onNavigate={goto} onReset={() => setStep(1)} />
          </>
        )}

        {/* ---------------------------------------------------------- */}
        {/* 04 命局释义                                                  */}
        {/* ---------------------------------------------------------- */}
        {step === 4 && chart && (
          <>
            <AdvisoryStep chart={chart} profileActivity={profileActivity} />
            <StepNav step={step} unlocked={unlocked} onNavigate={goto} onReset={() => setStep(1)} />
          </>
        )}

        {/* ---------------------------------------------------------- */}
        {/* 05 推导链路                                                  */}
        {/* ---------------------------------------------------------- */}
        {step === 5 && chart && submitted && (
          <>
            <ChainStep chart={chart} request={submitted} onNavigate={goto} profileActivity={profileActivity} />
            <StepNav step={step} unlocked={unlocked} onNavigate={goto} onReset={() => setStep(1)} />
          </>
        )}

      </section>
    </div>
  );
}
