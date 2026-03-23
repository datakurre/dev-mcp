import { execSync } from "child_process";

export function getHeadCommit(): string | null {
  try {
    return execSync("git rev-parse HEAD", { cwd: process.cwd() }).toString().trim();
  } catch {
    return null;
  }
}

/**
 * Returns the merge-base commit between `baseBranch` and `branch`.
 * This is the point where the feature branch diverged from the base.
 */
export function getMergeBase(baseBranch: string, branch: string): string | null {
  try {
    return (
      execSync(`git merge-base ${baseBranch} ${branch}`, { cwd: process.cwd() })
        .toString()
        .trim() || null
    );
  } catch {
    return null;
  }
}

export function getChangedFiles(baseBranch: string, branch: string): string[] {
  try {
    return execSync(`git diff --name-only ${baseBranch}...${branch}`, { cwd: process.cwd() })
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function getCurrentBranch(): string | null {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd: process.cwd() }).toString().trim();
  } catch {
    return null;
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

/** Creates and checks out a new branch. Returns error message on failure, null on success. */
export function createBranch(name: string): string | null {
  try {
    execSync(`git checkout -b ${name}`, { cwd: process.cwd() });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * Creates a branch without switching to it (`git branch <name>`).
 * Returns error message on failure, null on success.
 */
export function createBranchNoCheckout(name: string): string | null {
  try {
    execSync(`git branch ${name}`, { cwd: process.cwd() });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message.split("\n")[0] : String(e);
  }
}

/** Checks out an existing branch. Returns error message on failure, null on success. */
export function checkoutBranch(name: string): string | null {
  try {
    execSync(`git checkout ${name}`, { cwd: process.cwd() });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message.split("\n")[0] : String(e);
  }
}

/**
 * Returns the number of commits on `branch` that are above the merge-base with `baseBranch`
 * (i.e. commits introduced by the feature branch).
 * Returns 0 on any error (e.g. branch doesn't exist yet).
 */
export function getBranchCommitCount(baseBranch: string, branch: string): number {
  try {
    const mergeBase = execSync(`git merge-base ${baseBranch} ${branch}`, { cwd: process.cwd() })
      .toString()
      .trim();
    const out = execSync(`git rev-list --count ${mergeBase}..${branch}`, { cwd: process.cwd() })
      .toString()
      .trim();
    return parseInt(out, 10) || 0;
  } catch {
    return 0;
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
 * Rebases the current branch onto `baseBranch`.
 * Returns null on success, or an error string on failure.
 */
export function rebaseBranch(baseBranch: string): string | null {
  try {
    execSync(`git rebase ${baseBranch}`, { cwd: process.cwd() });
    return null;
  } catch (e) {
    try {
      execSync("git rebase --abort", { cwd: process.cwd() });
    } catch {}
    return e instanceof Error ? e.message.split("\n")[0] : String(e);
  }
}
