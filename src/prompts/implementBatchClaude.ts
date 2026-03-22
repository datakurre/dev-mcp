import { getActiveCycles } from "../cycles.js";
import { buildCycleImplementPrompt } from "./helpers.js";

/**
 * Builds a prompt that instructs the current agent to invoke the `claude` CLI
 * once per IMPLEMENTING cycle, passing a self-contained implementation prompt
 * as the argument.
 *
 * Flags used:
 *   --dangerously-skip-permissions   bypass all permission prompts (equivalent to "allow all tools + paths")
 *   --print                          non-interactive, exit when done
 *   --mcp-config                     forward the project's MCP config so Claude has the HAL tools
 */
export function buildImplementBatchClaudePrompt(): {
  description: string;
  messages: Array<{ role: "user"; content: { type: "text"; text: string } }>;
} {
  const active = getActiveCycles();
  const implementing = active.filter((c) => c.frontMatter.status === "IMPLEMENTING");

  if (implementing.length === 0) {
    return {
      description: "IMPLEMENT BATCH (claude) — no cycles ready",
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
        `claude --dangerously-skip-permissions --print $'${prompt}'`
      );
    })
    .join("\n\n");

  const cycleIds = implementing.map((c) => c.frontMatter.id).join(", ");

  return {
    description: "IMPLEMENT BATCH (claude) — delegate each cycle to claude CLI",
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `You are the Orchestrator. You have ${implementing.length} cycle(s) to dispatch for implementation using the \`claude\` CLI: **${cycleIds}**.

**Do NOT implement anything yourself.** Your sole job is to run the commands below — one per cycle, sequentially — and report the output.

For each command:
1. Run the \`claude\` command exactly as shown
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
