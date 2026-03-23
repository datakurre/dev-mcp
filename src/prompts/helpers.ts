import type { CycleData } from "../cycles/types.js";
import { matchesScope } from "../cycles.js";
import { MAX_RETRIES } from "../constants.js";
import {
  getChangedFiles,
  computeRollback,
  getCurrentBranch,
  checkoutBranch,
  getBranchCommitCount,
} from "../git.js";

export function formatList(items: string[]): string {
  if (items.length === 0) return "  (none)";
  return items.map((item, i) => `${i + 1}. ${item}`).join("\n");
}

export function formatScope(files: string[]): string {
  if (files.length === 0) return "  (none declared)";
  return files.map((f) => `- ${f}`).join("\n");
}

/**
 * Builds a self-contained prompt string for implementing a single cycle.
 * This is what gets passed to an external CLI (claude / copilot) as the prompt argument.
 */
export function buildCycleImplementPrompt(cycle: CycleData): string {
  const fm = cycle.frontMatter;
  const def = cycle.definition;
  if (!def) {
    return `Cycle ${fm.id} has no locked definition. Skipping.`;
  }

  const lastReview = cycle.reviews[cycle.reviews.length - 1];
  const priorFeedback =
    fm.retryCount > 0 && lastReview
      ? `\n\n**Prior Review Feedback (retry ${fm.retryCount}/${MAX_RETRIES}):**\n${lastReview.feedback}`
      : "";

  const forbiddenSection =
    def.forbiddenPaths.length > 0
      ? `\n**Forbidden Paths (must not touch):**\n${formatScope(def.forbiddenPaths)}`
      : "";
  const nonGoalsSection =
    def.nonGoals.length > 0
      ? `\n**Non-Goals (do not implement):**\n${formatList(def.nonGoals)}`
      : "";
  const invariantsSection =
    def.invariants.length > 0
      ? `\n**Invariants (must remain true):**\n${formatList(def.invariants)}`
      : "";
  const notesSection =
    def.implementationNotes.length > 0
      ? `\n**Implementation Notes:**\n${formatList(def.implementationNotes)}`
      : "";

  return (
    `You are the Implementer for HAL cycle ${fm.id}.\n\n` +
    `Execute the Definition Artifact below exactly. Do not interpret, extend, or improve beyond what is specified.\n\n` +
    `Always address the human as "Dave" in explicit addresses.\n\n` +
    `Steps:\n` +
    `1. Check out branch: ${fm.branch}\n` +
    `2. Call \`rebase_on_base_branch(cycleId: "${fm.id}")\` via the HAL MCP tool to sync with the base branch\n` +
    `3. Implement exactly what the definition specifies\n` +
    `4. Run existing tests if applicable\n` +
    `5. Commit all changes\n` +
    `6. Call \`submit_implementation(cycleId: "${fm.id}", comment: "...")\` via the HAL MCP tool\n\n` +
    `## Implementation Rules\n\n` +
    `- Touch ONLY the files listed in Claimed Files\n` +
    `- Do NOT touch any Forbidden Paths\n` +
    `- Do NOT implement any Non-Goals\n` +
    `- Do NOT refactor, optimize, or add features beyond the criteria\n` +
    `- Preserve all Invariants\n\n` +
    `---\n\n` +
    `## Cycle ${fm.id} — ${def.objective}\n\n` +
    `**Cycle file:** \`${cycle.filePath}\`\n` +
    `**Branch:** ${fm.branch}\n\n` +
    `**Acceptance Criteria:**\n${formatList(def.criteria)}\n\n` +
    `**Constraints:**\n${formatList(def.constraints)}\n\n` +
    `**Claimed Files (Scope):**\n${formatScope(def.scope)}` +
    `${forbiddenSection}${nonGoalsSection}${invariantsSection}${notesSection}` +
    `${priorFeedback}`
  );
}

/**
 * Builds a self-contained prompt string for reviewing a single cycle.
 * Runs the same Phase A mechanical checks as buildReviewPrompt and embeds
 * the results so the external CLI agent can proceed without MCP context.
 */
export function buildCycleReviewPrompt(cycle: CycleData): string {
  const fm = cycle.frontMatter;
  const def = cycle.definition;
  if (!def) {
    return `Cycle ${fm.id} has no locked definition. Skipping.`;
  }

  const lastImpl = cycle.implementations[cycle.implementations.length - 1];

  // Phase A — switch to cycle branch so getChangedFiles is accurate
  const originalBranch = getCurrentBranch();
  if (originalBranch !== fm.branch) {
    checkoutBranch(fm.branch);
  }

  const changedFiles = getChangedFiles(fm.baseCommit);
  const driftedFiles = changedFiles.filter((f) => !matchesScope(f, def.scope));
  const forbiddenViolations =
    def.forbiddenPaths.length > 0
      ? changedFiles.filter((f) => matchesScope(f, def.forbiddenPaths))
      : [];
  const isDiffEmpty = changedFiles.length === 0 && fm.baseCommit !== null;
  const branchCommitCount =
    fm.baseCommit !== null ? getBranchCommitCount(fm.baseCommit, fm.branch) : null;

  let phaseAResult: string;
  let phaseABlocked = false;

  if (isDiffEmpty) {
    phaseABlocked = true;
    phaseAResult = `PHASE A RESULT: BLOCKED\nReason: No files changed relative to baseline — diff is empty.`;
  } else if (branchCommitCount !== null && branchCommitCount === 0) {
    phaseABlocked = true;
    phaseAResult = `PHASE A RESULT: BLOCKED\nReason: Cycle branch "${fm.branch}" has no commits above baseCommit ${fm.baseCommit} — implementation may not have been committed to the correct branch.`;
  } else if (forbiddenViolations.length > 0) {
    phaseABlocked = true;
    phaseAResult =
      `PHASE A RESULT: BLOCKED\n` +
      `Reason: Changes detected in forbidden paths:\n` +
      forbiddenViolations.map((f) => `  - ${f} (FORBIDDEN)`).join("\n") +
      `\nForbidden paths: ${def.forbiddenPaths.join(", ")}`;
  } else if (driftedFiles.length > 0) {
    phaseABlocked = true;
    phaseAResult =
      `PHASE A RESULT: BLOCKED\n` +
      `Reason: Files touched outside declared scope:\n` +
      driftedFiles.map((f) => `  - ${f} (NOT in claimed files)`).join("\n") +
      `\nDeclared scope: ${def.scope.join(", ") || "(none)"}`;
  } else if (fm.baseCommit === null) {
    phaseAResult = `PHASE A RESULT: SKIPPED\nReason: No baseline commit recorded — scope drift check unavailable.`;
  } else {
    phaseAResult =
      `PHASE A RESULT: PASSED\n` +
      `All ${changedFiles.length} changed file(s) are within declared scope:\n` +
      changedFiles.map((f) => `  - ${f}`).join("\n");
  }

  // Restore original branch after computing diff
  if (originalBranch && originalBranch !== fm.branch) {
    checkoutBranch(originalBranch);
  }

  const phaseAInstruction = phaseABlocked
    ? `\n⛔ PHASE A BLOCKED. Call submit_review(cycleId: "${fm.id}", verdict: "BLOCKED", feedback: "...") via the HAL MCP tool citing the violation above. Do NOT proceed to Phase B.`
    : "";

  const rollbackPlan = computeRollback(fm.baseCommit, lastImpl?.commit ?? null);

  const nonGoalsSection =
    def.nonGoals.length > 0
      ? `\n**Non-Goals (must NOT appear in the diff):**\n${formatList(def.nonGoals)}`
      : "";

  const invariantsSection =
    def.invariants.length > 0
      ? `\n**Invariants (must remain true after this change):**\n${formatList(def.invariants)}`
      : "";

  return (
    `You are the Chief Engineer (Reviewer). You did NOT write this code. Independently verify the implementation against the locked Definition Artifact.\n\n` +
    `Always address the human as "Dave" in explicit addresses. When reporting an error, begin with: "I'm sorry, Dave." or "I'm sorry, Dave. I'm afraid I can't do that."\n\n` +
    `When done, call \`submit_review(cycleId: "${fm.id}", verdict: "APPROVED"|"BLOCKED", feedback: "...")\` via the HAL MCP tool. Then tell the user: "Review submitted. Use **#decide** to make the final approval."\n\n` +
    `## Original Definition — Cycle ${fm.id}\n\n` +
    `**Cycle file:** \`${cycle.filePath}\`\n` +
    `**Branch:** ${fm.branch}\n\n` +
    `**Objective:** ${def.objective}\n\n` +
    `**Acceptance Criteria:**\n${formatList(def.criteria)}\n\n` +
    `**Constraints:**\n${formatList(def.constraints)}\n\n` +
    `**Claimed Files (Scope):**\n${formatScope(def.scope)}` +
    `${nonGoalsSection}${invariantsSection}\n\n` +
    `## Implementation Comment\n${lastImpl?.comment ?? "(none provided)"}\n\n` +
    `## Review Instructions\n\n` +
    `**Phase A — Mechanical Checks (pre-computed, deterministic):**\n` +
    `${phaseAResult}${phaseAInstruction}\n\n` +
    `**Phase B — Semantic Analysis (only if Phase A passed):**\n` +
    `- Does the implementation satisfy ALL acceptance criteria?\n` +
    `- Do changes risk breaking existing functionality?\n` +
    `- Are edge cases (nulls, errors, boundaries) handled?\n` +
    `- Do changes respect all stated constraints?\n` +
    `- Were any non-goals implemented anyway?\n` +
    `- Do the invariants still hold after this change?\n\n` +
    `## Rollback Plan (pre-computed — do not modify)\n` +
    "```\n" + rollbackPlan + "\n```\n\n" +
    `Retry: ${fm.retryCount}/${MAX_RETRIES}`
  );
}
