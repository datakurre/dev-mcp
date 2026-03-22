import { ok, err, ToolResult } from "./result.js";
import { resolveCycle, saveCycle, renameCycleFile, slugify } from "../cycles.js";
import { renameBranch } from "../git.js";

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

  // Use AI-provided shortname if given, otherwise derive from objective (3-5 words)
  const newSlug = shortname
    ? shortname
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 60)
    : slugify(definition.objective);
  cycle = renameCycleFile(cycle, newSlug);

  // Rename git branch
  const newBranch = `hal/${cycle.frontMatter.id}_${newSlug}`;
  const branchErr = renameBranch(newBranch);

  // Update status
  cycle.frontMatter.status = "IMPLEMENTING";
  saveCycle(cycle);

  const branchNote = branchErr
    ? `\n⚠️  Branch rename failed: ${branchErr.split("\n")[0]}`
    : `\nBranch: ${newBranch}`;
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
