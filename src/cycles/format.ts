import type { CycleData, CycleFrontMatter } from "./types.js";
import { bulletList } from "./utils.js";

export function formatFrontMatter(fm: CycleFrontMatter): string {
  return `---
id: "${fm.id}"
slug: ${fm.slug}
status: ${fm.status}
branch: ${fm.branch}
baseBranch: ${fm.baseBranch}
baseCommit: ${fm.baseCommit ?? "null"}
retryCount: ${fm.retryCount}
startedAt: "${fm.startedAt}"${fm.dependsOn ? `\ndependsOn: ${fm.dependsOn}` : ""}
---`;
}

export function formatCycleFile(data: CycleData): string {
  const fm = data.frontMatter;
  const def = data.definition;
  const objText = def?.objective ?? "(fill in objective)";
  const title = def?.objective ? `Cycle ${fm.id} — ${def.objective}` : `Cycle ${fm.id}`;

  let content = `${formatFrontMatter(fm)}

# ${title}

<!-- Edit the definition sections freely before locking. When ready, say "lock". -->

## Objective

${objText}

## Acceptance Criteria

${bulletList(def?.criteria ?? [])}

## Constraints

${bulletList(def?.constraints ?? [])}

## Scope

${bulletList(def?.scope ?? [])}

## Non-Goals

${bulletList(def?.nonGoals ?? [])}

## Invariants

${bulletList(def?.invariants ?? [])}

## Implementation Notes

${bulletList(def?.implementationNotes ?? [])}

## Forbidden Paths

${bulletList(def?.forbiddenPaths ?? [])}`;

  for (const impl of data.implementations) {
    content += `\n\n---\n\n## Implementation ${impl.number}\n\n`;
    content += `**Submitted:** ${impl.submittedAt}\n`;
    content += `**Commit:** ${impl.commit ?? "(none)"}\n`;
    content += `**Comment:** ${impl.comment}\n`;
  }

  for (const review of data.reviews) {
    content += `\n\n---\n\n## Review ${review.number}\n\n`;
    content += `**Verdict:** ${review.verdict}\n`;
    content += `**Reviewed At:** ${review.reviewedAt}\n\n`;
    content += `${review.feedback}\n`;
  }

  if (data.decision) {
    content += `\n\n---\n\n## Decision\n\n`;
    content += `**Approved:** ${data.decision.approved}\n`;
    content += `**Decided At:** ${data.decision.decidedAt}\n`;
    content += `**Feedback:** ${data.decision.feedback}\n`;
  }

  return content;
}
