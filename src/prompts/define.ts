import { getActiveCycles } from "../cycles.js";
import { getCurrentBranch, getMainBranch } from "../git.js";

export function buildDefinePrompt(): {
  description: string;
  messages: Array<{ role: "user"; content: { type: "text"; text: string } }>;
} {
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
- **Scope** — exact file paths that need to change (search the codebase). Use explicit paths only — no glob patterns, no wildcards. Do NOT add parenthetical annotations like "(new)" or "(if needed)".
- **Non-Goals** — related things explicitly out of scope
- **Invariants** — what must remain true before and after
- **Implementation Notes** — ordering/environment constraints only
- **Forbidden Paths** — files must NOT touch (lock files, generated code, migrations). Only include paths that actually exist in the codebase — do not add hypothetical or non-existent paths.

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
