import { ok, err, ToolResult } from "./result.js";
import { getNextCycleId, createCycle, getActiveCycles } from "../cycles.js";
import { createBranchNoCheckout, getCurrentBranch } from "../git.js";

export function startCycle(intent: string): ToolResult {
  const currentBranch = getCurrentBranch();
  const mainBranch = currentBranch === "master" ? "master" : "main";
  if (currentBranch && currentBranch !== mainBranch) {
    return err(
      `You are on branch "${currentBranch}", not "${mainBranch}".\n` +
        `Switch to ${mainBranch} before starting a new cycle to keep cycle IDs consistent.\n` +
        `Run: git checkout ${mainBranch}`,
    );
  }
  const id = getNextCycleId();
  const branchName = `hal/${id}_undefined`;
  createCycle(id, branchName, mainBranch);
  const branchErr = createBranchNoCheckout(branchName);
  const branchNote = branchErr
    ? `\n⚠️  Branch creation failed (${branchErr.split("\n")[0]}). Continuing without a dedicated branch.`
    : `\nBranch created: ${branchName} (not checked out — implementer will switch to it)`;

  const implementing = getActiveCycles().filter((c) => c.frontMatter.status === "IMPLEMENTING");
  const implementingNote =
    implementing.length > 0
      ? `\n\n⚠️  Note: ${implementing.length} cycle(s) are already IMPLEMENTING (${implementing
          .map((c) => c.frontMatter.id)
          .join(
            ", ",
          )}). Consider completing those before starting new work to avoid branch confusion.`
      : "";
  return ok(
    `Cycle ${id} started. Status: DEFINING\n` +
      `Intent: ${intent}\n` +
      `Base branch: ${mainBranch}` +
      branchNote +
      implementingNote +
      `\n\nNext: use **#define** to produce the Definition Artifact.`,
  );
}
