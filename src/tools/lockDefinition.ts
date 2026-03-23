import { ok, err, ToolResult } from "./result.js";
import { resolveCycle, saveCycle, renameCycleFile, slugify, loadCycle } from "../cycles.js";
import { checkoutBranch, renameBranch, getMainBranch } from "../git.js";

export function lockDefinition(cycleId: string | undefined, shortname?: string): ToolResult {
  const resolved = resolveCycle(cycleId, "DEFINING");
  if ("error" in resolved) return err(resolved.error);
  let { cycle } = resolved;
  const { warning } = resolved;

  if (!cycle.definition) {
    return err(
      `No definition found in ${cycle.filePath}.\n` +
        `Complete #define first so a draft is saved, then say "lock".`,
    );
  }
  const { definition } = cycle;
  if (!definition.objective || definition.objective === "(fill in objective)") {
    return err(
      `Definition in ${cycle.filePath} is missing a Change Objective. Please edit the file and try again.`,
    );
  }
  if (definition.criteria.length === 0) {
    return err(`Definition is missing Acceptance Criteria. Please edit the file and try again.`);
  }
  if (definition.constraints.length === 0) {
    return err(`Definition is missing Constraints. Please edit the file and try again.`);
  }
  if (definition.scope.length === 0) {
    return err(`Definition is missing Scope (files). Please edit the file and try again.`);
  }

  // Check dependsOn constraint
  if (cycle.frontMatter.dependsOn) {
    const predecessor = loadCycle(cycle.frontMatter.dependsOn);
    if (!predecessor) {
      return err(
        `This cycle depends on cycle ${cycle.frontMatter.dependsOn}, which could not be found.`,
      );
    }
    if (
      predecessor.frontMatter.status !== "APPROVED" &&
      (predecessor.frontMatter.status as string) !== "DECIDED" // backwards compat
    ) {
      return err(
        `This cycle depends on cycle ${cycle.frontMatter.dependsOn} ("${predecessor.definition?.objective ?? predecessor.frontMatter.slug}"), ` +
        `which is currently ${predecessor.frontMatter.status}. It must be APPROVED before this cycle can be locked.`,
      );
    }
  }

  // Use AI-provided shortname if given, otherwise derive from objective (3-5 words)
  const newSlug = shortname
    ? shortname
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 60)
    : slugify(definition.objective);
  const oldBranch = cycle.frontMatter.branch;
  cycle = renameCycleFile(cycle, newSlug);

  // Rename git branch — must be on the cycle branch for `git branch -m` to work
  const newBranch = `hal/${cycle.frontMatter.id}_${newSlug}`;
  const checkoutErr = checkoutBranch(oldBranch);
  const branchErr = checkoutErr ?? renameBranch(newBranch);

  // Return to main branch after rename
  const mainBranch = getMainBranch();
  const returnErr = checkoutBranch(mainBranch);

  // Update status
  cycle.frontMatter.status = "IMPLEMENTING";
  saveCycle(cycle);

  const branchNote = branchErr
    ? `\n⚠️  Branch rename failed: ${branchErr.split("\n")[0]}`
    : returnErr
      ? `\nBranch: ${newBranch}\n⚠️  Could not return to ${mainBranch}: ${returnErr.split("\n")[0]}`
      : `\nBranch: ${newBranch} (now on ${mainBranch})`;
  const warningLine = warning ? `\n⚠️  ${warning}` : "";

  return ok(
    `Definition locked. Status: IMPLEMENTING\n` +
      `Cycle file: ${cycle.filePath}` +
      branchNote +
      warningLine +
      `\n\nObjective:   ${definition.objective}\n` +
      `Criteria:    ${definition.criteria.length} item(s)\n` +
      `Constraints: ${definition.constraints.length} item(s)\n` +
      `Scope:       ${definition.scope.length} file(s)\n` +
      `Forbidden:   ${definition.forbiddenPaths.length} path(s)\n\n` +
      `Next: use **#implement** to start the implementation.`,
  );
}
