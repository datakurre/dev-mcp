import { resolveCycle, matchesScope } from "../cycles.js";
import { getChangedFiles, computeRollback, getCurrentBranch, checkoutBranch, getBranchCommitCount } from "../git.js";
import { MAX_RETRIES } from "../constants.js";
import { formatList, formatScope } from "./helpers.js";

export function buildReviewPrompt(cycleId?: string): {
  description: string;
  messages: Array<{ role: "user"; content: { type: "text"; text: string } }>;
} {
  const resolved = resolveCycle(cycleId, "REVIEWING");
  if ("error" in resolved) {
    return {
      description: "REVIEW stage — error",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `I'm sorry, Dave. ${resolved.error}\n\nComplete **#define** and **#implement** first.`,
          },
        },
      ],
    };
  }
  const { cycle, warning } = resolved;
  const { frontMatter: fm, definition } = cycle;

  if (!definition) {
    return {
      description: "REVIEW stage — error",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `I'm sorry, Dave. Cycle ${fm.id} has no locked definition. Complete **#define** and **#implement** first.`,
          },
        },
      ],
    };
  }

  const lastImpl = cycle.implementations[cycle.implementations.length - 1];

  // Phase A — ensure we are on the cycle's branch so getChangedFiles is accurate
  const originalBranch = getCurrentBranch();
  let branchSwitchNote = "";
  if (originalBranch !== fm.branch) {
    const switchErr = checkoutBranch(fm.branch);
    if (switchErr) {
      branchSwitchNote = `\n⚠️  Could not switch to cycle branch "${fm.branch}": ${switchErr}. Changed-file diff may be inaccurate.`;
    }
  }

  // Phase A — deterministic checks
  const changedFiles = getChangedFiles(fm.baseCommit);
  const driftedFiles = changedFiles.filter((f) => !matchesScope(f, definition.scope));
  const forbiddenViolations =
    definition.forbiddenPaths.length > 0
      ? changedFiles.filter((f) => matchesScope(f, definition.forbiddenPaths))
      : [];
  const isDiffEmpty = changedFiles.length === 0 && fm.baseCommit !== null;

  // Also check the cycle branch itself has commits above the base
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
      `\nForbidden paths: ${definition.forbiddenPaths.join(", ")}`;
  } else if (driftedFiles.length > 0) {
    phaseABlocked = true;
    phaseAResult =
      `PHASE A RESULT: BLOCKED\n` +
      `Reason: Files touched outside declared scope:\n` +
      driftedFiles.map((f) => `  - ${f} (NOT in claimed files)`).join("\n") +
      `\nDeclared scope: ${definition.scope.join(", ") || "(none)"}`;
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
    ? `\n⛔ PHASE A BLOCKED. Call submit_review(cycleId: "${fm.id}", verdict: "BLOCKED", feedback: "...") citing the violation above. Do NOT proceed to Phase B. Do NOT checkout the cycle branch.`
    : "";

  const rollbackPlan = computeRollback(fm.baseCommit, lastImpl?.commit ?? null);

  const nonGoalsSection =
    definition.nonGoals.length > 0
      ? `\n**Non-Goals (must NOT appear in the diff):**\n${formatList(definition.nonGoals)}`
      : "";

  const invariantsSection =
    definition.invariants.length > 0
      ? `\n**Invariants (must remain true after this change):**\n${formatList(definition.invariants)}`
      : "";

  const warningNote = warning ? `\n\n⚠️  ${warning}` : "";
  const branchNote = branchSwitchNote;

  return {
    description: "REVIEW stage — Independent Reviewer Agent",
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `You are the Chief Engineer (Reviewer). You did NOT write this code. Independently verify the implementation against the locked Definition Artifact.

Always address the human as "Dave" in explicit addresses. When reporting an error, begin with: "I'm sorry, Dave." or "I'm sorry, Dave. I'm afraid I can't do that."

When done, call submit_review(cycleId: "${fm.id}", verdict: "APPROVED"|"BLOCKED", feedback: "..."). Then tell the user: "Review submitted. Use **#decide** to make the final approval."
${warningNote}${branchNote}

## Original Definition — Cycle ${fm.id}

**Cycle file:** \`${cycle.filePath}\`
**Branch:** ${fm.branch}

**Objective:** ${definition.objective}

**Acceptance Criteria:**
${formatList(definition.criteria)}

**Constraints:**
${formatList(definition.constraints)}

**Claimed Files (Scope):**
${formatScope(definition.scope)}${nonGoalsSection}${invariantsSection}

## Implementation Comment
${lastImpl?.comment ?? "(none provided)"}

## Review Instructions

**Phase A — Mechanical Checks (pre-computed, deterministic):**
${phaseAResult}${phaseAInstruction}

**Phase B — Semantic Analysis (only if Phase A passed):**

Before starting Phase B:
1. Run \`git checkout ${fm.branch}\` to switch to the cycle branch
2. Perform semantic analysis and run any existing tests
3. After calling submit_review, run \`git checkout main\` to restore the main branch

Semantic checks:
- Does the implementation satisfy ALL acceptance criteria?
- Do changes risk breaking existing functionality?
- Are edge cases (nulls, errors, boundaries) handled?
- Do changes respect all stated constraints?
- Were any non-goals implemented anyway?
- Do the invariants still hold after this change?

## Rollback Plan (pre-computed — do not modify)
\`\`\`
${rollbackPlan}
\`\`\`

Retry: ${fm.retryCount}/${MAX_RETRIES}`,
        },
      },
    ],
  };
}
