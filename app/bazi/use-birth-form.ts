import { useEffect, useState } from "react";
import type { ApiEnvelope } from "@/lib/contracts/api";
import type { BaziChartRequest, BirthPlace } from "@/lib/contracts/bazi";
import type { CityHit } from "@/lib/bazi/city-search";
import type { LunarCheck } from "@/lib/bazi/lunar-check";
import {
  type DateParts, type Dms, type TimeParts,
  decimalToDms, dmsToDecimal, emptyDms, joinDate, joinLunarDate, joinTime, splitDate, splitTime,
} from "@/lib/bazi/birth-input";
import classic from "@/lib/bazi/classic-cases.json";

/**
 * The birth form's state and what it does: the typed-in parts, the lunar-date check and the city search that run while the
 * user types, the classical-case shortcut, and turning the whole into the request the chart route takes. The component that
 * draws the form (birth-form.tsx) and the one that sends the request (bazi-workspace.tsx) know nothing of each other.
 */

export type Calendar = "solar" | "lunar";
export type PlaceMode = "dropdown" | "manual_coordinates";
export type Gender = BaziChartRequest["gender"] | "";
export type ClassicCase = (typeof classic.cases)[number];

const SEARCH_DELAY_MS = 250;

export function useBirthForm() {
  const [dateParts, setDateParts] = useState<DateParts>({ y: "", m: "", d: "" });
  const [timeParts, setTimeParts] = useState<TimeParts>({ h: "", min: "" });
  const [gender, setGender] = useState<Gender>("");
  const [calendar, setCalendar] = useState<Calendar>("solar");
  const [isLeapMonth, setIsLeapMonth] = useState(false);
  const [lunar, setLunar] = useState({ year: "", month: "1", day: "1" });

  const [placeMode, setPlaceMode] = useState<PlaceMode>("dropdown");
  const [cityQuery, setCityQuery] = useState("");
  const [cityHits, setCityHits] = useState<CityHit[]>([]);
  const [city, setCity] = useState<CityHit | null>(null);
  const [cityLoading, setCityLoading] = useState(false);
  const [lat, setLat] = useState<Dms>(emptyDms("lat"));
  const [lng, setLng] = useState<Dms>(emptyDms("lng"));

  // What the form has to say about itself: what is missing, or why the chart could not be made.
  const [notice, setNotice] = useState("");

  const [classicCase, setClassicCase] = useState<ClassicCase | null>(null);
  const [classicCaseOpen, setClassicCaseOpen] = useState(true);

  const date = joinDate(dateParts);
  const time = joinTime(timeParts);
  const lunarDate = joinLunarDate(lunar.year, lunar.month, lunar.day);
  const birthDate = calendar === "lunar" ? lunarDate : date;

  // Server-side check of a lunar date, keyed by the input it was run on so a stale answer is never shown against a newer date.
  const [lunarResult, setLunarResult] = useState<{ key: string; check: LunarCheck } | null>(null);
  const lunarKey = `${lunarDate}|${isLeapMonth}`;
  useEffect(() => {
    if (calendar !== "lunar" || !lunarDate) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/bazi/lunar?date=${lunarDate}&leap=${isLeapMonth}`, { signal: controller.signal });
        const data: ApiEnvelope<LunarCheck> = await res.json();
        if (data.result) setLunarResult({ key: lunarKey, check: data.result });
      } catch {
        // network failure: leave unchecked; the server rejects a bad date at submit anyway
      }
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [calendar, lunarDate, isLeapMonth, lunarKey]);
  const lunarCheck = calendar === "lunar" && lunarResult?.key === lunarKey ? lunarResult.check : null;
  const lunarMessage = lunarCheck && !lunarCheck.valid ? lunarCheck.message : null;

  // Debounced city search. Typing after a selection clears it (see `typeCity`).
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
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [cityQuery, city]);

  function typeCity(text: string) {
    setCityQuery(text);
    setCity(null);
    if (!text.trim()) setCityHits([]);
  }

  function chooseCity(hit: CityHit) {
    setCity(hit);
    setCityQuery(hit.name);
    setCityHits([]);
  }

  /** Picks a classical case at random (not the one just shown) and fills the form with a modern birth moment whose four pillars
   *  are the case's; the user still presses 生成命盘. */
  function pickClassicCase() {
    const others = classic.cases.filter((c) => c.id !== classicCase?.id);
    const chosen = others[Math.floor(Math.random() * others.length)];
    setClassicCaseOpen(true);
    setCalendar("solar");
    setIsLeapMonth(false);
    setDateParts(splitDate(chosen.birth_date));
    setTimeParts(splitTime(chosen.birth_time));
    setGender(chosen.gender as BaziChartRequest["gender"]);
    setPlaceMode("manual_coordinates");
    setLat(decimalToDms("lat", classic.place.latitude));
    setLng(decimalToDms("lng", classic.place.longitude));
    setNotice("");
    setClassicCase(chosen);
  }

  function buildBirthPlace(): { ok: true; value: BirthPlace } | { ok: false; message: string } {
    if (placeMode === "dropdown") {
      if (!city) return { ok: false, message: "请从搜索结果中选择出生城市。" };
      return {
        ok: true,
        value: { country_code: city.country_code, city: city.name, latitude: city.latitude, longitude: city.longitude, source: "dropdown" },
      };
    }
    const latitude = dmsToDecimal("lat", lat);
    if (!latitude.ok) return latitude;
    const longitude = dmsToDecimal("lng", lng);
    if (!longitude.ok) return longitude;
    return { ok: true, value: { latitude: latitude.value, longitude: longitude.value, source: "manual_coordinates" } };
  }

  /** The request the chart route takes, or what is still missing from the form. */
  function buildRequest(): { ok: true; value: BaziChartRequest } | { ok: false; message: string } {
    if (!birthDate || !time) return { ok: false, message: "请填写出生日期和时间。" };
    if (!gender) return { ok: false, message: "请选择性别（用于确定大运顺逆）。" };
    if (calendar === "lunar" && lunarMessage) return { ok: false, message: lunarMessage };
    const place = buildBirthPlace();
    if (!place.ok) return place;
    return {
      ok: true,
      value: {
        birth_date: birthDate,
        birth_time: time,
        birth_place: place.value,
        gender,
        calendar,
        ...(calendar === "lunar" ? { is_leap_month: isLeapMonth } : {}),
      },
    };
  }

  return {
    dateParts, setDateParts, timeParts, setTimeParts, gender, setGender,
    calendar, setCalendar, isLeapMonth, setIsLeapMonth, lunar, setLunar, lunarCheck, lunarMessage,
    placeMode, setPlaceMode, cityQuery, cityHits, city, cityLoading, typeCity, chooseCity, lat, setLat, lng, setLng,
    classicCase, classicCaseOpen, setClassicCaseOpen, pickClassicCase,
    notice, setNotice, buildRequest,
  };
}

export type BirthFormState = ReturnType<typeof useBirthForm>;
