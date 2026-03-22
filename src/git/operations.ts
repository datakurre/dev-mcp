import { getChangedFiles, getMainBranch, deleteBranch } from "./commands.js";
import { execSync } from "child_process";

/**
 * Returns a git revert command with a list of affected files,
 * suitable for display in a review rollback plan.
 */
export function computeRollback(baseCommit: string | null, headCommit: string | null): string {
  if (!baseCommit || !headCommit) {
    return "(no commit range available — rollback unavailable)";
  }
  const changedFiles = getChangedFiles(baseCommit);
  const fileList =
    changedFiles.length > 0
      ? changedFiles.map((f) => `#   ${f}`).join("\n")
      : "#   (no files changed)";
  return (
    `git revert --no-commit ${headCommit}\n` +
    `# Affected files (${changedFiles.length}):\n${fileList}\n` +
    `# To abort rollback: git revert --abort`
  );
}

/**
 * Checks out the main branch and merges `branchName` with --no-ff.
 * Deletes the branch after a successful merge.
 * Stays on main after merge. Non-fatal — returns error string or null.
 */
export function mergeBranchToMain(branchName: string, commitMessage: string): string | null {
  const main = getMainBranch();
  try {
    execSync(`git checkout ${main}`, { cwd: process.cwd() });
    execSync(`git merge --no-ff ${branchName} -m ${JSON.stringify(commitMessage)}`, {
      cwd: process.cwd(),
    });
    deleteBranch(branchName); // best-effort; ignore error
    return null;
  } catch (e) {
    return e instanceof Error ? e.message.split("\n")[0] : String(e);
  }
}
