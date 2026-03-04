import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadState, saveState, type Cycle, type Review, type CompletedCycle, type Definition } from "./state.js";
import { getHeadCommit, getGitDiff, computeRollback } from "./git.js";
import { MAX_RETRIES, DEFINITION_DRAFT_FILE } from "./constants.js";
import { saveDefinitionMarkdown, loadDefinitionMarkdown } from "./markdown.js";

type ToolResult = { content: [{ type: "text"; text: string }]; isError?: true };

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function err(text: string): ToolResult {
  return { content: [{ type: "text", text: `I'm sorry, Dave. ${text}` }], isError: true };
}

export function registerTools(server: Server): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "start_cycle",
        description: "Initialize a new work cycle. Transitions IDLE → DEFINING.",
        inputSchema: {
          type: "object",
          properties: {
            intent: { type: "string", description: "High-level description of what this cycle will achieve" },
          },
          required: ["intent"],
        },
      },
      {
        name: "set_definition",
        description: "Lock the Definition Artifact. Transitions DEFINING → IMPLEMENTING.",
        inputSchema: {
          type: "object",
          properties: {
            objective: { type: "string", description: "One-sentence statement of what will be different when complete" },
            criteria: { type: "array", items: { type: "string" }, description: "Specific, verifiable acceptance criteria" },
            constraints: { type: "array", items: { type: "string" }, description: "Hard limits the implementation must respect" },
            scope: { type: "array", items: { type: "string" }, description: "Exact file paths the Implementer may touch" },
            nonGoals: { type: "array", items: { type: "string" }, description: "Explicitly out-of-scope items" },
            invariants: { type: "array", items: { type: "string" }, description: "Conditions that must remain true before and after" },
            implementationNotes: { type: "array", items: { type: "string" }, description: "Ordering or environment constraints only — no design guidance" },
            forbiddenPaths: { type: "array", items: { type: "string" }, description: "File paths the implementation must not touch (Phase A mechanical check)" },
          },
          required: ["objective", "criteria", "constraints", "scope"],
        },
      },
      {
        name: "submit_implementation",
        description:
          "Called by the Implementer when changes are committed. Snapshots the git diff. Transitions IMPLEMENTING → REVIEWING.",
        inputSchema: {
          type: "object",
          properties: {
            comment: { type: "string", description: "Brief summary of what was implemented" },
          },
          required: ["comment"],
        },
      },
      {
        name: "submit_review",
        description:
          "Called by the Reviewer. APPROVED → DECIDING. BLOCKED → IMPLEMENTING (or DECIDING if retry limit reached).",
        inputSchema: {
          type: "object",
          properties: {
            verdict: { type: "string", enum: ["APPROVED", "BLOCKED"] },
            feedback: { type: "string", description: "Specific reasoning for the verdict" },
          },
          required: ["verdict", "feedback"],
        },
      },
      {
        name: "decide",
        description:
          "Called by the Human for final sign-off. approved=true → IDLE. approved=false → DEFINING.",
        inputSchema: {
          type: "object",
          properties: {
            approved: { type: "boolean" },
            feedback: { type: "string", description: "Notes on approval or reasons for rejection" },
          },
          required: ["approved", "feedback"],
        },
      },
      {
        name: "save_definition_draft",
        description:
          "Save a Definition Artifact draft as a markdown file for human review. Does NOT advance state — remains in DEFINING. Call this after collecting all definition fields through Q&A. The human can then edit the file before calling lock_definition().",
        inputSchema: {
          type: "object",
          properties: {
            objective: { type: "string", description: "One-sentence statement of what will be different when complete" },
            criteria: { type: "array", items: { type: "string" }, description: "Specific, verifiable acceptance criteria" },
            constraints: { type: "array", items: { type: "string" }, description: "Hard limits the implementation must respect" },
            scope: { type: "array", items: { type: "string" }, description: "Exact file paths the Implementer may touch" },
            nonGoals: { type: "array", items: { type: "string" }, description: "Explicitly out-of-scope items" },
            invariants: { type: "array", items: { type: "string" }, description: "Conditions that must remain true before and after" },
            implementationNotes: { type: "array", items: { type: "string" }, description: "Ordering or environment constraints only" },
            forbiddenPaths: { type: "array", items: { type: "string" }, description: "File paths the implementation must not touch" },
          },
          required: ["objective", "criteria", "constraints", "scope"],
        },
      },
      {
        name: "lock_definition",
        description:
          "Lock the Definition Artifact by reading the saved draft from .agents/hal/definition.md. Transitions DEFINING → IMPLEMENTING. Call this after the human has reviewed and approved the draft saved by save_definition_draft().",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = args as Record<string, unknown>;

    if (name === "start_cycle") return startCycle(String(a.intent));
    if (name === "set_definition")
      return setDefinition(
        String(a.objective ?? ""),
        a.criteria as string[],
        a.constraints as string[],
        a.scope as string[],
        (a.nonGoals as string[] | undefined) ?? [],
        (a.invariants as string[] | undefined) ?? [],
        (a.implementationNotes as string[] | undefined) ?? [],
        (a.forbiddenPaths as string[] | undefined) ?? [],
      );
    if (name === "save_definition_draft")
      return saveDefinitionDraft(
        String(a.objective ?? ""),
        (a.criteria as string[] | undefined) ?? [],
        (a.constraints as string[] | undefined) ?? [],
        (a.scope as string[] | undefined) ?? [],
        (a.nonGoals as string[] | undefined) ?? [],
        (a.invariants as string[] | undefined) ?? [],
        (a.implementationNotes as string[] | undefined) ?? [],
        (a.forbiddenPaths as string[] | undefined) ?? [],
      );
    if (name === "lock_definition") return lockDefinition();
    if (name === "submit_implementation") return submitImplementation(String(a.comment));
    if (name === "submit_review")
      return submitReview(String(a.verdict) as "APPROVED" | "BLOCKED", String(a.feedback));
    if (name === "decide") return decide(Boolean(a.approved), String(a.feedback));

    return err(`Unknown tool: ${name}`);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeReviewArtifact(cycle: Cycle, review: Review): string {
  const dir = join(process.cwd(), "ce-reviews");
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "-").slice(0, 19);
  const filename = `review-${ts}-retry${cycle.retryCount}.json`;
  const artifactPath = join(dir, filename);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      artifactPath,
      JSON.stringify(
        {
          intent: cycle.intent,
          definition: cycle.definition,
          implementationComment: cycle.implementationComment,
          baseCommit: cycle.baseCommit,
          headCommitAtSubmission: cycle.headCommitAtSubmission,
          retryCount: cycle.retryCount,
          review,
          rollbackPlan: computeRollback(cycle),
          writtenAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    return artifactPath;
  } catch (e) {
    return `(artifact write failed: ${e instanceof Error ? e.message : String(e)})`;
  }
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

function startCycle(intent: string): ToolResult {
  const state = loadState();
  if (state.status !== "IDLE") {
    return err(`Cannot start a cycle in state "${state.status}". A cycle is already active.`);
  }
  const baseCommit = getHeadCommit();
  state.status = "DEFINING";
  state.currentCycle = {
    intent,
    baseCommit,
    definition: null,
    implementationComment: null,
    diff: null,
    headCommitAtSubmission: null,
    review: null,
    retryCount: 0,
    startedAt: new Date().toISOString(),
  };
  saveState(state);
  return ok(
    `Cycle started. Status: DEFINING\n` +
      `Intent: ${intent}\n` +
      `Baseline commit: ${baseCommit ?? "(none — not in a git repo)"}\n\n` +
      `Next: use **/mcp.hal.define** to produce the Definition Artifact.`,
  );
}

function setDefinition(
  objective: string,
  criteria: string[],
  constraints: string[],
  scope: string[],
  nonGoals: string[],
  invariants: string[],
  implementationNotes: string[],
  forbiddenPaths: string[],
): ToolResult {
  const state = loadState();
  if (state.status !== "DEFINING") {
    return err(`Cannot set definition in state "${state.status}". Must be in DEFINING.`);
  }
  state.currentCycle!.definition = {
    objective,
    criteria,
    constraints,
    scope,
    nonGoals,
    invariants,
    implementationNotes,
    forbiddenPaths,
  };
  state.status = "IMPLEMENTING";
  saveState(state);
  return ok(
    `Definition locked. Status: IMPLEMENTING\n\n` +
      `Objective:   ${objective}\n` +
      `Criteria:    ${criteria.length} item(s)\n` +
      `Constraints: ${constraints.length} item(s)\n` +
      `Scope:       ${scope.length} file(s)\n` +
      `Non-goals:   ${nonGoals.length} item(s)\n` +
      `Invariants:  ${invariants.length} item(s)\n` +
      `Forbidden:   ${forbiddenPaths.length} path(s)\n\n` +
      `Next: use **/mcp.hal.implement** to execute the definition, then call submit_implementation().`,
  );
}

function submitImplementation(comment: string): ToolResult {
  const state = loadState();
  if (state.status !== "IMPLEMENTING") {
    return err(`Cannot submit implementation in state "${state.status}". Must be in IMPLEMENTING.`);
  }
  const diff = getGitDiff(state.currentCycle!.baseCommit);
  const head = getHeadCommit();
  state.currentCycle!.implementationComment = comment;
  state.currentCycle!.diff = diff;
  state.currentCycle!.headCommitAtSubmission = head;
  state.status = "REVIEWING";
  saveState(state);
  return ok(
    `Implementation submitted. Status: REVIEWING\n` +
      `Comment: ${comment}\n` +
      `Diff: ${diff.split("\n").length} line(s) captured ` +
      `(${state.currentCycle!.baseCommit ?? "none"} → ${head ?? "unknown"})\n\n` +
      `Next: use **/mcp.hal.review** with an independent reviewer, then call submit_review().`,
  );
}

function submitReview(verdict: "APPROVED" | "BLOCKED", feedback: string): ToolResult {
  const state = loadState();
  if (state.status !== "REVIEWING") {
    return err(`Cannot submit review in state "${state.status}". Must be in REVIEWING.`);
  }
  state.currentCycle!.review = { verdict, feedback, reviewedAt: new Date().toISOString() };
  const artifactPath = writeReviewArtifact(state.currentCycle!, state.currentCycle!.review);

  if (verdict === "APPROVED") {
    state.status = "DECIDING";
    saveState(state);
    return ok(
      `Review: APPROVED. Status: DECIDING\n\nFeedback: ${feedback}\n\n` +
        `Review artifact written to: ${artifactPath}\n` +
        `Commit this file to the project repository, then call decide().`,
    );
  }

  state.currentCycle!.retryCount += 1;
  if (state.currentCycle!.retryCount >= MAX_RETRIES) {
    state.status = "DECIDING";
    saveState(state);
    return ok(
      `Review: BLOCKED — retry limit reached (${MAX_RETRIES}/${MAX_RETRIES}). Status: DECIDING\n\n` +
        `Feedback: ${feedback}\n\n` +
        `Review artifact written to: ${artifactPath}\n` +
        `Escalating to Human. Call decide() to determine next steps.`,
    );
  }

  state.status = "IMPLEMENTING";
  saveState(state);
  return ok(
    `Review: BLOCKED. Status: IMPLEMENTING (retry ${state.currentCycle!.retryCount}/${MAX_RETRIES})\n\n` +
      `Feedback: ${feedback}\n\n` +
      `Review artifact written to: ${artifactPath}\n` +
      `Next: Implementer must address the feedback. Use **/mcp.hal.implement** and call submit_implementation() again.`,
  );
}

function saveDefinitionDraft(
  objective: string,
  criteria: string[],
  constraints: string[],
  scope: string[],
  nonGoals: string[],
  invariants: string[],
  implementationNotes: string[],
  forbiddenPaths: string[],
): ToolResult {
  const state = loadState();
  if (state.status !== "DEFINING") {
    return err(`Cannot save definition draft in state "${state.status}". Must be in DEFINING.`);
  }
  const definition: Definition = {
    objective,
    criteria,
    constraints,
    scope,
    nonGoals,
    invariants,
    implementationNotes,
    forbiddenPaths,
  };
  const intent = state.currentCycle!.intent;
  saveDefinitionMarkdown(intent, definition);
  return ok(
    `Definition draft saved to ${DEFINITION_DRAFT_FILE}\n\n` +
      `Please open and review the file. Edit any section freely — bullet points are parsed as list items.\n\n` +
      `When you are happy with it, say **"lock"** and I will lock the definition and move to IMPLEMENTING.`,
  );
}

function lockDefinition(): ToolResult {
  const state = loadState();
  if (state.status !== "DEFINING") {
    return err(`Cannot lock definition in state "${state.status}". Must be in DEFINING.`);
  }
  const loaded = loadDefinitionMarkdown();
  if (!loaded) {
    return err(
      `No definition draft found at ${DEFINITION_DRAFT_FILE}.\n` +
        `Complete the Q&A in #define first so a draft can be saved, then say "lock".`,
    );
  }
  const { definition } = loaded;
  if (!definition.objective) {
    return err(`Draft at ${DEFINITION_DRAFT_FILE} is missing a Change Objective. Please edit the file and try again.`);
  }
  state.currentCycle!.definition = definition;
  state.status = "IMPLEMENTING";
  saveState(state);
  return ok(
    `Definition locked from ${DEFINITION_DRAFT_FILE}. Status: IMPLEMENTING\n\n` +
      `Objective:   ${definition.objective}\n` +
      `Criteria:    ${definition.criteria.length} item(s)\n` +
      `Constraints: ${definition.constraints.length} item(s)\n` +
      `Scope:       ${definition.scope.length} file(s)\n` +
      `Non-goals:   ${definition.nonGoals.length} item(s)\n` +
      `Invariants:  ${definition.invariants.length} item(s)\n` +
      `Forbidden:   ${definition.forbiddenPaths.length} path(s)\n\n` +
      `Next: use **/mcp.hal.implement** to start the implementation.`,
  );
}

function decide(approved: boolean, feedback: string): ToolResult {
  const state = loadState();
  if (state.status !== "DECIDING") {
    return err(`Cannot decide in state "${state.status}". Must be in DECIDING.`);
  }

  if (approved) {
    const completed: CompletedCycle = {
      ...state.currentCycle!,
      approved: true,
      humanFeedback: feedback,
      decidedAt: new Date().toISOString(),
    };
    state.history.push(completed);
    state.status = "IDLE";
    state.currentCycle = null;
    saveState(state);
    return ok(
      `Cycle APPROVED. Status: IDLE\n\nFeedback: ${feedback}\n\n` +
        `Cycle recorded in history (${state.history.length} total). Ready for next DEFINE.`,
    );
  }

  // Rejected — clear implementation artifacts, return to DEFINING
  const cycle = state.currentCycle!;
  cycle.definition = null;
  cycle.implementationComment = null;
  cycle.diff = null;
  cycle.headCommitAtSubmission = null;
  cycle.review = null;
  cycle.retryCount = 0;
  state.status = "DEFINING";
  saveState(state);
  return ok(
    `Cycle REJECTED. Status: DEFINING\n\nFeedback: ${feedback}\n\n` +
      `Definition cleared. Use /mcp.hal.define to revise and re-lock.`,
  );
}
