import { getActiveCycles } from "../cycles.js";
import { buildCycleImplementPrompt } from "./helpers.js";

/**
 * Builds a prompt that instructs the current agent to invoke the `copilot` CLI
 * once per IMPLEMENTING cycle, passing a self-contained implementation prompt
 * as the argument.
 *
 * Flags used:
 *   --allow-all                      equivalent to --allow-all-tools + --allow-all-paths + --allow-all-urls
 *   --additional-mcp-config          forward the project's MCP config so Copilot has the HAL tools
 */
export function buildImplementBatchCopilotPrompt(): {
  description: string;
  messages: Array<{ role: "user"; content: { type: "text"; text: string } }>;
} {
  const active = getActiveCycles();
  const implementing = active.filter((c) => c.frontMatter.status === "IMPLEMENTING");

  if (implementing.length === 0) {
    return {
      description: "IMPLEMENT BATCH (copilot) — no cycles ready",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `I'm sorry, Dave. No cycles are in IMPLEMENTING state.\n\nActive cycles: ${
                active.length === 0
                  ? "none"
                  : active.map((c) => `${c.frontMatter.id} (${c.frontMatter.status})`).join(", ")
              }\n\nComplete **#define** and lock the definition first.`,
          },
        },
      ],
    };
  }

  const commands = implementing
    .map((cycle) => {
      const prompt = buildCycleImplementPrompt(cycle).replace(/'/g, `'\\''`);
      return (
        `# Cycle ${cycle.frontMatter.id} — ${cycle.definition?.objective ?? "(no definition)"}\n` +
        `copilot --allow-all -p $'${prompt}'`
      );
    })
    .join("\n\n");

  const cycleIds = implementing.map((c) => c.frontMatter.id).join(", ");

  return {
    description: "IMPLEMENT BATCH (copilot) — delegate each cycle to copilot CLI",
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `You are the Orchestrator. You have ${implementing.length} cycle(s) to dispatch for implementation using the \`copilot\` CLI: **${cycleIds}**.

**Do NOT implement anything yourself.** Your sole job is to run the commands below — one per cycle, sequentially — and report the output.

For each command:
1. Run the \`copilot\` command exactly as shown
2. Wait for it to complete
3. Report whether it succeeded or failed
4. Move to the next cycle

## Commands to execute (run sequentially)

\`\`\`bash
${commands}
\`\`\`

After all commands complete, summarise which cycles succeeded and which (if any) failed, then tell the user: "Implementation complete. Use **#review** to review each cycle."`,
        },
      },
    ],
  };
}
