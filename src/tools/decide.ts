import { ok, err, ToolResult } from "./result.js";
import { resolveCycle, saveCycle, listCycles } from "../cycles.js";
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
    cycle.frontMatter.status = "DECIDED";
    saveCycle(cycle);
    const total = listCycles().filter((c) => c.frontMatter.status === "DECIDED").length;

    const mergeMsg = `Merge ${cycle.frontMatter.branch}: ${cycle.definition?.objective ?? cycle.frontMatter.slug}`;
    const mergeErr = mergeBranchToMain(cycle.frontMatter.branch, mergeMsg);
    const mergeNote = mergeErr
      ? `\n⚠️  Auto-merge failed: ${mergeErr}. Merge manually: git checkout main && git merge --no-ff ${cycle.frontMatter.branch}`
      : `\nMerged ${cycle.frontMatter.branch} → main.`;

    return ok(
      `Cycle ${cycle.frontMatter.id} APPROVED. Status: DECIDED\n\n` +
        `Feedback: ${feedback}` +
        mergeNote +
        warningLine +
        `\n\nCycle recorded (${total} completed total). Ready for next **#define**.`,
    );
  }

  // Rejected — record decision, clear definition and implementation artifacts, return to DEFINING
  cycle.decision = {
    approved: false,
    feedback,
    decidedAt: new Date().toISOString(),
  };
  cycle.definition = null;
  cycle.implementations = [];
  cycle.reviews = [];
  cycle.frontMatter.status = "DEFINING";
  cycle.frontMatter.retryCount = 0;
  saveCycle(cycle);
  return ok(
    `Cycle ${cycle.frontMatter.id} REJECTED. Status: DEFINING\n\n` +
      `Feedback: ${feedback}` +
      warningLine +
      `\n\nDefinition cleared. Use **#define** to revise and re-lock.`,
  );
}
