/**
 * The birth form's inputs as plain functions: a date and a time typed in parts, and a coordinate typed as degrees and minutes.
 * No React here, so the rules (what a part may hold, what makes a value valid) can be tested on their own.
 */

const pad2 = (value: string) => value.padStart(2, "0");

/** The digits of `text`, as a number string no larger than `max` ("" when there are none). */
export function digitsOnly(text: string, max: number): string {
  const digits = text.replace(/\D/g, "");
  return digits === "" ? "" : String(Math.min(Number(digits), max));
}

/** Days in a month; 31 until the month is chosen, and a leap year until the year is. */
export function daysIn(year: string, month: string): number {
  if (!month) return 31;
  return new Date(Number(year) || 2000, Number(month), 0).getDate();
}

export interface DateParts {
  y: string;
  m: string;
  d: string;
}

export interface TimeParts {
  h: string;
  min: string;
}

/** "YYYY-MM-DD" once every part is there, otherwise "": the form never holds half a date. */
export function joinDate({ y, m, d }: DateParts): string {
  return y.length === 4 && m && d ? `${y}-${pad2(m)}-${pad2(d)}` : "";
}

export function splitDate(value: string): DateParts {
  const [y = "", m = "", d = ""] = value.split("-");
  return { y, m: m ? String(Number(m)) : "", d: d ? String(Number(d)) : "" };
}

/** "HH:mm" once both parts are there, otherwise "". */
export function joinTime({ h, min }: TimeParts): string {
  return h !== "" && min !== "" ? `${pad2(h)}:${pad2(min)}` : "";
}

export function splitTime(value: string): TimeParts {
  const [h = "", min = ""] = value.split(":");
  return { h: h ? String(Number(h)) : "", min: min ? String(Number(min)) : "" };
}

/** A lunar date is not a Gregorian one (二月三十 exists), so it is held as its own parts rather than in a date input. */
export function joinLunarDate(year: string, month: string, day: string): string {
  return /^\d{4}$/.test(year) ? `${year}-${pad2(month)}-${pad2(day)}` : "";
}

export type Axis = "lat" | "lng";

export interface Dms {
  hemisphere: string;       // "N" / "S" for a latitude, "E" / "W" for a longitude
  degrees: string;
  minutes: string;
}

export const AXES: Record<Axis, { name: string; positive: string; maxDegrees: number; hemispheres: { value: string; label: string }[] }> = {
  lat: { name: "纬度", positive: "N", maxDegrees: 90, hemispheres: [{ value: "N", label: "北纬" }, { value: "S", label: "南纬" }] },
  lng: { name: "经度", positive: "E", maxDegrees: 180, hemispheres: [{ value: "E", label: "东经" }, { value: "W", label: "西经" }] },
};

export const emptyDms = (axis: Axis): Dms => ({ hemisphere: AXES[axis].positive, degrees: "", minutes: "0" });

export function decimalToDms(axis: Axis, value: number): Dms {
  const { positive, hemispheres } = AXES[axis];
  const total = Math.round(Math.abs(value) * 60);
  return { hemisphere: value >= 0 ? positive : hemispheres.find((h) => h.value !== positive)!.value, degrees: String(Math.floor(total / 60)), minutes: String(total % 60) };
}

export function dmsToDecimal(axis: Axis, dms: Dms): { ok: true; value: number } | { ok: false; message: string } {
  const { name, positive, maxDegrees } = AXES[axis];
  const degrees = Number(dms.degrees);
  if (dms.degrees.trim() === "" || !Number.isInteger(degrees) || degrees < 0 || degrees > maxDegrees) {
    return { ok: false, message: `${name}的「度」必须是 0 到 ${maxDegrees} 之间的整数。` };
  }
  if (degrees === maxDegrees && Number(dms.minutes) !== 0) {
    return { ok: false, message: `${name} ${maxDegrees} 度时，分必须为 0。` };
  }
  const value = (dms.hemisphere === positive ? 1 : -1) * (degrees + Number(dms.minutes) / 60);
  // Rounded to avoid trailing float noise; well below the precision that would shift true solar time by even a second.
  return { ok: true, value: Number(value.toFixed(6)) };
}
