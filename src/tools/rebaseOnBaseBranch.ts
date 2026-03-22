import { ok, err, ToolResult } from "./result.js";
import { resolveCycle, saveCycle } from "../cycles.js";
import { rebaseBranch } from "../git.js";

export function rebaseOnBaseBranch(cycleId: string | undefined): ToolResult {
  const resolved = resolveCycle(cycleId, "IMPLEMENTING");
  if ("error" in resolved) return err(resolved.error);
  const { cycle, warning } = resolved;

  const { baseBranch } = cycle.frontMatter;
  const { newBaseCommit, error } = rebaseBranch(baseBranch);

  if (error) {
    return err(
      `Rebase onto "${baseBranch}" failed: ${error}\n` +
        `Resolve conflicts manually (git rebase --continue / --abort), then proceed.`,
    );
  }

  cycle.frontMatter.baseCommit = newBaseCommit;
  saveCycle(cycle);

  const warningLine = warning ? `\n⚠️  ${warning}` : "";
  return ok(
    `Rebased onto ${baseBranch}. New baseCommit: ${newBaseCommit}` +
      warningLine +
      `\n\nProceed with implementation.`,
  );
}
