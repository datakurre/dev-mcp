import { ok, err, ToolResult } from "./result.js";
import { getNextCycleId, createCycle } from "../cycles.js";
import { getHeadCommit, createBranch, getCurrentBranch } from "../git.js";

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
  const baseCommit = getHeadCommit();
  createCycle(id, branchName, mainBranch, baseCommit);
  const branchErr = createBranch(branchName);
  const branchNote = branchErr
    ? `\n⚠️  Branch creation failed (${branchErr.split("\n")[0]}). Continuing without a dedicated branch.`
    : `\nBranch: ${branchName}`;
  return ok(
    `Cycle ${id} started. Status: DEFINING\n` +
      `Intent: ${intent}\n` +
      `Baseline commit: ${baseCommit ?? "(none — not in a git repo)"}` +
      branchNote +
      `\n\nNext: use **#define** to produce the Definition Artifact.`,
  );
}
