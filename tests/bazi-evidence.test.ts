import { describe, expect, it, vi } from "vitest";

import type { EvidenceRef } from "../lib/contracts/bazi";
import { focusTileId, isFocusedHidden } from "../lib/bazi/evidence";

const ref = (over: Partial<EvidenceRef>): EvidenceRef => ({
  pillar: "month",
  position: "stem",
  branch: "you",
  stem: "xin",
  qi: null,
  description: "",
  ...over,
});

describe("evidence references on the pillars page", () => {
  it("a stem points at its pillar's stem tile, a branch at its branch tile", () => {
    expect(focusTileId(ref({ position: "stem" }))).toBe("month-stem");
    expect(focusTileId(ref({ position: "branch", stem: null }))).toBe("month-branch");
  });

  it("a hidden stem resolves to its host branch tile and to one hidden row", () => {
    const hidden = ref({ pillar: "hour", position: "hidden", branch: "zi", stem: "gui", qi: "primary" });
    expect(focusTileId(hidden)).toBe("hour-branch");
    expect(isFocusedHidden(hidden, "hour", { stem: "gui", qi: "primary" })).toBe(true);
    expect(isFocusedHidden(hidden, "hour", { stem: "gui", qi: "middle" })).toBe(false);
    expect(isFocusedHidden(hidden, "day", { stem: "gui", qi: "primary" })).toBe(false);
  });

  it("stem and branch references never light up a hidden row", () => {
    expect(isFocusedHidden(ref({ position: "stem" }), "month", { stem: "xin", qi: "primary" })).toBe(false);
    expect(isFocusedHidden(null, "month", { stem: "xin", qi: "primary" })).toBe(false);
  });
});

// vitest has no "@/" alias; the fallback never reaches Python, so a stub is enough.
vi.mock("@/lib/server/python-client", () => ({
  pythonServiceConfigured: () => false,
  callPython: async () => {
    throw new Error("not used");
  },
}));

describe("front-end fallback chart", () => {
  it("only cites characters its own pillars contain", async () => {
    const { calculateBazi } = await import("../lib/bazi/service");
    const { data } = await calculateBazi({
      birth_date: "2000-01-01",
      birth_time: "12:00",
      birth_place: { latitude: 1.3, longitude: 103.8, source: "manual_coordinates" },
      gender: "male",
    });
    const refs = data.reasoning_trace.factors.flatMap((factor) => factor.evidence);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) {
      const pillar = data.pillars.find((p) => p.label === r.pillar)!;
      expect(pillar.branch).toBe(r.branch);
      if (r.position === "stem") expect(pillar.stem).toBe(r.stem);
      if (r.position === "hidden") {
        expect(pillar.hidden_stems.some((h) => h.stem === r.stem && h.qi === r.qi)).toBe(true);
      }
    }
  });
});
