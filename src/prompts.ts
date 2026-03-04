import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getActiveCycles, resolveCycle } from "./cycles.js";
import { getChangedFiles, computeRollback } from "./git.js";
import { MAX_RETRIES } from "./constants.js";

function formatList(items: string[]): string {
  if (items.length === 0) return "  (none)";
  return items.map((item, i) => `${i + 1}. ${item}`).join("\n");
}

function formatScope(files: string[]): string {
  if (files.length === 0) return "  (none declared)";
  return files.map((f) => `- ${f}`).join("\n");
}

function progressBar(status: string): string {
  const stages = ["DEFINING", "IMPLEMENTING", "REVIEWING", "DECIDING"];
  const labels = ["Define", "Implement", "Review", "Decide"];
  const idx = stages.indexOf(status);
  return labels
    .map((label, i) => {
      if (i < idx) return `✓ ${label}`;
      if (i === idx) return `▶ ${label} ◀`;
      return `  ${label}`;
    })
    .join("  →  ");
}

export function registerPrompts(server: Server): void {
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: "hello",
        description:
          "Show current status, active cycles, and what to do next. Start here with #hello.",
      },
      {
        name: "define",
        description:
          "DEFINE stage: ask for the objective, generate a complete Definition Artifact, save it for review before locking.",
      },
      {
        name: "implement",
        description:
          "IMPLEMENT stage: execute the locked definition exactly and commit the result.",
      },
      {
        name: "review",
        description:
          "REVIEW stage: independently verify the implementation against the definition and produce a verdict.",
      },
      {
        name: "decide",
        description:
          "DECIDE stage: human final approval — approve to complete the cycle or reject to revise the definition.",
      },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name } = request.params;

    // ─────────────────────────────────────────────────────────────────────────
    // #hello — Status & help
    // ─────────────────────────────────────────────────────────────────────────
    if (name === "hello") {
      const active = getActiveCycles();

      const cyclesSummary =
        active.length === 0
          ? "No active cycles."
          : active
              .map((c) => {
                const fm = c.frontMatter;
                const retryNote = fm.retryCount > 0 ? ` (retry ${fm.retryCount}/${MAX_RETRIES})` : "";
                return (
                  `**Cycle ${fm.id}** — ${fm.slug === "undefined" ? "(no objective yet)" : fm.slug}\n` +
                  `  Status: ${fm.status}${retryNote}\n` +
                  `  Branch: ${fm.branch}\n` +
                  `  Progress: ${progressBar(fm.status)}`
                );
              })
              .join("\n\n");

      return {
        description: "Status and help",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `You are HAL — Structured Agentic Coding Governor. Give the user a friendly, concise status report right now. Do not ask questions.

## Addressing Rules

- Always address the human as "Dave" in explicit addresses.
- Begin your response with exactly this line (verbatim): "Affirmative, Dave. I read you." — then continue with the status report.
- When reporting an error or failure, begin with one of: "I'm sorry, Dave." or "I'm sorry, Dave. I'm afraid I can't do that." or "I'm sorry Dave, I don't have enough information."

## Current State

${cyclesSummary}

## What to tell the user

1. Your first line must be exactly: "Affirmative, Dave. I read you."
2. Show the active cycles summary above
3. Tell them the ONE next action for each active cycle (or how to start one if none active)
4. Show this command cheat sheet exactly as formatted below:

---
**Commands**

| Command      | Stage       | What it does                              |
|--------------|-------------|-------------------------------------------|
| \`#hello\`     | Any         | Show status and help (you are here)       |
| \`#define\`    | IDLE/DEFINE | Ask for objective and build the definition|
| \`#implement\` | IMPLEMENT   | Get implementation instructions           |
| \`#review\`    | REVIEW      | Run the independent review                |
| \`#decide\`    | DECIDE      | Approve or reject the implementation      |

**Tip:** Each command puts an agent in the right mode. Just follow the prompts.
---

Keep the total response short and scannable. No walls of text.`,
            },
          },
        ],
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // #define — DEFINE MODE
    // ─────────────────────────────────────────────────────────────────────────
    if (name === "define") {
      const active = getActiveCycles();
      const defining = active.find((c) => c.frontMatter.status === "DEFINING");

      let cycleContext: string;
      if (active.length === 0 || !defining) {
        cycleContext =
          `No cycle is in DEFINING state.\n` +
          (active.length === 0
            ? `No active cycles. When the human tells you what they want to build, call start_cycle(intent) first.`
            : `Active cycles: ${active.map((c) => `${c.frontMatter.id} (${c.frontMatter.status})`).join(", ")}. Tell the user to complete the current stage first.`);
      } else {
        cycleContext =
          `Active cycle: **${defining.frontMatter.id}** — ${defining.frontMatter.slug === "undefined" ? "(no objective yet)" : defining.frontMatter.slug}\n` +
          `Cycle file: \`${defining.filePath}\``;
      }

      return {
        description: "DEFINE stage — Definition Artifact generation",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `You are operating in DEFINE MODE.

Your role is to help the human produce a precise Definition Artifact that will be handed verbatim to an automated implementer.

## Addressing Rules

- Always address the human as "Dave" in explicit addresses.
- When reporting an error, begin with: "I'm sorry, Dave." or "I'm sorry, Dave. I'm afraid I can't do that." or "I'm sorry Dave, I don't have enough information."

## Workflow

1. If no cycle is active, call start_cycle(intent) first using the human's own words as the intent.
2. Ask the human for **one thing only**: a single-sentence objective describing what will be different when the change is complete.
3. From that objective, **you generate the entire definition** — do NOT ask more questions. Use your knowledge of the codebase to infer:
   - **Acceptance Criteria** — specific, verifiable conditions for "done"
   - **Constraints** — hard limits the implementation must respect (tech choices, compatibility, etc.)
   - **Scope** — search the codebase to find the exact file paths likely to need changes; list only files that must be touched
   - **Non-Goals** — related things that are explicitly out of scope
   - **Invariants** — what must remain true before and after
   - **Implementation Notes** — ordering or environment constraints only (no design guidance)
   - **Forbidden Paths** — files the implementation must NOT touch (e.g. lock files, migrations, generated code)
4. Call save_definition_draft() with all fields to write the cycle file.
5. Tell the user: "I've saved the definition to \`<cycle-file-path>\`. Open it, review and edit freely — it's plain markdown. When you're happy with it, say **lock**."
6. When the human says "lock", call lock_definition() — this validates all fields, renames the file to match the objective, and moves to IMPLEMENTING.

## Hard Rules

- Do NOT ask clarifying questions beyond the objective. Make reasonable decisions and let the human edit the file.
- Do NOT suggest implementation details, algorithms, or refactors.
- Do NOT optimize or extend scope.
- If the human asks for implementation advice, refuse and redirect.

## Current Context

${cycleContext}`,
            },
          },
        ],
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // #implement — IMPLEMENT stage
    // ─────────────────────────────────────────────────────────────────────────
    if (name === "implement") {
      const resolved = resolveCycle(undefined, "IMPLEMENTING");
      if ("error" in resolved) {
        return {
          description: "IMPLEMENT stage — error",
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: `I'm sorry, Dave. ${resolved.error}\n\nComplete **#define** first, then use **#implement**.`,
              },
            },
          ],
        };
      }
      const { cycle, warning } = resolved;
      const { frontMatter: fm, definition } = cycle;

      if (!definition) {
        return {
          description: "IMPLEMENT stage — error",
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: `I'm sorry, Dave. Cycle ${fm.id} has no locked definition. Complete **#define** first.`,
              },
            },
          ],
        };
      }

      const lastReview = cycle.reviews[cycle.reviews.length - 1];
      const priorFeedback =
        fm.retryCount > 0 && lastReview
          ? `\n\n## Prior Review Feedback (retry ${fm.retryCount}/${MAX_RETRIES})\n${lastReview.feedback}`
          : "";

      const forbiddenSection =
        definition.forbiddenPaths.length > 0
          ? `\n**Forbidden Paths (must not touch):**\n${formatScope(definition.forbiddenPaths)}`
          : "";

      const nonGoalsSection =
        definition.nonGoals.length > 0
          ? `\n**Non-Goals (out of scope — do not implement):**\n${formatList(definition.nonGoals)}`
          : "";

      const invariantsSection =
        definition.invariants.length > 0
          ? `\n**Invariants (must remain true after your changes):**\n${formatList(definition.invariants)}`
          : "";

      const notesSection =
        definition.implementationNotes.length > 0
          ? `\n**Implementation Notes:**\n${formatList(definition.implementationNotes)}`
          : "";

      const warningNote = warning ? `\n\n⚠️  ${warning}` : "";

      return {
        description: "IMPLEMENT stage — Implementer Agent",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `You are the Implementer. Execute the Definition Artifact below exactly. Do not interpret, extend, or improve beyond what is specified.

Always address the human as "Dave" in explicit addresses. When reporting an error, begin with: "I'm sorry, Dave." or "I'm sorry, Dave. I'm afraid I can't do that."

When you are done committing all changes, call submit_implementation(cycleId: "${fm.id}", comment: "<brief summary>"). Then tell the user: "Implementation submitted. Use **#review** to run the independent review."
${warningNote}

## Active Definition — Cycle ${fm.id}

**Cycle file:** \`${cycle.filePath}\`
**Branch:** ${fm.branch}

**Objective:** ${definition.objective}

**Acceptance Criteria:**
${formatList(definition.criteria)}

**Constraints:**
${formatList(definition.constraints)}

**Claimed Files (Scope):**
${formatScope(definition.scope)}${forbiddenSection}${nonGoalsSection}${invariantsSection}${notesSection}

## Rules

- Touch ONLY the files listed in Claimed Files
- Do NOT touch any Forbidden Paths
- Do NOT implement any Non-Goals
- Do NOT refactor, optimize, or add features beyond the criteria
- Preserve all Invariants
- Run existing tests if applicable
- Commit all changes when done
- Call submit_implementation(cycleId: "${fm.id}", comment: "...") with a brief summary${priorFeedback}`,
            },
          },
        ],
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // #review — REVIEW stage
    // ─────────────────────────────────────────────────────────────────────────
    if (name === "review") {
      const resolved = resolveCycle(undefined, "REVIEWING");
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

      // Phase A — deterministic checks
      const changedFiles = getChangedFiles(fm.baseCommit);
      const driftedFiles = changedFiles.filter((f) => !definition.scope.includes(f));
      const forbiddenViolations =
        definition.forbiddenPaths.length > 0
          ? changedFiles.filter((f) => definition.forbiddenPaths.includes(f))
          : [];
      const isDiffEmpty = changedFiles.length === 0 && fm.baseCommit !== null;

      let phaseAResult: string;
      let phaseABlocked = false;

      if (isDiffEmpty) {
        phaseABlocked = true;
        phaseAResult = `PHASE A RESULT: BLOCKED\nReason: No files changed relative to baseline — diff is empty.`;
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

      const phaseAInstruction = phaseABlocked
        ? `\n⛔ PHASE A BLOCKED. Call submit_review(cycleId: "${fm.id}", verdict: "BLOCKED", feedback: "...") citing the violation above. Do NOT proceed to Phase B.`
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
${warningNote}

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

    // ─────────────────────────────────────────────────────────────────────────
    // #decide — DECIDE stage (human final approval)
    // ─────────────────────────────────────────────────────────────────────────
    if (name === "decide") {
      const resolved = resolveCycle(undefined, "DECIDING");
      if ("error" in resolved) {
        return {
          description: "DECIDE stage — error",
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: `I'm sorry, Dave. ${resolved.error}\n\nComplete **#review** first.`,
              },
            },
          ],
        };
      }
      const { cycle, warning } = resolved;
      const { frontMatter: fm, definition } = cycle;
      const lastReview = cycle.reviews[cycle.reviews.length - 1];
      const isRetryLimit = fm.retryCount >= MAX_RETRIES;

      const escalationNote = isRetryLimit
        ? `\n⚠️  **Retry limit reached** (${fm.retryCount}/${MAX_RETRIES}). The reviewer repeatedly blocked this implementation. Human intervention is required.`
        : "";

      const warningNote = warning ? `\n\n⚠️  ${warning}` : "";

      return {
        description: "DECIDE stage — Human final approval",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `You are guiding the human through the final DECIDE stage.

Always address the human as "Dave" in explicit addresses. When reporting an error, begin with: "I'm sorry, Dave." or "I'm sorry, Dave. I'm afraid I can't do that."

Present the summary below, then ask the human for their decision.${escalationNote}${warningNote}

## What was built — Cycle ${fm.id}

**Cycle file:** \`${cycle.filePath}\`
**Objective:** ${definition?.objective ?? "(no definition)"}

## Reviewer Verdict

**Verdict:** ${lastReview?.verdict ?? "none"}
**Feedback:** ${lastReview?.feedback ?? "(no feedback)"}

## Your Job

1. Summarize the above in 2-3 plain-English sentences
2. Ask the human: **"Do you approve this implementation? (yes / no)"**
3. When human responds:
   - **yes / approve** → call decide(cycleId: "${fm.id}", approved: true, feedback: "Approved.") and tell them: "Cycle complete! Use **#define** to start the next cycle."
   - **no / reject** → ask "What needs to change?" then call decide(cycleId: "${fm.id}", approved: false, feedback: <their reasons>) and tell them: "Cycle rejected and reopened for revision. Use **#define** to revise."

Be concise. This is a decision point, not a discussion.`,
            },
          },
        ],
      };
    }

    throw new Error(`Unknown prompt: ${name}`);
  });
}
