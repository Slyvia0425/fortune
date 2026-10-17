import type { TraceStep } from "@/lib/contracts/bazi";

/**
 * Where each step of the calculation trace goes on the page. The steps come in calculation order and name the steps they read from;
 * the page draws them as rows, each step in the row after the last one it depends on, and a step that only a later step needs is
 * pulled down next to that step so its arrow does not run the length of the chart.
 */
export function layerSteps(steps: TraceStep[]): string[][] {
  const layer = new Map<string, number>();
  for (const step of steps) layer.set(step.id, Math.max(-1, ...step.inputs.map((id) => layer.get(id) ?? -1)) + 1);

  const consumers = new Map<string, string[]>();
  for (const step of steps) for (const id of step.inputs) consumers.set(id, [...(consumers.get(id) ?? []), step.id]);
  for (const step of [...steps].reverse()) {
    const later = (consumers.get(step.id) ?? []).map((id) => layer.get(id)!);
    if (later.length > 0) layer.set(step.id, Math.max(layer.get(step.id)!, Math.min(...later) - 1));
  }

  const rows: string[][] = [];
  for (const step of steps) (rows[layer.get(step.id)!] ??= []).push(step.id);
  return rows.filter(Boolean);
}

/** The books a step drew on, each once, in the order it used them. */
export function booksOf(step: TraceStep): string[] {
  return [...new Set(step.uses.flatMap((use) => (use.source ? [use.source.book] : [])))];
}

/**
 * The arrows worth drawing: a step lists everything it read from, but when it reads from A and from B and B itself reads (through other
 * steps) from A, the arrow from A says nothing the others do not. Those are left out of the picture; each step's own list keeps them.
 * (The page also leaves out an arrow that would skip a row; the step's own list says what it read from.)
 */
export function drawnEdges(steps: TraceStep[]): { from: string; to: string }[] {
  const inputsOf = new Map(steps.map((step) => [step.id, step.inputs]));
  const ancestors = new Map<string, Set<string>>();
  const reach = (id: string): Set<string> => {
    const known = ancestors.get(id);
    if (known) return known;
    const found = new Set<string>();
    for (const input of inputsOf.get(id) ?? []) {
      found.add(input);
      for (const earlier of reach(input)) found.add(earlier);
    }
    ancestors.set(id, found);
    return found;
  };
  return steps.flatMap((step) =>
    step.inputs.filter((from) => !step.inputs.some((other) => other !== from && reach(other).has(from))).map((from) => ({ from, to: step.id })),
  );
}
