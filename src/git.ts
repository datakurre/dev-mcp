import { execSync } from "child_process";

export function getHeadCommit(): string | null {
  try {
    return execSync("git rev-parse HEAD", { cwd: process.cwd() }).toString().trim();
  } catch {
    return null;
  }
}

export function getGitDiff(baseCommit: string | null): string {
  if (!baseCommit) return "(no baseline commit recorded — diff unavailable)";
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

export function getCurrentBranch(): string | null {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd: process.cwd() })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

/** Creates and checks out a new branch. Returns error message on failure, null on success. */
export function createBranch(name: string): string | null {
  try {
    execSync(`git checkout -b ${name}`, { cwd: process.cwd() });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Renames the current branch in-place. Returns error message on failure, null on success. */
export function renameBranch(newName: string): string | null {
  try {
    execSync(`git branch -m ${newName}`, { cwd: process.cwd() });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Returns the name of the repo's primary branch ("main" or "master"). */
export function getMainBranch(): string {
  try {
    execSync("git show-ref --verify --quiet refs/heads/main", { cwd: process.cwd() });
    return "main";
  } catch {
    try {
      execSync("git show-ref --verify --quiet refs/heads/master", { cwd: process.cwd() });
      return "master";
    } catch {
      return "main"; // fallback
    }
  }
}

/** Deletes a local branch (safe delete — only if fully merged). Returns error string or null. */
export function deleteBranch(name: string): string | null {
  try {
    execSync(`git branch -d ${name}`, { cwd: process.cwd() });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message.split("\n")[0] : String(e);
  }
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

/**
 * Rebases the current branch onto `baseBranch`.
 * Returns the HEAD commit of `baseBranch` (new baseCommit) on success, or an error string.
 */
export function rebaseBranch(baseBranch: string): { newBaseCommit: string | null; error: string | null } {
  try {
    const newBaseCommit = execSync(`git rev-parse ${baseBranch}`, { cwd: process.cwd() })
      .toString()
      .trim();
    execSync(`git rebase ${baseBranch}`, { cwd: process.cwd() });
    return { newBaseCommit, error: null };
  } catch (e) {
    try {
      execSync("git rebase --abort", { cwd: process.cwd() });
    } catch {}
    return { newBaseCommit: null, error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
}
