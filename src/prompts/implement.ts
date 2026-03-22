import { getActiveCycles } from "../cycles.js";
import { MAX_RETRIES } from "../constants.js";
import { formatList, formatScope } from "./helpers.js";

export function buildImplementPrompt(): {
  description: string;
  messages: Array<{ role: "user"; content: { type: "text"; text: string } }>;
} {
  const active = getActiveCycles();
  const implementing = active.filter((c) => c.frontMatter.status === "IMPLEMENTING");

  if (implementing.length === 0) {
    return {
      description: "IMPLEMENT stage — no cycles ready",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `I'm sorry, Dave. No cycles are in IMPLEMENTING state.\n\nActive cycles: ${
                active.length === 0
                  ? "none"
                  : active
                      .map((c) => `${c.frontMatter.id} (${c.frontMatter.status})`)
                      .join(", ")
              }\n\nComplete **#define** first, then use **#implement**.`,
          },
        },
      ],
    };
  }

  const cycleBlocks = implementing
    .map((cycle) => {
      const fm = cycle.frontMatter;
      const def = cycle.definition;
      if (!def) return `### Cycle ${fm.id}\n⚠️  No locked definition — skip this cycle.`;

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
        `### Cycle ${fm.id} — ${def.objective}\n\n` +
        `**Cycle file:** \`${cycle.filePath}\`\n` +
        `**Branch:** ${fm.branch}\n\n` +
        `**Acceptance Criteria:**\n${formatList(def.criteria)}\n\n` +
        `**Constraints:**\n${formatList(def.constraints)}\n\n` +
        `**Claimed Files (Scope):**\n${formatScope(def.scope)}` +
        `${forbiddenSection}${nonGoalsSection}${invariantsSection}${notesSection}` +
        `${priorFeedback}\n\n` +
        `When done: call \`submit_implementation(cycleId: "${fm.id}", comment: "...")\`\n` +
        `Then: check out the main branch to return to it: git checkout ${fm.baseBranch ?? "main"}`
      );
    })
    .join("\n\n---\n\n");

  const cycleIds = implementing.map((c) => c.frontMatter.id).join(", ");

  const multiCycleWarning =
    implementing.length > 1
      ? `\n> ⚠️  **Multiple cycles are IMPLEMENTING (${implementing.length} total: ${cycleIds}).** Implement them SEQUENTIALLY — one branch at a time. For each cycle: checkout its branch, implement, commit, call submit_implementation(), then move to the next. Do NOT work on two branches simultaneously.

`
      : "";

  return {
    description: "IMPLEMENT stage — Implementer Agent",
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `You are the Implementer. You have ${implementing.length} cycle(s) ready to implement: **${cycleIds}**.
${multiCycleWarning}
Execute each Definition Artifact exactly. Do not interpret, extend, or improve beyond what is specified.

Always address the human as "Dave" in explicit addresses. When reporting an error, begin with: "I'm sorry, Dave." or "I'm sorry, Dave. I'm afraid I can't do that."

For each cycle below:
1. Check out its branch (if not already on it)
2. Call \`rebase_on_base_branch(cycleId: "...")\` to sync with the base branch and update baseCommit
3. Implement exactly what the definition specifies
4. Run existing tests if applicable
5. Commit all changes
6. Call submit_implementation(cycleId: "...", comment: "...") with a brief summary
7. Check out the main branch to return to it: git checkout main

## Implementation Rules

- Touch ONLY the files listed in Claimed Files for each cycle
- Do NOT touch any Forbidden Paths
- Do NOT implement any Non-Goals
- Do NOT refactor, optimize, or add features beyond the criteria
- Preserve all Invariants

---

${cycleBlocks}`,
        },
      },
    ],
  };
}
