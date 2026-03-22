import { ok, err, ToolResult } from "./result.js";
import { resolveCycle, saveCycle } from "../cycles.js";
import { getHeadCommit } from "../git.js";

export function submitImplementation(cycleId: string | undefined, comment: string): ToolResult {
  const resolved = resolveCycle(cycleId, "IMPLEMENTING");
  if ("error" in resolved) return err(resolved.error);
  const { cycle, warning } = resolved;

  const head = getHeadCommit();
  const implNumber = cycle.implementations.length + 1;
  cycle.implementations.push({
    number: implNumber,
    submittedAt: new Date().toISOString(),
    commit: head,
    comment,
  });
  cycle.frontMatter.status = "REVIEWING";
  saveCycle(cycle);

  const warningLine = warning ? `\n⚠️  ${warning}` : "";
  return ok(
    `Implementation ${implNumber} submitted. Status: REVIEWING\n` +
      `Cycle: ${cycle.frontMatter.id}\n` +
      `Commit: ${head ?? "(unknown)"}\n` +
      `Comment: ${comment}` +
      warningLine +
      `\n\nNext: use **#review** with an independent reviewer.`,
  );
}
