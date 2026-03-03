import { execSync } from "child_process";
import type { Cycle } from "./state.js";

export function getHeadCommit(): string | null {
  try {
    return execSync("git rev-parse HEAD", { cwd: process.cwd() })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

export function getGitDiff(baseCommit: string | null): string {
  if (!baseCommit) {
    return "(no baseline commit recorded — diff unavailable)";
  }
  try {
    return execSync(`git diff ${baseCommit}..HEAD`, {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024 * 10,
    }).toString();
  } catch (e) {
    return `(error capturing diff: ${e instanceof Error ? e.message : String(e)})`;
  }
}

export function getChangedFiles(baseCommit: string | null): string[] {
  if (!baseCommit) return [];
  try {
    return execSync(`git diff --name-only ${baseCommit}..HEAD`, { cwd: process.cwd() })
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function computeRollback(cycle: Cycle): string {
  if (!cycle.baseCommit || !cycle.headCommitAtSubmission) {
    return "(no commit range available — rollback unavailable)";
  }
  const changedFiles = getChangedFiles(cycle.baseCommit);
  const fileList = changedFiles.length > 0
    ? changedFiles.map((f) => `#   ${f}`).join("\n")
    : "#   (no files changed)";
  return (
    `git revert --no-commit ${cycle.headCommitAtSubmission}\n` +
    `# Affected files (${changedFiles.length}):\n${fileList}\n` +
    `# To abort rollback: git revert --abort`
  );
}
