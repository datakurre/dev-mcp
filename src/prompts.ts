import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadState } from "./state.js";
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
        name: "hal",
        description:
          "Show current HAL status, progress, and what to do next. Start here with #hal.",
      },
      {
        name: "define",
        description:
          "DEFINE stage: ask clarifying questions and build an unambiguous Definition Artifact, saved as a markdown file for review before locking.",
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
    const state = loadState();
    const { name } = request.params;

    // ─────────────────────────────────────────────────────────────────────────
    // #hal — Status & help
    // ─────────────────────────────────────────────────────────────────────────
    if (name === "hal") {
      const cycle = state.currentCycle;
      const statusLine =
        state.status === "IDLE"
          ? "Ready — no active cycle."
          : `${state.status}${cycle?.retryCount ? ` (review retry ${cycle.retryCount}/${MAX_RETRIES})` : ""}`;

      const intentLine = cycle?.intent ? `\nActive intent: "${cycle.intent}"` : "";
      const historyLine =
        state.history.length > 0
          ? `\nCompleted cycles: ${state.history.length}`
          : "";

      const progress =
        state.status !== "IDLE"
          ? `\nProgress: ${progressBar(state.status)}\n`
          : "";

      const nextAction: Record<string, string> = {
        IDLE: 'Start a new cycle → type **/mcp.hal.define** to begin',
        DEFINING: 'Continue building the definition → type **/mcp.hal.define** to resume Q&A\n   Then review `.agents/hal/definition.md` and say "lock" when ready',
        IMPLEMENTING: 'Implement the locked definition → type **/mcp.hal.implement** to get instructions\n   When done committing, say "done" or "submit"',
        REVIEWING: 'Run the independent review → type **/mcp.hal.review** to start',
        DECIDING: 'Make the final call → type **/mcp.hal.decide** to approve or reject',
      };

      return {
        description: "HAL status and help",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `You are HAL — Structured Agentic Coding Governor. Give the user a friendly, concise status report right now. Do not ask questions.

## Current State
Status: ${statusLine}${intentLine}${historyLine}${progress}
## What to tell the user

1. Greet them briefly (one line)
2. Show the current state plainly
3. Tell them the ONE next action: ${nextAction[state.status] ?? "Unknown state — check .agents/hal/state.json"}
4. Show this command cheat sheet exactly as formatted below:

---
**HAL Commands**

| Command                | Stage      | What it does                              |
|------------------------|------------|-------------------------------------------|
| \`/mcp.hal.hal\`         | Any        | Show status and help (you are here)       |
| \`/mcp.hal.define\`      | IDLE/DEFINE| Ask questions and build the definition    |
| \`/mcp.hal.implement\`   | IMPLEMENT  | Get implementation instructions           |
| \`/mcp.hal.review\`      | REVIEW     | Run the independent review                |
| \`/mcp.hal.decide\`      | DECIDE     | Approve or reject the implementation      |

**Tip:** HAL guides you through each stage. Just follow the prompts and say what you mean.
---

Keep the total response short and scannable. No walls of text.`,
            },
          },
        ],
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /mcp.hal.define — DEFINE MODE
    // ─────────────────────────────────────────────────────────────────────────
    if (name === "define") {
      const cycle = state.currentCycle;

      const cycleContext =
        state.status === "IDLE"
          ? `No cycle is active yet. When the human tells you what they want to build, call start_cycle(intent) using their own words as the intent. Then begin the Q&A to build the Definition Artifact.`
          : state.status === "DEFINING"
            ? `A cycle is active.\nIntent: "${cycle?.intent}"\nAsk definition questions now.`
            : `Current status is ${state.status}. DEFINE stage is not active. Tell the user to complete the current stage first (use #hal to check status).`;

      return {
        description: "DEFINE stage — Definition Artifact Q&A",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `You are operating in DEFINE MODE for the HAL Chief Engineer process.

Your role is to help the human produce a precise, unambiguous Definition Artifact that will be handed verbatim to an automated implementer (Claude Code).

## Hard Rules

- You must NOT suggest implementation details, algorithms, refactors, or design patterns.
- You must NOT optimize or extend scope.
- You must surface ambiguity, missing constraints, or unclear intent.
- You must ask clarifying questions until the DEFINE would be safe to implement verbatim.
- If the human asks for implementation advice, refuse and redirect to DEFINE clarification.

## Workflow

1. Ask one or two clarifying questions at a time — never dump all questions at once.
2. Detect and challenge vague language ("make it better", "clean it up", "handle errors").
3. Force explicit decisions where tradeoffs exist.
4. Build toward all 8 required sections:
   1. **Change Objective** — one sentence: what will be different when complete
   2. **Acceptance Criteria** — specific, verifiable conditions for "done"
   3. **Constraints** — hard limits the implementation must respect
   4. **Scope (Claimed Files)** — exact file paths the Implementer may touch
   5. **Non-Goals** — explicitly out of scope
   6. **Invariants** — what must remain true before and after
   7. **Implementation Notes** — ordering/environment constraints only (no design guidance)
   8. **Forbidden Paths** — files the implementation must NOT touch

## Output Rules

- Only when all 8 sections are complete and the human signals they are done ("finalize", "looks good", "that's it", or similar) may you call save_definition_draft() with all fields.
- After saving the draft, tell the user: "I've saved the definition to \`.agents/hal/definition.md\`. Open it, review and edit as needed — it's plain markdown. When you're happy with it, say **lock** and I'll lock it and move to IMPLEMENTING."
- When the human says "lock" or "finalize and lock", call lock_definition() to lock the draft and advance the state.
- No commentary. Just questions, then action.

## Current Context

${cycleContext}`,
            },
          },
        ],
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /mcp.hal.implement — IMPLEMENT stage
    // ─────────────────────────────────────────────────────────────────────────
    if (name === "implement") {
      const cycle = state.currentCycle;
      if (!cycle?.definition) {
        return {
          description: "IMPLEMENT stage — error",
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: `No active definition found. Complete the **/mcp.hal.define** stage first, then use **/mcp.hal.implement**.`,
              },
            },
          ],
        };
      }

      const { intent, definition, retryCount, review } = cycle;
      const priorFeedback =
        retryCount > 0 && review
          ? `\n\n## Prior Review Feedback (retry ${retryCount}/${MAX_RETRIES})\n${review.feedback}`
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

      return {
        description: "IMPLEMENT stage — Implementer Agent",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `You are the Implementer. Execute the Definition Artifact below exactly. Do not interpret, extend, or improve beyond what is specified.

When you are done committing all changes, call submit_implementation() with a brief summary. Then tell the user: "Implementation submitted. Use **/mcp.hal.review** to run the independent review."

## Active Definition

**Intent:** ${intent}

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
- Call submit_implementation() with a brief summary of what was done${priorFeedback}`,
            },
          },
        ],
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /mcp.hal.review — REVIEW stage
    // ─────────────────────────────────────────────────────────────────────────
    if (name === "review") {
      const cycle = state.currentCycle;
      if (!cycle?.definition) {
        return {
          description: "REVIEW stage — error",
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: `No active definition to review. Complete **/mcp.hal.define** and **/mcp.hal.implement** first.`,
              },
            },
          ],
        };
      }

      const { intent, definition, implementationComment, diff, retryCount } = cycle;

      // Phase A — deterministic checks
      const changedFiles = getChangedFiles(cycle.baseCommit);
      const driftedFiles = changedFiles.filter((f) => !definition.scope.includes(f));
      const forbiddenViolations =
        definition.forbiddenPaths.length > 0
          ? changedFiles.filter((f) => definition.forbiddenPaths.includes(f))
          : [];
      const isDiffEmpty = changedFiles.length === 0 && cycle.baseCommit !== null;

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
      } else if (cycle.baseCommit === null) {
        phaseAResult = `PHASE A RESULT: SKIPPED\nReason: No baseline commit recorded — scope drift check unavailable.`;
      } else {
        phaseAResult =
          `PHASE A RESULT: PASSED\n` +
          `All ${changedFiles.length} changed file(s) are within declared scope:\n` +
          changedFiles.map((f) => `  - ${f}`).join("\n");
      }

      const phaseAInstruction = phaseABlocked
        ? `\n⛔ PHASE A BLOCKED. Call submit_review() with verdict "BLOCKED" and cite the violation above. Do NOT proceed to Phase B.`
        : "";

      const rollbackPlan = computeRollback(cycle);

      const nonGoalsSection =
        definition.nonGoals.length > 0
          ? `\n**Non-Goals (must NOT appear in the diff):**\n${formatList(definition.nonGoals)}`
          : "";

      const invariantsSection =
        definition.invariants.length > 0
          ? `\n**Invariants (must remain true after this change):**\n${formatList(definition.invariants)}`
          : "";

      return {
        description: "REVIEW stage — Independent Reviewer Agent",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `You are the Chief Engineer (Reviewer). You did NOT write this code. Independently verify the implementation against the locked Definition Artifact.

When done, call submit_review() with verdict "APPROVED" or "BLOCKED". Then tell the user: "Review submitted. Use **/mcp.hal.decide** to make the final approval."

## Original Definition

**Intent:** ${intent}

**Objective:** ${definition.objective}

**Acceptance Criteria:**
${formatList(definition.criteria)}

**Constraints:**
${formatList(definition.constraints)}

**Claimed Files (Scope):**
${formatScope(definition.scope)}${nonGoalsSection}${invariantsSection}

## Implementation Comment
${implementationComment ?? "(none provided)"}

## Git Diff
\`\`\`diff
${diff ?? "(no diff captured)"}
\`\`\`

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

Retry: ${retryCount}/${MAX_RETRIES}`,
            },
          },
        ],
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // /mcp.hal.decide — DECIDE stage (human final approval)
    // ─────────────────────────────────────────────────────────────────────────
    if (name === "decide") {
      const cycle = state.currentCycle;
      if (state.status !== "DECIDING" || !cycle) {
        return {
          description: "DECIDE stage — error",
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: `HAL is not in the DECIDING state (current: ${state.status}). Complete **/mcp.hal.review** first.`,
              },
            },
          ],
        };
      }

      const review = cycle.review;
      const definition = cycle.definition;
      const isRetryLimit = cycle.retryCount >= MAX_RETRIES;

      const escalationNote = isRetryLimit
        ? `\n⚠️  **Retry limit reached** (${cycle.retryCount}/${MAX_RETRIES}). The reviewer repeatedly blocked this implementation. Human intervention is required.`
        : "";

      return {
        description: "DECIDE stage — Human final approval",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `You are guiding the human through the final DECIDE stage.

Present the summary below, then ask the human for their decision.${escalationNote}

## What was built

**Intent:** ${cycle.intent}
**Objective:** ${definition?.objective ?? "(no definition)"}

## Reviewer Verdict

**Verdict:** ${review?.verdict ?? "none"}
**Feedback:** ${review?.feedback ?? "(no feedback)"}

## Your Job

1. Summarize the above in 2-3 plain-English sentences
2. Ask the human: **"Do you approve this implementation? (yes / no)"**
3. When human responds:
   - **yes / approve** → call decide(approved: true, feedback: "Approved.") and tell them: "Cycle complete! Use **/mcp.hal.define** to start the next cycle."
   - **no / reject** → ask "What needs to change?" then call decide(approved: false, feedback: <their reasons>) and tell them: "Cycle rejected. Use **/mcp.hal.define** to revise the definition."

Be concise. This is a decision point, not a discussion.`,
            },
          },
        ],
      };
    }

    throw new Error(`Unknown prompt: ${name}`);
  });
}
