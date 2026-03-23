import { ok, err, ToolResult } from "./result.js";
import { resolveCycle, saveCycle, listCycleFrontMatters } from "../cycles.js";
import { mergeBranchToMain } from "../git.js";

export function decide(
  cycleId: string | undefined,
  approved: boolean,
  feedback: string,
): ToolResult {
  const resolved = resolveCycle(cycleId, "DECIDING");
  if ("error" in resolved) return err(resolved.error);
  const { cycle, warning } = resolved;

  const warningLine = warning ? `\n⚠️  ${warning}` : "";

  if (approved) {
    cycle.decision = {
      approved: true,
      feedback,
      decidedAt: new Date().toISOString(),
    };
    cycle.frontMatter.status = "APPROVED";
    saveCycle(cycle);
    const total = listCycleFrontMatters().filter((fm) => fm.status === "APPROVED").length;

    const mergeMsg = `Merge ${cycle.frontMatter.branch}: ${cycle.definition?.objective ?? cycle.frontMatter.slug}`;
    const mergeErr = mergeBranchToMain(cycle.frontMatter.branch, mergeMsg);
    const mergeNote = mergeErr
      ? `\n⚠️  Auto-merge failed: ${mergeErr}. Merge manually: git checkout main && git merge --no-ff ${cycle.frontMatter.branch}`
      : `\nMerged ${cycle.frontMatter.branch} → main.`;

    return ok(
      `Cycle ${cycle.frontMatter.id} APPROVED. Status: APPROVED\n\n` +
        `Feedback: ${feedback}` +
        mergeNote +
        warningLine +
        `\n\nCycle recorded (${total} completed total). Ready for next **#define**.`,
    );
  }

  // Rejected — record decision and mark as REJECTED (terminal state, definition preserved)
  cycle.decision = {
    approved: false,
    feedback,
    decidedAt: new Date().toISOString(),
  };
  cycle.frontMatter.status = "REJECTED";
  saveCycle(cycle);
  return ok(
    `Cycle ${cycle.frontMatter.id} REJECTED. Status: REJECTED\n\n` +
      `Feedback: ${feedback}` +
      warningLine +
      `\n\nCycle rejected. Use **#define** to start a new cycle if revision is needed.`,
  );
}
