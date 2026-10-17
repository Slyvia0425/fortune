import { describe, expect, it } from "vitest";

import type { TraceStep } from "../lib/contracts/bazi";
import { booksOf, drawnEdges, layerSteps } from "../lib/bazi/chain";

const step = (id: string, inputs: string[], uses: TraceStep["uses"] = []): TraceStep => ({ id, title: id, stage: "chart", inputs, summary: id, facts: [], uses });

describe("laying the calculation trace out in rows", () => {
  it("puts a step in the row after the last step it reads from, and steps that share it side by side", () => {
    const rows = layerSteps([step("a", []), step("b", ["a"]), step("c", ["a"]), step("d", ["b", "c"])]);
    expect(rows).toEqual([["a"], ["b", "c"], ["d"]]);
  });

  it("pulls a step that only a later step needs down next to it", () => {
    // e reads only from a, but only z uses it, and z sits three rows down
    const rows = layerSteps([step("a", []), step("e", ["a"]), step("b", ["a"]), step("c", ["b"]), step("z", ["c", "e"])]);
    const rowOf = (id: string) => rows.findIndex((row) => row.includes(id));
    expect(rowOf("e")).toBe(rowOf("c"));
    expect(rowOf("z")).toBe(rowOf("c") + 1);
  });

  it("leaves a step nobody uses where its inputs put it", () => {
    const rows = layerSteps([step("a", []), step("b", ["a"]), step("c", ["b"]), step("leaf", ["a"])]);
    expect(rows.findIndex((row) => row.includes("leaf"))).toBe(1);
  });

  it("never puts a step above or beside one it reads from", () => {
    const steps = [step("a", []), step("b", ["a"]), step("c", ["a", "b"]), step("d", ["c"]), step("e", ["b", "d"])];
    const rows = layerSteps(steps);
    const rowOf = (id: string) => rows.findIndex((row) => row.includes(id));
    for (const s of steps) for (const input of s.inputs) expect(rowOf(input)).toBeLessThan(rowOf(s.id));
  });
});

describe("the arrows drawn between steps", () => {
  it("leave out a step's arrow from something it also reaches through another of its inputs", () => {
    const steps = [step("a", []), step("b", ["a"]), step("c", ["a", "b"]), step("d", ["b", "c"])];
    expect(drawnEdges(steps)).toEqual([{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "d" }]);
  });

  it("keep the arrows of steps that read from independent steps", () => {
    const steps = [step("a", []), step("b", ["a"]), step("c", ["a"]), step("d", ["b", "c"])];
    expect(drawnEdges(steps).filter((edge) => edge.to === "d")).toEqual([{ from: "b", to: "d" }, { from: "c", to: "d" }]);
  });
});

describe("the books a step drew on", () => {
  it("lists each once, in the order used", () => {
    const use = (book?: string) => ({ kind: "table" as const, title: "t", derived: false, source: book ? { book } : null });
    expect(booksOf(step("a", [], [use("三命通会"), use(), use("渊海子平"), use("三命通会")]))).toEqual(["三命通会", "渊海子平"]);
  });
});
