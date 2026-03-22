import { resolveCycle } from "../cycles.js";
import { MAX_RETRIES } from "../constants.js";

export function buildDecidePrompt(): {
  description: string;
  messages: Array<{ role: "user"; content: { type: "text"; text: string } }>;
} {
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
