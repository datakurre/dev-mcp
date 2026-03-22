import type { CycleData, CycleStatus } from "./types.js";
import { getActiveCycles, loadCycle } from "./store.js";

export type ResolveResult = { cycle: CycleData; warning?: string } | { error: string };

export function resolveCycle(
  cycleId: string | null | undefined,
  targetStatus?: CycleStatus,
): ResolveResult {
  if (cycleId) {
    const cycle = loadCycle(cycleId);
    if (!cycle) return { error: `Cycle ${cycleId} not found.` };
    if (targetStatus && cycle.frontMatter.status !== targetStatus) {
      return {
        error: `Cycle ${cycleId} is in ${cycle.frontMatter.status}, not ${targetStatus}.`,
      };
    }
    return { cycle };
  }

  const active = getActiveCycles();
  if (active.length === 0) {
    const statusMsg = targetStatus ? ` in ${targetStatus} state` : "";
    return { error: `No active cycle${statusMsg} found. Start one with start_cycle().` };
  }

  if (targetStatus) {
    const matching = active.filter((c) => c.frontMatter.status === targetStatus);
    if (matching.length === 0) {
      return {
        error: `No cycle in ${targetStatus} state. Active cycles: ${active
          .map((c) => `${c.frontMatter.id} (${c.frontMatter.status})`)
          .join(", ")}`,
      };
    }
    if (matching.length === 1) return { cycle: matching[0] };
    return {
      cycle: matching[0],
      warning: `Multiple cycles in ${targetStatus}. Using ${matching[0].frontMatter.id}. Pass cycleId to target a specific one.`,
    };
  }

  if (active.length === 1) return { cycle: active[0] };
  return {
    cycle: active[0],
    warning: `Multiple active cycles. Using ${active[0].frontMatter.id}. Pass cycleId to target a specific one.`,
  };
}
