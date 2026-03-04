import { readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync } from "fs";
import { join } from "path";
import { CYCLES_DIR } from "./constants.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CycleStatus = "DEFINING" | "IMPLEMENTING" | "REVIEWING" | "DECIDING" | "DECIDED";
export type Verdict = "APPROVED" | "BLOCKED";

export interface CycleDefinition {
  objective: string;
  criteria: string[];
  constraints: string[];
  scope: string[];
  nonGoals: string[];
  invariants: string[];
  implementationNotes: string[];
  forbiddenPaths: string[];
}

export interface ImplementationEntry {
  number: number;
  submittedAt: string;
  commit: string | null;
  comment: string;
}

export interface ReviewEntry {
  number: number;
  verdict: Verdict;
  feedback: string;
  reviewedAt: string;
}

export interface DecisionEntry {
  approved: boolean;
  feedback: string;
  decidedAt: string;
}

export interface CycleFrontMatter {
  id: string;       // "2026-03-04" or "2026-03-04-2"
  slug: string;     // "undefined" or "add-jwt-auth"
  status: CycleStatus;
  branch: string;   // "hal/2026-03-04_add-jwt-auth"
  baseCommit: string | null;
  retryCount: number;
  startedAt: string;
}

export interface CycleData {
  frontMatter: CycleFrontMatter;
  definition: CycleDefinition | null;
  implementations: ImplementationEntry[];
  reviews: ReviewEntry[];
  decision: DecisionEntry | null;
  filePath: string;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "a", "an", "the", "to", "for", "of", "in", "on", "at", "by", "with",
  "and", "or", "is", "are", "was", "were", "be", "been", "that", "this",
  "from", "into", "as", "it", "its", "so", "do", "not", "all", "up",
]);

/** Extract 3–5 meaningful words from text and join with hyphens. */
export function slugify(text: string, maxWords = 5): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .slice(0, maxWords);
  return words.join("-") || "undefined";
}

function bulletList(items: string[]): string {
  if (!items || items.length === 0) return "(none)";
  return items.map((item) => `- ${item}`).join("\n");
}

function parseBullets(text: string): string[] {
  if (!text || text.trim() === "(none)") return [];
  return text
    .split("\n")
    .filter((line) => line.trimStart().startsWith("- "))
    .map((line) => line.trimStart().slice(2).trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// File paths
// ---------------------------------------------------------------------------

/** File format: {id}_{slug}.md  — underscore separates date-id from slug */
export function getCycleFilePath(id: string, slug: string): string {
  return join(CYCLES_DIR, `${id}_${slug}.md`);
}

/** Returns YYYY-MM-DD, or YYYY-MM-DD-2, -3 … if that date already has cycles. */
export function getNextCycleId(): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  mkdirSync(CYCLES_DIR, { recursive: true });
  const files = readdirSync(CYCLES_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}/.test(f));
  const todayFiles = files.filter((f) => f.startsWith(`${today}_`) || f.startsWith(`${today}-`));
  if (todayFiles.length === 0) return today;
  // Find highest sequence suffix for today
  let maxSeq = 1;
  for (const f of todayFiles) {
    const m = f.match(new RegExp(`^${today}-(\\d+)_`));
    if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
  }
  return `${today}-${maxSeq + 1}`;
}

export function findCycleFile(id: string): string | null {
  mkdirSync(CYCLES_DIR, { recursive: true });
  const files = readdirSync(CYCLES_DIR).filter(
    (f) => f.startsWith(`${id}_`) && f.endsWith(".md"),
  );
  if (files.length === 0) return null;
  return join(CYCLES_DIR, files[0]);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseFrontMatter(content: string): CycleFrontMatter | null {
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
    baseCommit: fm["baseCommit"] === "null" || !fm["baseCommit"] ? null : fm["baseCommit"],
    retryCount: parseInt(fm["retryCount"] ?? "0", 10),
    startedAt: fm["startedAt"] ?? new Date().toISOString(),
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
  const submittedAt = text.match(/\*\*Submitted:\*\*\s*([^\n]+)/)?.[1]?.trim() ?? new Date().toISOString();
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
  const reviewedAt = text.match(/\*\*Reviewed At:\*\*\s*([^\n]+)/)?.[1]?.trim() ?? new Date().toISOString();
  // Feedback is everything after the last "**Key:** value" line and a blank line
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
  const approved = text.match(/\*\*Approved:\*\*\s*(\w+)/)?.[1]?.trim() === "true";
  const decidedAt = text.match(/\*\*Decided At:\*\*\s*([^\n]+)/)?.[1]?.trim() ?? new Date().toISOString();
  const feedback = text.match(/\*\*Feedback:\*\*\s*([^\n]+)/)?.[1]?.trim() ?? "";
  return { approved, decidedAt, feedback };
}

export function parseCycleFile(content: string, filePath: string): CycleData | null {
  const frontMatter = parseFrontMatter(content);
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

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatFrontMatter(fm: CycleFrontMatter): string {
  return `---
id: "${fm.id}"
slug: ${fm.slug}
status: ${fm.status}
branch: ${fm.branch}
baseCommit: ${fm.baseCommit ?? "null"}
retryCount: ${fm.retryCount}
startedAt: "${fm.startedAt}"
---`;
}

export function formatCycleFile(data: CycleData): string {
  const fm = data.frontMatter;
  const def = data.definition;
  const objText = def?.objective ?? "(fill in objective)";
  const title =
    def?.objective ? `Cycle ${fm.id} — ${def.objective}` : `Cycle ${fm.id}`;

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

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function createCycle(
  id: string,
  branch: string,
  baseCommit: string | null,
): CycleData {
  const frontMatter: CycleFrontMatter = {
    id,
    slug: "undefined",
    status: "DEFINING",
    branch,
    baseCommit,
    retryCount: 0,
    startedAt: new Date().toISOString(),
  };
  const data: CycleData = {
    frontMatter,
    definition: null,
    implementations: [],
    reviews: [],
    decision: null,
    filePath: getCycleFilePath(id, "undefined"),
  };
  mkdirSync(CYCLES_DIR, { recursive: true });
  writeFileSync(data.filePath, formatCycleFile(data), "utf-8");
  return data;
}

export function loadCycle(id: string): CycleData | null {
  const filePath = findCycleFile(id);
  if (!filePath) return null;
  try {
    const content = readFileSync(filePath, "utf-8");
    return parseCycleFile(content, filePath);
  } catch {
    return null;
  }
}

export function saveCycle(data: CycleData): void {
  writeFileSync(data.filePath, formatCycleFile(data), "utf-8");
}

export function renameCycleFile(data: CycleData, newSlug: string): CycleData {
  const newPath = getCycleFilePath(data.frontMatter.id, newSlug);
  if (data.filePath !== newPath) {
    renameSync(data.filePath, newPath);
  }
  data.frontMatter.slug = newSlug;
  data.frontMatter.branch = `hal/${data.frontMatter.id}_${newSlug}`;
  data.filePath = newPath;
  writeFileSync(data.filePath, formatCycleFile(data), "utf-8");
  return data;
}

export function listCycles(): CycleData[] {
  mkdirSync(CYCLES_DIR, { recursive: true });
  return readdirSync(CYCLES_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}.*_.*\.md$/.test(f))
    .sort()
    .map((f) => {
      try {
        const fp = join(CYCLES_DIR, f);
        return parseCycleFile(readFileSync(fp, "utf-8"), fp);
      } catch {
        return null;
      }
    })
    .filter((c): c is CycleData => c !== null);
}

export function getActiveCycles(): CycleData[] {
  return listCycles().filter((c) => c.frontMatter.status !== "DECIDED");
}

// ---------------------------------------------------------------------------
// Cycle resolution (for tools)
// ---------------------------------------------------------------------------

export type ResolveResult =
  | { cycle: CycleData; warning?: string }
  | { error: string };

export function resolveCycle(
  cycleId: string | null | undefined,
  targetStatus?: CycleStatus,
): ResolveResult {
  if (cycleId) {
    const cycle = loadCycle(cycleId);
    if (!cycle) return { error: `Cycle ${cycleId} not found.` };
    if (targetStatus && cycle.frontMatter.status !== targetStatus) {
      return {
        error: `Cycle ${cycleId} is in ${cycle.frontMatter.status}, not ${targetStatus}.`,
      };
    }
    return { cycle };
  }

  const active = getActiveCycles();
  if (active.length === 0) {
    const statusMsg = targetStatus ? ` in ${targetStatus} state` : "";
    return { error: `No active cycle${statusMsg} found. Start one with start_cycle().` };
  }

  if (targetStatus) {
    const matching = active.filter((c) => c.frontMatter.status === targetStatus);
    if (matching.length === 0) {
      return {
        error: `No cycle in ${targetStatus} state. Active cycles: ${active.map((c) => `${c.frontMatter.id} (${c.frontMatter.status})`).join(", ")}`,
      };
    }
    if (matching.length === 1) return { cycle: matching[0] };
    return {
      cycle: matching[0],
      warning: `Multiple cycles in ${targetStatus}. Using ${matching[0].frontMatter.id}. Pass cycleId to target a specific one.`,
    };
  }

  if (active.length === 1) return { cycle: active[0] };
  return {
    cycle: active[0],
    warning: `Multiple active cycles. Using ${active[0].frontMatter.id}. Pass cycleId to target a specific one.`,
  };
}
