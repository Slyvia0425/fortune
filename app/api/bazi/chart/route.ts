import type { BaziChartRequest, BirthPlace } from "@/lib/contracts/bazi";
import { failure, record, success } from "@/lib/contracts/api";
import { calculateBazi } from "@/lib/bazi/service";

const SYSTEM = "bazi-chart-v1";

/**
 * Validation here mirrors the Pydantic models in python_algorithm/bazi/models/bazi.py
 * rule for rule. Anything this route lets through but Python rejects surfaces to
 * the user as a 502 ALGORITHM_SERVICE_ERROR, which reads like an outage rather
 * than a bad input — so the two must stay in step.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const GENDERS = ["female", "male", "unspecified"] as const;
const CALENDARS = ["solar", "lunar"] as const;
const LOCATION_SOURCES = ["dropdown", "manual_coordinates"] as const;

const REQUEST_FIELDS = new Set([
  "birth_date",
  "birth_time",
  "birth_place",
  "gender",
  "calendar",
  "is_leap_month",
  "timezone",
]);

const BIRTH_PLACE_FIELDS = new Set([
  "country_code",
  "country",
  "city",
  "latitude",
  "longitude",
  "source",
]);

/** Rejects "2000-02-31" and friends, which the regex alone would let through. */
function isRealDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return undefined;
  return trimmed;
}

/** Present but wrong is an error; absent is fine. Distinguishes the two. */
function readOptionalString(
  source: Record<string, unknown>,
  key: string,
  maxLength: number,
): { ok: true; value: string | undefined } | { ok: false } {
  const raw = source[key];
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  const parsed = optionalString(raw, maxLength);
  return parsed === undefined ? { ok: false } : { ok: true, value: parsed };
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

function parseBirthPlace(raw: unknown): ParseResult<BirthPlace> {
  const place = record(raw);
  if (!place) {
    return {
      ok: false,
      message: "birth_place 必须是包含经纬度的对象。",
    };
  }

  for (const key of Object.keys(place)) {
    if (!BIRTH_PLACE_FIELDS.has(key)) {
      return { ok: false, message: `birth_place 包含未知字段：${key}。` };
    }
  }

  const { latitude, longitude, source } = place;

  if (typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return { ok: false, message: "birth_place.latitude 必须是 -90 到 90 之间的数值。" };
  }

  if (
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return { ok: false, message: "birth_place.longitude 必须是 -180 到 180 之间的数值。" };
  }

  if (!LOCATION_SOURCES.includes(source as (typeof LOCATION_SOURCES)[number])) {
    return {
      ok: false,
      message: "birth_place.source 必须是 dropdown 或 manual_coordinates。",
    };
  }

  // Pydantic pins country_code to exactly two characters (ISO 3166-1 alpha-2).
  const countryCode = place.country_code;
  let parsedCountryCode: string | undefined;
  if (countryCode !== undefined && countryCode !== null) {
    if (typeof countryCode !== "string" || countryCode.trim().length !== 2) {
      return { ok: false, message: "birth_place.country_code 必须是两位国家代码。" };
    }
    parsedCountryCode = countryCode.trim().toUpperCase();
  }

  const country = readOptionalString(place, "country", 100);
  if (!country.ok) return { ok: false, message: "birth_place.country 无效。" };

  const city = readOptionalString(place, "city", 100);
  if (!city.ok) return { ok: false, message: "birth_place.city 无效。" };

  return {
    ok: true,
    value: {
      country_code: parsedCountryCode,
      country: country.value,
      city: city.value,
      latitude,
      longitude,
      source: source as BirthPlace["source"],
    },
  };
}

function parseRequest(body: Record<string, unknown>): ParseResult<BaziChartRequest> {
  // extra="forbid" on the Python side; catching it here gives a 400 with a
  // useful message instead of a 502 from the algorithm service.
  for (const key of Object.keys(body)) {
    if (!REQUEST_FIELDS.has(key)) {
      return { ok: false, message: `请求包含未知字段：${key}。` };
    }
  }

  const birthDate = optionalString(body.birth_date, 10);
  if (!birthDate || !DATE_RE.test(birthDate) || !isRealDate(birthDate)) {
    return { ok: false, message: "birth_date 必须是有效日期，格式 YYYY-MM-DD。" };
  }

  const birthTime = optionalString(body.birth_time, 5);
  if (!birthTime || !TIME_RE.test(birthTime)) {
    return { ok: false, message: "birth_time 必须是 24 小时制时间，格式 HH:mm。" };
  }

  const birthPlace = parseBirthPlace(body.birth_place);
  if (!birthPlace.ok) return birthPlace;

  const gender = body.gender;
  if (!GENDERS.includes(gender as (typeof GENDERS)[number])) {
    return { ok: false, message: "gender 必须是 female、male 或 unspecified。" };
  }

  // Defaults to solar, matching the Pydantic default. An explicit but
  // unrecognised value is rejected rather than silently coerced.
  let calendar: BaziChartRequest["calendar"] = "solar";
  if (body.calendar !== undefined && body.calendar !== null) {
    if (!CALENDARS.includes(body.calendar as (typeof CALENDARS)[number])) {
      return { ok: false, message: "calendar 必须是 solar 或 lunar。" };
    }
    calendar = body.calendar as BaziChartRequest["calendar"];
  }

  let isLeapMonth: boolean | undefined;
  if (body.is_leap_month !== undefined && body.is_leap_month !== null) {
    if (typeof body.is_leap_month !== "boolean") {
      return { ok: false, message: "is_leap_month 必须是布尔值。" };
    }
    isLeapMonth = body.is_leap_month;
  }

  const timezone = readOptionalString(body, "timezone", 64);
  if (!timezone.ok) return { ok: false, message: "timezone 无效。" };

  return {
    ok: true,
    value: {
      birth_date: birthDate,
      birth_time: birthTime,
      birth_place: birthPlace.value,
      gender: gender as BaziChartRequest["gender"],
      calendar,
      is_leap_month: isLeapMonth,
      timezone: timezone.value,
    },
  };
}

export async function POST(request: Request) {
  let body: Record<string, unknown> | null = null;
  try {
    body = record(await request.json());
  } catch {
    // fall through to the INVALID_JSON response below
  }

  if (!body) {
    return failure(SYSTEM, "INVALID_JSON", "请求体必须是 JSON 对象。");
  }

  const parsed = parseRequest(body);
  if (!parsed.ok) {
    return failure(SYSTEM, "VALIDATION_ERROR", parsed.message);
  }

  try {
    const output = await calculateBazi(parsed.value);
    return Response.json(
      success(output.data, {
        system: SYSTEM,
        sessionId: crypto.randomUUID(),
        // The chart carries the classical sources it relied on; surface them
        // in the envelope so callers get citations without reaching into the
        // reasoning trace.
        sources: output.data.source_refs,
        warnings: output.warnings,
        mock: output.mock,
      }),
    );
  } catch (error) {
    return failure(
      SYSTEM,
      "ALGORITHM_SERVICE_ERROR",
      "Python 八字服务调用失败。",
      { cause: error instanceof Error ? error.message : "unknown" },
      502,
    );
  }
}
