import { getActiveCycles } from "../cycles.js";

export function buildDecidePrompt(cycleId?: string): {
  description: string;
  messages: Array<{ role: "user"; content: { type: "text"; text: string } }>;
} {
  const active = getActiveCycles();
  const allDeciding = active.filter((c) => c.frontMatter.status === "DECIDING");

  // If a specific cycleId is given, narrow to just that one
  const deciding = cycleId ? allDeciding.filter((c) => c.frontMatter.id === cycleId) : allDeciding;

  if (deciding.length === 0) {
    const hint = cycleId
      ? `Cycle ${cycleId} is not in DECIDING state.`
      : `No cycles are in DECIDING state.`;
    return {
      description: "DECIDE stage — no cycles ready",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `I'm sorry, Dave. ${hint}\n\nActive cycles: ${
              active.length === 0
                ? "none"
                : active.map((c) => `${c.frontMatter.id} (${c.frontMatter.status})`).join(", ")
            }\n\nComplete **#review** first.`,
          },
        },
      ],
    };
  }

  const toApprove = deciding.filter((c) => c.decision?.approved === true);
  const toReject = deciding.filter((c) => c.decision?.approved === false);
  const undecided = deciding.filter((c) => !c.decision || c.decision.approved === null);

  let text =
    `You are processing final DECIDE decisions for HAL.\n\n` +
    `Always address the human as "Dave" in explicit addresses. When reporting an error, begin with: "I'm sorry, Dave."\n\n`;

  if (toApprove.length > 0) {
    text += `## Auto-approve (checked [x] yes)\n\n`;
    for (const c of toApprove) {
      text +=
        `- **${c.frontMatter.id}** — ${c.definition?.objective ?? "(no definition)"}\n` +
        `  → call \`decide(cycleId: "${c.frontMatter.id}", approved: true, feedback: "Approved.")\` via the HAL MCP tool\n`;
    }
    text += `\n`;
  }

  if (toReject.length > 0) {
    text += `## Auto-reject (checked [x] no)\n\n`;
    for (const c of toReject) {
      text +=
        `- **${c.frontMatter.id}** — ${c.definition?.objective ?? "(no definition)"}\n` +
        `  → call \`decide(cycleId: "${c.frontMatter.id}", approved: false, feedback: "${c.decision?.feedback ?? "Rejected by human."}")\` via the HAL MCP tool\n`;
    }
    text += `\n`;
  }

  if (undecided.length > 0) {
    text += `## Awaiting human decision (unchecked)\n\n`;
    text += `These cycles have not been decided yet. Ask Dave to open each file and fill in \`[x] yes\` or \`[x] no\` in the **Approved** line of the Decision section, then call **#decide** again:\n\n`;
    for (const c of undecided) {
      text += `- **${c.frontMatter.id}** — ${c.definition?.objective ?? "(no definition)"}\n`;
      text += `  File: \`${c.filePath}\`\n`;
    }
    text += `\n`;
  }

  text += `## Your Job\n\n`;
  if (toApprove.length > 0 || toReject.length > 0) {
    text +=
      `1. Process all auto-approve and auto-reject cycles above by calling \`decide()\` via the HAL MCP tool — one at a time\n` +
      `2. After each call, report the result to Dave\n`;
    if (undecided.length > 0) {
      text += `3. Then show Dave the undecided file paths and ask them to fill in the checkboxes, then call **#decide** again\n`;
    }
  } else {
    text +=
      `1. Show Dave the file path(s) above\n` +
      `2. Ask Dave to open each file and fill in \`[x] yes\` or \`[x] no\` in the **Approved** line of the Decision section\n` +
      `3. Once filled, call **#decide** again to process the decisions\n`;
  }

  return {
    description: `DECIDE stage — ${deciding.length} cycle(s) in DECIDING`,
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text },
      },
    ],
  };
}
