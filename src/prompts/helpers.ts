import type { CycleData } from "../cycles/types.js";
import { MAX_RETRIES } from "../constants.js";

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

