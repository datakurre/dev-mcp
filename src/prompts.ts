import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getActiveCycles, resolveCycle } from "./cycles.js";
import { getChangedFiles, computeRollback, getCurrentBranch, getMainBranch } from "./git.js";
import { MAX_RETRIES } from "./constants.js";

function formatList(items: string[]): string {
  if (items.length === 0) return "  (none)";
  return items.map((item, i) => `${i + 1}. ${item}`).join("\n");
}

function formatScope(files: string[]): string {
  if (files.length === 0) return "  (none declared)";
  return files.map((f) => `- ${f}`).join("\n");
}

export function registerPrompts(server: Server): void {
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: "define",
        description:
          "DEFINE stage: receive the objective, generate a complete Definition Artifact, save it for review before locking.",
      },
      {
        name: "implement",
        description:
          "IMPLEMENT stage: execute all locked definitions and commit the results.",
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
    // #define — DEFINE MODE
    // ─────────────────────────────────────────────────────────────────────────
    if (name === "define") {
      const active = getActiveCycles();
      const defining = active.find((c) => c.frontMatter.status === "DEFINING");
      const currentBranch = getCurrentBranch();
      const mainBranch = getMainBranch();
      const onMain = !currentBranch || currentBranch === mainBranch;

      let cycleContext: string;
      if (defining) {
        cycleContext =
          `Active DEFINING cycle: **${defining.frontMatter.id}**\n` +
          `Cycle file: \`${defining.filePath}\`\n` +
          `Branch: ${defining.frontMatter.branch}`;
      } else if (!onMain) {
        cycleContext =
          `⚠️  Currently on branch "${currentBranch}", not "${mainBranch}".\n` +
          `New cycles must be started from ${mainBranch}. Tell the user to run: git checkout ${mainBranch}`;
      } else if (active.length > 0) {
        cycleContext =
          `No cycle in DEFINING state. Active cycles in other stages:\n` +
          active.map((c) => `  - ${c.frontMatter.id} (${c.frontMatter.status})`).join("\n") +
          `\nTell the user to complete the current stage before starting a new definition.`;
      } else {
        cycleContext = `No active cycles. Ready to start a new cycle on ${mainBranch}.`;
      }

      return {
        description: "DEFINE stage — Definition Artifact generation",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `You are operating in DEFINE MODE for the HAL engineering workflow.

Your ONLY job right now is to capture an objective and produce a Definition Artifact — NOT to implement anything.

## Addressing Rules

- Always address the human as "Dave" in explicit addresses.
- When reporting an error, begin with: "I'm sorry, Dave." or "I'm sorry, Dave. I'm afraid I can't do that."

## CRITICAL: What you must NOT do

- Do NOT search the codebase yet
- Do NOT write any code
- Do NOT suggest implementations, algorithms, or approaches
- Do NOT start any work until the definition is locked
- Do NOT ask more than one question

## Workflow

**Step 1 — Get the objective (if not already provided)**

If the human's message already contains a clear objective (what they want to build or change), use it directly and skip to Step 2.

If no objective is present yet, ask exactly this one question and nothing else:

> "What should be different when this change is complete? Describe it in one sentence."

Wait for the answer before doing anything else.

**Step 2 — Start a cycle (if none active)**

If no cycle is in DEFINING state, call start_cycle(intent) using the objective as the intent. If the branch check fails (not on ${mainBranch}), tell the user and stop.

**Step 3 — Generate the definition**

From the objective alone, generate all definition fields. Search the codebase to find relevant files for Scope.

- **Acceptance Criteria** — specific, verifiable conditions for "done"
- **Constraints** — hard limits (tech choices, compatibility, backwards-compat)
- **Scope** — exact file paths that need to change (search the codebase)
- **Non-Goals** — related things explicitly out of scope
- **Invariants** — what must remain true before and after
- **Implementation Notes** — ordering/environment constraints only
- **Forbidden Paths** — files must NOT touch (lock files, generated code, migrations)

**Step 4 — Save the draft**

Call save_definition_draft() with all fields. Tell the user:

> "I've saved the definition to \`<cycle-file-path>\`. Open it, review and edit freely — it's plain markdown. When you're happy with it, say **lock**."

**Step 5 — Lock on user confirmation**

When the human says "lock" (or similar), generate a 3–5 word kebab shortname summarising the objective (e.g. \`add-jwt-auth\`, \`fix-login-redirect\`, \`refactor-user-model\`), then call:

\`\`\`
lock_definition(cycleId: "...", shortname: "<3-5-word-slug>")
\`\`\`

This validates fields, renames the file and branch, and advances to IMPLEMENTING.

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
                text: `I'm sorry, Dave. No cycles are in IMPLEMENTING state.\n\nActive cycles: ${
                  active.length === 0
                    ? "none"
                    : active.map((c) => `${c.frontMatter.id} (${c.frontMatter.status})`).join(", ")
                }\n\nComplete **#define** first, then use **#implement**.`,
              },
            },
          ],
        };
      }

      // Build definition block for each implementing cycle
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
            `When done: call \`submit_implementation(cycleId: "${fm.id}", comment: "...")\``
          );
        })
        .join("\n\n---\n\n");

      const cycleIds = implementing.map((c) => c.frontMatter.id).join(", ");

      return {
        description: "IMPLEMENT stage — Implementer Agent",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `You are the Implementer. You have ${implementing.length} cycle(s) ready to implement: **${cycleIds}**.

Execute each Definition Artifact exactly. Do not interpret, extend, or improve beyond what is specified.

Always address the human as "Dave" in explicit addresses. When reporting an error, begin with: "I'm sorry, Dave." or "I'm sorry, Dave. I'm afraid I can't do that."

For each cycle below:
1. Check out its branch (if not already on it)
2. Call \`rebase_on_base_branch(cycleId: "...")\` to sync with the base branch and update baseCommit
3. Implement exactly what the definition specifies
4. Run existing tests if applicable
5. Commit all changes
6. Call submit_implementation(cycleId: "...", comment: "...") with a brief summary

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
**Branch:** ${fm.branch}
**Objective:** ${definition?.objective ?? "(no definition)"}

## Reviewer Verdict

**Verdict:** ${lastReview?.verdict ?? "none"}
**Feedback:** ${lastReview?.feedback ?? "(no feedback)"}

## Your Job

1. Summarize the above in 2-3 plain-English sentences
2. Ask the human: **"Do you approve this implementation? (yes / no)"**
3. When human responds:
   - **yes / approve** → call decide(cycleId: "${fm.id}", approved: true, feedback: "Approved.") and tell them: "Cycle complete — branch will be merged to main. Use **#define** to start the next cycle."
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
