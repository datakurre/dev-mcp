import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { DEFINITION_DRAFT_FILE } from "./constants.js";
import type { Definition } from "./state.js";

function bulletList(items: string[]): string {
  if (items.length === 0) return "(none)";
  return items.map((item) => `- ${item}`).join("\n");
}

export function saveDefinitionMarkdown(intent: string, definition: Definition): void {
  const content = `---
intent: ${JSON.stringify(intent)}
status: DRAFT
---

# HAL Definition Artifact

<!--
  Review and edit this file freely before locking.
  Bullet points (- item) are parsed as list items.
  The "Change Objective" section should be a single sentence.
  When ready, tell the agent "lock" to lock this definition.
-->

## Change Objective

${definition.objective}

## Acceptance Criteria

${bulletList(definition.criteria)}

## Constraints

${bulletList(definition.constraints)}

## Scope (Claimed Files)

${bulletList(definition.scope)}

## Non-Goals

${bulletList(definition.nonGoals)}

## Invariants

${bulletList(definition.invariants)}

## Implementation Notes

${bulletList(definition.implementationNotes)}

## Forbidden Paths

${bulletList(definition.forbiddenPaths)}
`;
  mkdirSync(dirname(DEFINITION_DRAFT_FILE), { recursive: true });
  writeFileSync(DEFINITION_DRAFT_FILE, content, "utf-8");
}

export function loadDefinitionMarkdown(): { intent: string; definition: Definition } | null {
  if (!existsSync(DEFINITION_DRAFT_FILE)) return null;
  try {
    const content = readFileSync(DEFINITION_DRAFT_FILE, "utf-8");
    return parseDefinitionMarkdown(content);
  } catch {
    return null;
  }
}

export function getDefinitionDraftPath(): string {
  return DEFINITION_DRAFT_FILE;
}

function parseDefinitionMarkdown(content: string): { intent: string; definition: Definition } | null {
  // Parse YAML front matter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  let intent = "";
  if (fmMatch) {
    const intentMatch = fmMatch[1].match(/^intent:\s*"(.*)"/m);
    if (intentMatch) intent = intentMatch[1];
  }

  const sections = parseSections(content);

  const objective = (sections["Change Objective"] ?? "").trim();
  if (!objective) return null;

  const definition: Definition = {
    objective,
    criteria: parseBullets(sections["Acceptance Criteria"] ?? ""),
    constraints: parseBullets(sections["Constraints"] ?? ""),
    scope: parseBullets(sections["Scope (Claimed Files)"] ?? ""),
    nonGoals: parseBullets(sections["Non-Goals"] ?? ""),
    invariants: parseBullets(sections["Invariants"] ?? ""),
    implementationNotes: parseBullets(sections["Implementation Notes"] ?? ""),
    forbiddenPaths: parseBullets(sections["Forbidden Paths"] ?? ""),
  };

  return { intent, definition };
}

function parseSections(content: string): Record<string, string> {
  // Strip front matter
  const body = content.replace(/^---\n[\s\S]*?\n---\n*/, "");
  // Strip HTML comments
  const noComments = body.replace(/<!--[\s\S]*?-->/g, "");
  // Strip top-level title (# ...)
  const withoutTitle = noComments.replace(/^# [^\n]*\n+/, "");

  const sections: Record<string, string> = {};
  // Split on ## headings (each part starts with "## ")
  const parts = withoutTitle.split(/\n(?=## )/);
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

function parseBullets(text: string): string[] {
  if (!text || text.trim() === "(none)") return [];
  return text
    .split("\n")
    .filter((line) => line.trimStart().startsWith("- "))
    .map((line) => line.trimStart().slice(2).trim())
    .filter(Boolean);
}
