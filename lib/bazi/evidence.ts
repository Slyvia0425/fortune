/**
 * Turning an evidence reference into something the pillars page can point at.
 * Pure lookups on the reference's own fields; nothing is inferred (the chart
 * and its references come from the engine).
 */

import type { EvidenceRef, HeavenlyStem, PillarLabel } from "@/lib/contracts/bazi";

/** The tile a reference points at on the pillars page. A hidden stem is
 *  shown inside its branch's tile, so it resolves to that tile. */
export function focusTileId(ref: EvidenceRef): string {
  return ref.position === "stem" ? `${ref.pillar}-stem` : `${ref.pillar}-branch`;
}

/** Whether a hidden-stem row of the pillars page is the one a reference names. */
export function isFocusedHidden(
  ref: EvidenceRef | null | undefined,
  pillar: PillarLabel,
  hidden: { stem: HeavenlyStem; qi: string },
): boolean {
  return (
    ref?.position === "hidden" && ref.pillar === pillar && ref.stem === hidden.stem && ref.qi === hidden.qi
  );
}
