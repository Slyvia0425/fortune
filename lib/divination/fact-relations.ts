import type { LiuyaoCoreFacts, LiuyaoLineFact } from "../contracts/divination";
import { analysisHash, canonicalAnalysis, freezeAnalysis } from "./analysis-utils";

export const RELATION_ENGINE_VERSION = "directed-core-relations-pr65-v1";
const elements = "木火土金水";
const branches = "子丑寅卯辰巳午未申酉戌亥";
const branchElements = "水土木木土火火土金金土水";
export interface CoreRelation {
  relation_id: string;
  source_ref: string;
  target_ref: string;
  source_element: string;
  target_element: string;
  element_relation: "same_element" | "generates" | "controls" | "controlled_by" | "generated_by";
  same_branch: boolean;
  clash: boolean;
  combine: boolean;
}

function invalid(): never { throw new Error("RELATION_CORE_INVALID"); }

/** Validate identities and pair structure against the actual frozen-core contract. */
export function validateRelationCore(core: LiuyaoCoreFacts): void {
  if (core.core_version !== "liuyao-decoration-v1" || !core.main_lines_complete
    || !core.transformed_lines_complete || !core.hidden_lines_complete
    || core.main_lines.length !== 6 || core.transformed_lines.length !== 6) invalid();
  const refs = new Set<string>();
  for (const [scope, lines] of [
    ["main", core.main_lines], ["transformed", core.transformed_lines], ["hidden", core.hidden_lines],
  ] as const) {
    for (const line of lines) {
      if (!Number.isInteger(line.position) || line.position < 1 || line.position > 6
        || line.ref !== `${scope}:${line.position}` || refs.has(line.ref)
        || !branches.includes(line.branch) || line.branch.length !== 1
        || line.element !== branchElements[branches.indexOf(line.branch)]
        || line.ganzhi !== line.stem + line.branch || !"甲乙丙丁戊己庚辛壬癸".includes(line.stem)
        || line.stem.length !== 1 || line.kin_basis !== "primary_palace"
        || ![6, 7, 8, 9].includes(line.yin_yang_value)
        || line.yin_yang !== (line.yin_yang_value % 2 ? "yang" : "yin")
        || line.age !== ([6, 9].includes(line.yin_yang_value) ? "old" : "young")
        || line.moving !== (scope === "main" && [6, 9].includes(line.yin_yang_value))) invalid();
      const kin = ["siblings", "offspring", "wealth", "officials", "parents"][
        (elements.indexOf(line.element) - elements.indexOf(core.palace.element) + 5) % 5
      ];
      if (line.kin !== kin || !elements.includes(core.palace.element) || core.palace.element.length !== 1) invalid();
      refs.add(line.ref);
    }
  }
  if (!Number.isInteger(core.palace.self_position) || core.palace.self_position < 1
    || core.palace.self_position > 6
    || core.palace.response_position !== (core.palace.self_position + 2) % 6 + 1) invalid();
  for (const line of core.main_lines) {
    const changed = core.transformed_lines.find(l => l.position === line.position);
    const expected = line.yin_yang_value === 6 ? 7 : line.yin_yang_value === 9 ? 8 : line.yin_yang_value;
    if (!changed || changed.yin_yang_value !== expected || changed.position_role !== null
      || line.position_role !== (line.position === core.palace.self_position ? "self"
        : line.position === core.palace.response_position ? "response" : null)) invalid();
  }
  const present = new Set(core.main_lines.map(l => l.kin));
  const hiddenKinds = new Set(core.hidden_lines.map(l => l.kin));
  for (const kin of ["parents", "siblings", "offspring", "wealth", "officials"] as const) {
    if (hiddenKinds.has(kin) === present.has(kin)) invalid();
  }
  for (const hidden of core.hidden_lines) {
    if (hidden.position_role !== null || hidden.flying_line_ref !== `main:${hidden.position}`) invalid();
  }
}

/** Complete directed main-main, moving-changed, and flying-hidden structural pairs. */
export function deriveCoreRelations(core: LiuyaoCoreFacts, chartHash: string): readonly CoreRelation[] {
  if (!chartHash.trim()) throw new Error("RELATION_CHART_HASH_REQUIRED");
  validateRelationCore(core);
  const result: CoreRelation[] = [];
  const add = (a: LiuyaoLineFact, b: LiuyaoLineFact) => {
    const x = branches.indexOf(a.branch), y = branches.indexOf(b.branch);
    result.push({
      relation_id: "relation_" + analysisHash([chartHash, a.ref, b.ref, "branch_element", RELATION_ENGINE_VERSION]).slice(0, 24),
      source_ref: a.ref, target_ref: b.ref, source_element: a.element, target_element: b.element,
      element_relation: (["same_element", "generates", "controls", "controlled_by", "generated_by"] as const)[
        (elements.indexOf(b.element) - elements.indexOf(a.element) + 5) % 5],
      same_branch: x === y, clash: (x - y + 12) % 12 === 6, combine: (x + y) % 12 === 1,
    });
  };
  const main = [...core.main_lines].sort((a, b) => a.position - b.position);
  for (const a of main) for (const b of main) if (a.ref !== b.ref) add(a, b);
  for (const a of main.filter(l => l.moving)) {
    const b = core.transformed_lines.find(l => l.position === a.position)!;
    add(a, b); add(b, a);
  }
  for (const b of [...core.hidden_lines].sort((a, b) => a.position - b.position)) {
    const a = main.find(l => l.ref === b.flying_line_ref)!;
    add(a, b); add(b, a);
  }
  // Verify optional directional snapshots when supplied, without rewriting them.
  for (const hidden of core.hidden_lines) {
    const stored = (hidden as LiuyaoLineFact & { flying_to_hidden?: unknown }).flying_to_hidden;
    if (stored !== undefined) {
      const r = result.find(r => r.source_ref === hidden.flying_line_ref && r.target_ref === hidden.ref)!;
      const expected = { element_relation: r.element_relation === "same_element" ? "same" : r.element_relation,
        same_branch: r.same_branch, clash: r.clash, combine: r.combine };
      if (canonicalAnalysis(stored) !== canonicalAnalysis(expected)) invalid();
    }
  }
  for (const line of main.filter(l => l.moving)) {
    const stored = (line as LiuyaoLineFact & {transformation?: {line_ref: string; return_relation: unknown}}).transformation;
    if (stored) {
      const changedRef = `transformed:${line.position}`;
      const r = result.find(r => r.source_ref === changedRef && r.target_ref === line.ref)!;
      const expected = {element_relation: r.element_relation === "same_element" ? "same" : r.element_relation,
        same_branch: r.same_branch, clash: r.clash, combine: r.combine};
      if (stored.line_ref !== changedRef || canonicalAnalysis(stored.return_relation) !== canonicalAnalysis(expected)) invalid();
    }
  }
  return freezeAnalysis(result);
}

/** Keep all role-role links plus moving/changed and flying/hidden links near those roles. */
export function selectCoreRelations(relations: readonly CoreRelation[], refs: readonly string[]): readonly CoreRelation[] {
  const selected = new Set(refs);
  return relations.filter(r => (selected.has(r.source_ref) && selected.has(r.target_ref))
    || ((!r.source_ref.startsWith("main:") || !r.target_ref.startsWith("main:"))
      && (selected.has(r.source_ref) || selected.has(r.target_ref))));
}
