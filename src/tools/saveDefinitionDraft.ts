import { ok, err, ToolResult } from "./result.js";
import { resolveCycle, saveCycle } from "../cycles.js";

export function saveDefinitionDraft(
  cycleId: string | undefined,
  objective: string,
  criteria: string[],
  constraints: string[],
  scope: string[],
  nonGoals: string[],
  invariants: string[],
  implementationNotes: string[],
  forbiddenPaths: string[],
): ToolResult {
  const resolved = resolveCycle(cycleId, "DEFINING");
  if ("error" in resolved) return err(resolved.error);
  const { cycle, warning } = resolved;

  cycle.definition = {
    objective,
    criteria,
    constraints,
    scope,
    nonGoals,
    invariants,
    implementationNotes,
    forbiddenPaths,
  };
  saveCycle(cycle);

  const warningLine = warning ? `\n⚠️  ${warning}` : "";
  return ok(
    `Definition draft saved to ${cycle.filePath}${warningLine}\n\n` +
      `Open and review the file — edit any section freely. Bullet points (- item) are parsed as list items.\n\n` +
      `When you are happy with it, say **"lock"** and I will lock the definition and move to IMPLEMENTING.`,
  );
}
