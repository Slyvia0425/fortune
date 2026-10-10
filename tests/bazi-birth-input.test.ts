import { describe, expect, it } from "vitest";

import { daysIn, decimalToDms, digitsOnly, dmsToDecimal, joinDate, joinLunarDate, joinTime, splitDate, splitTime } from "../lib/bazi/birth-input";

describe("a date and a time typed in parts", () => {
  it("are read back as YYYY-MM-DD and HH:mm only when every part is there", () => {
    expect(joinDate({ y: "1990", m: "5", d: "7" })).toBe("1990-05-07");
    expect(joinDate({ y: "199", m: "5", d: "7" })).toBe("");
    expect(joinDate({ y: "1990", m: "", d: "7" })).toBe("");
    expect(joinTime({ h: "8", min: "0" })).toBe("08:00");
    expect(joinTime({ h: "8", min: "" })).toBe("");
    expect(joinLunarDate("1990", "2", "30")).toBe("1990-02-30");
    expect(joinLunarDate("19", "2", "30")).toBe("");
  });

  it("split back into the same parts (what a classical case fills in)", () => {
    expect(joinDate(splitDate("2023-03-22"))).toBe("2023-03-22");
    expect(splitDate("2023-03-02")).toEqual({ y: "2023", m: "3", d: "2" });
    expect(joinTime(splitTime("13:30"))).toBe("13:30");
    expect(splitTime("00:05")).toEqual({ h: "0", min: "5" });
  });

  it("know how many days a month has, leap years included, and keep a part within its range", () => {
    expect(daysIn("2000", "2")).toBe(29);
    expect(daysIn("1900", "2")).toBe(28);
    expect(daysIn("", "2")).toBe(29);
    expect(daysIn("1990", "")).toBe(31);
    expect(daysIn("1990", "4")).toBe(30);
    expect(digitsOnly("9x9", 23)).toBe("23");
    expect(digitsOnly("abc", 23)).toBe("");
  });
});

describe("a coordinate typed as degrees and minutes", () => {
  it("converts to a decimal, south and west being negative", () => {
    expect(dmsToDecimal("lat", { hemisphere: "N", degrees: "31", minutes: "12" })).toEqual({ ok: true, value: 31.2 });
    expect(dmsToDecimal("lng", { hemisphere: "W", degrees: "73", minutes: "30" })).toEqual({ ok: true, value: -73.5 });
    expect(dmsToDecimal("lat", { hemisphere: "S", degrees: "33", minutes: "0" })).toEqual({ ok: true, value: -33 });
  });

  it("converts back from a decimal, so a case's place fills the form as typed", () => {
    expect(decimalToDms("lat", 31.2)).toEqual({ hemisphere: "N", degrees: "31", minutes: "12" });
    expect(decimalToDms("lng", 121.5)).toEqual({ hemisphere: "E", degrees: "121", minutes: "30" });
    expect(decimalToDms("lng", -73.5)).toEqual({ hemisphere: "W", degrees: "73", minutes: "30" });
  });

  it("refuses what is empty, out of range, or past the pole or the date line", () => {
    expect(dmsToDecimal("lat", { hemisphere: "N", degrees: "", minutes: "0" })).toMatchObject({ ok: false });
    expect(dmsToDecimal("lat", { hemisphere: "N", degrees: "91", minutes: "0" })).toMatchObject({ ok: false });
    expect(dmsToDecimal("lat", { hemisphere: "N", degrees: "90", minutes: "1" })).toMatchObject({ ok: false, message: "纬度 90 度时，分必须为 0。" });
    expect(dmsToDecimal("lng", { hemisphere: "E", degrees: "180", minutes: "5" })).toMatchObject({ ok: false, message: "经度 180 度时，分必须为 0。" });
    expect(dmsToDecimal("lng", { hemisphere: "E", degrees: "181", minutes: "0" })).toMatchObject({ ok: false, message: "经度的「度」必须是 0 到 180 之间的整数。" });
  });
});
