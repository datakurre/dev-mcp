import { getActiveCycles } from "../cycles.js";
import { buildCycleDecidePrompt } from "./helpers.js";

/**
 * Builds a prompt that instructs the current agent to invoke the `claude` CLI
 * once per DECIDING cycle, passing a self-contained decide prompt as the argument.
 *
 * Uses claude-haiku-4-5 (a lightweight model) for cost-efficient decide delegation.
 *
 * Flags used:
 *   --model claude-haiku-4-5         lightweight model for decide
 *   --dangerously-skip-permissions   bypass all permission prompts (equivalent to "allow all tools + paths")
 *   --print                          non-interactive, exit when done
 */
export function buildDecideBatchClaudePrompt(): {
  description: string;
  messages: Array<{ role: "user"; content: { type: "text"; text: string } }>;
} {
  const active = getActiveCycles();
  const deciding = active.filter((c) => c.frontMatter.status === "DECIDING");

  if (deciding.length === 0) {
    return {
      description: "DECIDE BATCH (claude) — no cycles ready",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `I'm sorry, Dave. No cycles are in DECIDING state.\n\nActive cycles: ${
              active.length === 0
                ? "none"
                : active.map((c) => `${c.frontMatter.id} (${c.frontMatter.status})`).join(", ")
            }\n\nComplete **#review** first.`,
          },
        },
      ],
    };
  }

  const cycleInstructions = deciding
    .map((cycle) => {
      const prompt = buildCycleDecidePrompt(cycle);
      const promptPath = `/tmp/cycle_${cycle.frontMatter.id}_decide_prompt.txt`;
      return (
        `### Cycle ${cycle.frontMatter.id} — ${cycle.definition?.objective ?? "(no definition)"}\n\n` +
        `**Step 1** — Use the \`create_file\` tool to write the following content to \`${promptPath}\`:\n\n` +
        "```\n" +
        prompt +
        "\n```\n\n" +
        `**Step 2** — Run in terminal:\n\n` +
        "```bash\n" +
        `claude --model claude-haiku-4-5 --dangerously-skip-permissions --print @${promptPath}\n` +
        "```"
      );
    })
    .join("\n\n---\n\n");

  const cycleIds = deciding.map((c) => c.frontMatter.id).join(", ");

  return {
    description: "DECIDE BATCH (claude) — delegate each cycle to claude CLI",
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `You are the Orchestrator. You have ${deciding.length} cycle(s) to dispatch for final approval using the \`claude\` CLI: **${cycleIds}**.

**Do NOT decide anything yourself.** Your sole job is to execute the steps below — one cycle at a time, sequentially — and report the output.

For each cycle:
1. Use the \`create_file\` tool to write the prompt to the specified temp file path
2. Run the \`claude\` command shown (it reads the prompt via \`@file\`)
3. Wait for it to complete
4. Report whether it succeeded or failed
5. Move to the next cycle

## Cycles to execute (run sequentially)

${cycleInstructions}

After all cycles complete, summarise which cycles were approved and which (if any) were rejected, then tell the user: "Decide complete. Use **#define** to start new cycles."`,
        },
      },
    ],
  };
}
