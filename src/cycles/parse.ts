import type {
  CycleData,
  CycleDefinition,
  CycleFrontMatter,
  CycleStatus,
  DecisionEntry,
  ImplementationEntry,
  ReviewEntry,
  Verdict,
} from "./types.js";
import { parseBullets } from "./utils.js";

export function parseFrontMatterOnly(content: string): CycleFrontMatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(": ");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 2).replace(/^"(.*)"$/, "$1");
    fm[key] = val;
  }
  if (!fm["id"] || !fm["slug"] || !fm["status"] || !fm["branch"]) return null;
  return {
    id: fm["id"],
    slug: fm["slug"],
    status: fm["status"] as CycleStatus,
    branch: fm["branch"],
    baseBranch: fm["baseBranch"] ?? "main",
    retryCount: parseInt(fm["retryCount"] ?? "0", 10),
    startedAt: fm["startedAt"] ?? new Date().toISOString(),
    dependsOn: fm["dependsOn"] ?? undefined,
  };
}

function parseSections(body: string): Record<string, string> {
  // Strip HTML comments
  const noComments = body.replace(/<!--[\s\S]*?-->/g, "");
  // Strip top-level title (# ...)
  const withoutTitle = noComments.replace(/^# [^\n]*\n+/, "");
  // Replace horizontal rules with newlines so they don't break section splits
  const withoutHR = withoutTitle.replace(/\n---\n/g, "\n\n");

  const sections: Record<string, string> = {};
  const parts = withoutHR.split(/\n(?=## )/);
  for (const part of parts) {
    const trimmed = part.trimStart();
    if (!trimmed.startsWith("## ")) continue;
    const withoutPrefix = trimmed.slice(3); // remove "## "
    const nl = withoutPrefix.indexOf("\n");
    if (nl === -1) continue;
    const heading = withoutPrefix.slice(0, nl).trim();
    const sectionBody = withoutPrefix.slice(nl + 1).trim();
    sections[heading] = sectionBody;
  }
  return sections;
}

function parseImplementationSection(text: string, number: number): ImplementationEntry {
  const submittedAt =
    text.match(/\*\*Submitted:\*\*\s*([^\n]+)/)?.[1]?.trim() ?? new Date().toISOString();
  const commitRaw = text.match(/\*\*Commit:\*\*\s*([^\n]+)/)?.[1]?.trim() ?? null;
  const comment = text.match(/\*\*Comment:\*\*\s*([^\n]+)/)?.[1]?.trim() ?? "";
  return {
    number,
    submittedAt,
    commit: commitRaw === "(none)" ? null : commitRaw,
    comment,
  };
}

function parseReviewSection(text: string, number: number): ReviewEntry {
  const verdict = (text.match(/\*\*Verdict:\*\*\s*(\w+)/)?.[1] ?? "BLOCKED") as Verdict;
  const reviewedAt =
    text.match(/\*\*Reviewed At:\*\*\s*([^\n]+)/)?.[1]?.trim() ?? new Date().toISOString();
  // Feedback is everything after the last "**Key:** value" line
  const lines = text.split("\n");
  let lastMetaIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\*\*[^*]+:\*\*/.test(lines[i])) lastMetaIdx = i;
  }
  const feedback = lines
    .slice(lastMetaIdx + 1)
    .join("\n")
    .trim();
  return { number, verdict, feedback, reviewedAt };
}

function parseDecisionSection(text: string): DecisionEntry {
  const approvedRaw = text.match(/\*\*Approved:\*\*\s*([^\n]+)/)?.[1]?.trim() ?? "";
  let approved: boolean | null;
  if (approvedRaw === "true" || /\[x\]\s*yes/i.test(approvedRaw)) {
    approved = true;
  } else if (approvedRaw === "false" || /\[x\]\s*no/i.test(approvedRaw)) {
    approved = false;
  } else {
    approved = null; // "[ ] yes  [ ] no" — not yet decided
  }
  const decidedAtRaw = text.match(/\*\*Decided At:\*\*\s*([^\n]*)/)?.[1]?.trim() ?? "";
  const feedback = text.match(/\*\*Feedback:\*\*\s*([^\n]+)/)?.[1]?.trim() ?? "";
  return { approved, decidedAt: decidedAtRaw, feedback };
}

export function parseCycleFile(content: string, filePath: string): CycleData | null {
  const frontMatter = parseFrontMatterOnly(content);
  if (!frontMatter) return null;

  const body = content.replace(/^---\n[\s\S]*?\n---\n*/, "");
  const sections = parseSections(body);

  const objectiveText = sections["Objective"]?.trim() ?? "";
  const hasDefinition = objectiveText !== "" && objectiveText !== "(fill in objective)";
  const definition: CycleDefinition | null = hasDefinition
    ? {
        objective: objectiveText,
        criteria: parseBullets(sections["Acceptance Criteria"] ?? ""),
        constraints: parseBullets(sections["Constraints"] ?? ""),
        scope: parseBullets(sections["Scope"] ?? ""),
        nonGoals: parseBullets(sections["Non-Goals"] ?? ""),
        invariants: parseBullets(sections["Invariants"] ?? ""),
        implementationNotes: parseBullets(sections["Implementation Notes"] ?? ""),
        forbiddenPaths: parseBullets(sections["Forbidden Paths"] ?? ""),
      }
    : null;

  const implementations: ImplementationEntry[] = [];
  let n = 1;
  while (`Implementation ${n}` in sections) {
    implementations.push(parseImplementationSection(sections[`Implementation ${n}`], n));
    n++;
  }

  const reviews: ReviewEntry[] = [];
  n = 1;
  while (`Review ${n}` in sections) {
    reviews.push(parseReviewSection(sections[`Review ${n}`], n));
    n++;
  }

  const decision = "Decision" in sections ? parseDecisionSection(sections["Decision"]) : null;

  return { frontMatter, definition, implementations, reviews, decision, filePath };
}
