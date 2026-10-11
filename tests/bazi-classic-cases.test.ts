import { describe, expect, it } from "vitest";

import { parseRequest } from "../lib/bazi/request";
import classic from "../lib/bazi/classic-cases.json";

const { cases, place } = classic;

describe("classical cases offered on the first step", () => {
  it("are valid birth requests as the form sends them, each with its source and the commentator's words", () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(cases.length).toBeGreaterThanOrEqual(12);
    for (const c of cases) {
      const parsed = parseRequest({
        birth_date: c.birth_date, birth_time: c.birth_time, gender: c.gender, calendar: "solar",
        birth_place: { ...place, source: "manual_coordinates" },
      });
      expect(parsed.ok, c.id).toBe(true);
      expect(c.pillars.split(" ")).toHaveLength(4);
      expect(c.book && c.chapter && c.speaker && c.quote && c.said && c.kb_url, c.id).toBeTruthy();
      expect(new Date(c.birth_date).getFullYear()).toBeLessThanOrEqual(2025);       // a past birth, not one in the future
    }
  });
});
