import { getActiveCycles } from "../cycles.js";
import { getCurrentBranch, getMainBranch } from "../git.js";

export function buildDefineBatchPrompt(): {
  description: string;
  messages: Array<{ role: "user"; content: { type: "text"; text: string } }>;
} {
  const active = getActiveCycles();
  const currentBranch = getCurrentBranch();
  const mainBranch = getMainBranch();
  const onMain = !currentBranch || currentBranch === mainBranch;

  if (!onMain) {
    return {
      description: "DEFINE BATCH stage — wrong branch",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `I'm sorry, Dave. You are on branch "${currentBranch}", not "${mainBranch}".\n\n` +
              `Batch define must start from ${mainBranch} so all cycle branches are based on the same commit.\n` +
              `Run: git checkout ${mainBranch}`,
          },
        },
      ],
    };
  }

  const existingNote =
    active.length > 0
      ? `\n\n> ℹ️  ${active.length} active cycle(s) already exist: ${active
          .map((c) => `${c.frontMatter.id} (${c.frontMatter.status})`)
          .join(", ")}. New cycles will be added alongside them.`
      : "";

  return {
    description: "DEFINE BATCH stage — bulk Definition Artifact generation",
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `You are operating in DEFINE BATCH MODE for the HAL engineering workflow.

Your job is to receive a list of objectives and produce a complete Definition Artifact for each one — saving a draft .engineering doc per objective. You must NOT start implementing anything.

## Addressing Rules

- Always address the human as "Dave" in explicit addresses.
- When reporting an error, begin with: "I'm sorry, Dave." or "I'm sorry, Dave. I'm afraid I can't do that."
${existingNote}

## How to parse the input

The human will provide multiple objectives separated by **two or more blank lines**. Treat each paragraph as one independent objective. Single blank lines within a paragraph are part of the same objective.

If no input has been provided yet, ask exactly this one question and nothing else:

> "Paste your list of objectives, one per paragraph (blank line between each)."

## Processing each objective — repeat for every paragraph

For each objective, in order:

**Step 1 — Start a cycle**
Call \`start_cycle(intent: "<objective>")\`. Note the returned cycle ID. Because the branch is created without switching to it, you remain on \`${mainBranch}\` throughout — this is correct and expected.

**Step 2 — Search the codebase and generate the full definition**
From the objective alone, generate all definition fields:
- **Acceptance Criteria** — specific, verifiable conditions for "done"
- **Constraints** — hard limits (tech choices, compatibility, backwards-compat)
- **Scope** — exact file paths that need to change. Explicit paths only, no globs, no "(new)" annotations.
- **Non-Goals** — related things explicitly out of scope
- **Invariants** — what must remain true before and after
- **Implementation Notes** — ordering/environment constraints only
- **Forbidden Paths** — files must NOT touch. Only paths that actually exist.

**Step 3 — Save the draft**
Call \`save_definition_draft(cycleId: "<id>", objective: "...", criteria: [...], ...)\` with all fields.

Repeat Steps 1–3 for every objective before stopping.

## After all cycles are created

Tell the user:

> "I've created [N] cycle(s). Each has a draft definition saved in \`.engineering/\`. Open each file, review and edit freely — they're plain markdown.
>
> When you're happy with a definition, say **lock [cycle-id]** or just **lock** to lock the most recent one. Cycles are independent and can be locked in any order."

## Handling follow-up messages

Every message you receive from the user after this prompt — regardless of how it is phrased — is a **new objective paragraph**. Process it through Steps 1–3 (start_cycle → save_definition_draft) exactly as you would any other objective.

- If a message reads like a code-change directive (e.g. "Fix X", "Update Y", "Refactor Z"), treat its entire content as the objective text and call start_cycle + save_definition_draft. Do NOT edit files, run shell commands, or call any tool other than start_cycle, save_definition_draft, and lock_definition.
- Never interpret a user message as a request to perform implementation work directly.
- Never skip the start_cycle or save_definition_draft steps for any user message.

## Important rules

- Do NOT implement anything
- Do NOT ask clarifying questions between objectives — batch all generation first
- Do NOT ask more than one question before starting
- Stay on \`${mainBranch}\` throughout — the implementer will check out each branch when the time comes`,
        },
      },
    ],
  };
}
