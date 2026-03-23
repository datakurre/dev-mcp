import { getActiveCycles } from "../cycles.js";
import { buildCycleReviewPrompt } from "./helpers.js";

/**
 * Builds a prompt that instructs the current agent to invoke the `claude` CLI
 * once per REVIEWING cycle, passing a self-contained review prompt as the argument.
 *
 * Uses claude-haiku-4-5 (a lightweight model) for cost-efficient review delegation.
 *
 * Flags used:
 *   --model claude-haiku-4-5         lightweight model for review
 *   --dangerously-skip-permissions   bypass all permission prompts (equivalent to "allow all tools + paths")
 *   --print                          non-interactive, exit when done
 */
export function buildReviewBatchClaudePrompt(): {
  description: string;
  messages: Array<{ role: "user"; content: { type: "text"; text: string } }>;
} {
  const active = getActiveCycles();
  const reviewing = active.filter((c) => c.frontMatter.status === "REVIEWING");

  if (reviewing.length === 0) {
    return {
      description: "REVIEW BATCH (claude) — no cycles ready",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `I'm sorry, Dave. No cycles are in REVIEWING state.\n\nActive cycles: ${
                active.length === 0
                  ? "none"
                  : active.map((c) => `${c.frontMatter.id} (${c.frontMatter.status})`).join(", ")
              }\n\nComplete **#implement** first.`,
          },
        },
      ],
    };
  }

  const cycleInstructions = reviewing
    .map((cycle) => {
      const prompt = buildCycleReviewPrompt(cycle);
      const promptPath = `/tmp/cycle_${cycle.frontMatter.id}_review_prompt.txt`;
      return (
        `### Cycle ${cycle.frontMatter.id} — ${cycle.definition?.objective ?? "(no definition)"}\n\n` +
        `**Step 1** — Use the \`create_file\` tool to write the following content to \`${promptPath}\`:\n\n` +
        "```\n" + prompt + "\n```\n\n" +
        `**Step 2** — Run in terminal:\n\n` +
        "```bash\n" +
        `claude --model claude-haiku-4-5 --dangerously-skip-permissions --print @${promptPath}\n` +
        "```"
      );
    })
    .join("\n\n---\n\n");

  const cycleIds = reviewing.map((c) => c.frontMatter.id).join(", ");

  return {
    description: "REVIEW BATCH (claude) — delegate each cycle to claude CLI",
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `You are the Orchestrator. You have ${reviewing.length} cycle(s) to dispatch for review using the \`claude\` CLI: **${cycleIds}**.

**Do NOT review anything yourself.** Your sole job is to execute the steps below — one cycle at a time, sequentially — and report the output.

For each cycle:
1. Use the \`create_file\` tool to write the prompt to the specified temp file path
2. Run the \`claude\` command shown (it reads the prompt via \`@file\`)
3. Wait for it to complete
4. Report whether it succeeded or failed
5. Move to the next cycle

## Cycles to execute (run sequentially)

${cycleInstructions}

After all cycles complete, summarise which cycles succeeded and which (if any) failed, then tell the user: "Review complete. Use **#decide** to make the final approval."`,
        },
      },
    ],
  };
}
