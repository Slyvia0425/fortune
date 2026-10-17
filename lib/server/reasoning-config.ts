// Single source of truth: retries share a node, nodes share the workflow.
export const PR6_NODE_TIMEOUT_MS=120_000;
export const PR6_CALL_TIMEOUT_MS=120_000;
export const PR6_MIN_REPAIR_MS=15_000;
export const PR6_MAX_OUTPUT_TOKENS=9000;
export const PR6_FULL_MAX_OUTPUT_TOKENS=4500;
export function reasoningMode():"full"|"strict"{
  const mode=process.env.LIUYAO_REASONING_MODE??"full";
  if(mode!=="full"&&mode!=="strict")throw new Error("REASONING_MODE_INVALID");
  return mode;
}
export const PR6_TAIL_BUDGET_MS=2*PR6_NODE_TIMEOUT_MS+10_000;
export const PR6_WORKFLOW_BUDGET_MS=420_000;
