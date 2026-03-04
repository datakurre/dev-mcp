import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  slugify,
  getNextCycleId,
  createCycle,
  saveCycle,
  renameCycleFile,
  resolveCycle,
  listCycles,
} from "./cycles.js";
import { getHeadCommit, createBranch, renameBranch, getCurrentBranch, mergeBranchToMain } from "./git.js";
import { MAX_RETRIES } from "./constants.js";

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
        description:
          "Initialize a new work cycle. Creates a numbered cycle file and a git branch. Transitions → DEFINING.",
        inputSchema: {
          type: "object",
          properties: {
            intent: {
              type: "string",
              description: "High-level description of what this cycle will achieve",
            },
          },
          required: ["intent"],
        },
      },
      {
        name: "save_definition_draft",
        description:
          "Write the generated definition into the cycle markdown file for human review. Does NOT advance state. Call after generating the definition from the objective. The human then edits the file and says 'lock'.",
        inputSchema: {
          type: "object",
          properties: {
            cycleId: {
              type: "string",
              description: "Cycle ID (e.g. '0001'). Optional if only one active cycle.",
            },
            objective: {
              type: "string",
              description: "One-sentence statement of what will be different when complete",
            },
            criteria: {
              type: "array",
              items: { type: "string" },
              description: "Specific, verifiable acceptance criteria",
            },
            constraints: {
              type: "array",
              items: { type: "string" },
              description: "Hard limits the implementation must respect",
            },
            scope: {
              type: "array",
              items: { type: "string" },
              description: "Exact file paths the Implementer may touch",
            },
            nonGoals: {
              type: "array",
              items: { type: "string" },
              description: "Explicitly out-of-scope items",
            },
            invariants: {
              type: "array",
              items: { type: "string" },
              description: "Conditions that must remain true before and after",
            },
            implementationNotes: {
              type: "array",
              items: { type: "string" },
              description: "Ordering or environment constraints only — no design guidance",
            },
            forbiddenPaths: {
              type: "array",
              items: { type: "string" },
              description: "File paths the implementation must not touch",
            },
          },
          required: ["objective", "criteria", "constraints", "scope"],
        },
      },
      {
        name: "lock_definition",
        description:
          "Lock the definition from the cycle markdown file. Validates all required fields, renames the cycle file and git branch using the shortname, and transitions DEFINING → IMPLEMENTING.",
        inputSchema: {
          type: "object",
          properties: {
            cycleId: {
              type: "string",
              description: "Cycle ID (e.g. '2026-03-04'). Optional if only one active cycle.",
            },
            shortname: {
              type: "string",
              description:
                "3–5 word kebab-case summary of the objective used as the file/branch name (e.g. 'add-jwt-auth', 'fix-login-redirect'). Generate this from the objective before calling.",
            },
          },
          required: [],
        },
      },
      {
        name: "submit_implementation",
        description:
          "Record that implementation is complete. Appends an Implementation section to the cycle file and transitions IMPLEMENTING → REVIEWING.",
        inputSchema: {
          type: "object",
          properties: {
            cycleId: {
              type: "string",
              description: "Cycle ID (e.g. '0001'). Optional if only one active cycle.",
            },
            comment: {
              type: "string",
              description: "Brief summary of what was implemented",
            },
          },
          required: ["comment"],
        },
      },
      {
        name: "submit_review",
        description:
          "Record the review verdict. Appends a Review section to the cycle file. APPROVED → DECIDING. BLOCKED → IMPLEMENTING (or DECIDING if retry limit reached).",
        inputSchema: {
          type: "object",
          properties: {
            cycleId: {
              type: "string",
              description: "Cycle ID (e.g. '0001'). Optional if only one active cycle.",
            },
            verdict: { type: "string", enum: ["APPROVED", "BLOCKED"] },
            feedback: { type: "string", description: "Specific reasoning for the verdict" },
          },
          required: ["verdict", "feedback"],
        },
      },
      {
        name: "decide",
        description:
          "Human final sign-off. Appends a Decision section to the cycle file. approved=true → DECIDED (cycle complete). approved=false → DEFINING (reopen for revision).",
        inputSchema: {
          type: "object",
          properties: {
            cycleId: {
              type: "string",
              description: "Cycle ID (e.g. '0001'). Optional if only one active cycle.",
            },
            approved: { type: "boolean" },
            feedback: {
              type: "string",
              description: "Notes on approval or reasons for rejection",
            },
          },
          required: ["approved", "feedback"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = args as Record<string, unknown>;
    const cycleId = a.cycleId ? String(a.cycleId) : undefined;

    if (name === "start_cycle") return startCycle(String(a.intent));
    if (name === "save_definition_draft")
      return saveDefinitionDraft(
        cycleId,
        String(a.objective ?? ""),
        (a.criteria as string[] | undefined) ?? [],
        (a.constraints as string[] | undefined) ?? [],
        (a.scope as string[] | undefined) ?? [],
        (a.nonGoals as string[] | undefined) ?? [],
        (a.invariants as string[] | undefined) ?? [],
        (a.implementationNotes as string[] | undefined) ?? [],
        (a.forbiddenPaths as string[] | undefined) ?? [],
      );
    if (name === "lock_definition")
      return lockDefinition(cycleId, a.shortname ? String(a.shortname) : undefined);
    if (name === "submit_implementation")
      return submitImplementation(cycleId, String(a.comment));
    if (name === "submit_review")
      return submitReview(
        cycleId,
        String(a.verdict) as "APPROVED" | "BLOCKED",
        String(a.feedback),
      );
    if (name === "decide") return decide(cycleId, Boolean(a.approved), String(a.feedback));

    return err(`Unknown tool: ${name}`);
  });
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

function startCycle(intent: string): ToolResult {
  const currentBranch = getCurrentBranch();
  const mainBranch = currentBranch === "master" ? "master" : "main";
  if (currentBranch && currentBranch !== mainBranch) {
    return err(
      `You are on branch "${currentBranch}", not "${mainBranch}".\n` +
        `Switch to ${mainBranch} before starting a new cycle to keep cycle IDs consistent.\n` +
        `Run: git checkout ${mainBranch}`,
    );
  }
  const id = getNextCycleId();
  const branchName = `hal/${id}_undefined`;
  const baseCommit = getHeadCommit();
  createCycle(id, branchName, baseCommit);
  const branchErr = createBranch(branchName);
  const branchNote = branchErr
    ? `\n⚠️  Branch creation failed (${branchErr.split("\n")[0]}). Continuing without a dedicated branch.`
    : `\nBranch: ${branchName}`;
  return ok(
    `Cycle ${id} started. Status: DEFINING\n` +
      `Intent: ${intent}\n` +
      `Baseline commit: ${baseCommit ?? "(none — not in a git repo)"}` +
      branchNote +
      `\n\nNext: use **#define** to produce the Definition Artifact.`,
  );
}

function saveDefinitionDraft(
  cycleId: string | undefined,
  objective: string,
  criteria: string[],
  constraints: string[],
  scope: string[],
  nonGoals: string[],
  invariants: string[],
  implementationNotes: string[],
  forbiddenPaths: string[],
): ToolResult {
  const resolved = resolveCycle(cycleId, "DEFINING");
  if ("error" in resolved) return err(resolved.error);
  const { cycle, warning } = resolved;

  cycle.definition = {
    objective,
    criteria,
    constraints,
    scope,
    nonGoals,
    invariants,
    implementationNotes,
    forbiddenPaths,
  };
  saveCycle(cycle);

  const warningLine = warning ? `\n⚠️  ${warning}` : "";
  return ok(
    `Definition draft saved to ${cycle.filePath}${warningLine}\n\n` +
      `Open and review the file — edit any section freely. Bullet points (- item) are parsed as list items.\n\n` +
      `When you are happy with it, say **"lock"** and I will lock the definition and move to IMPLEMENTING.`,
  );
}

function lockDefinition(cycleId: string | undefined, shortname?: string): ToolResult {
  const resolved = resolveCycle(cycleId, "DEFINING");
  if ("error" in resolved) return err(resolved.error);
  let { cycle } = resolved;
  const { warning } = resolved;

  if (!cycle.definition) {
    return err(
      `No definition found in ${cycle.filePath}.\n` +
        `Complete #define first so a draft is saved, then say "lock".`,
    );
  }
  const { definition } = cycle;
  if (!definition.objective || definition.objective === "(fill in objective)") {
    return err(
      `Definition in ${cycle.filePath} is missing a Change Objective. Please edit the file and try again.`,
    );
  }
  if (definition.criteria.length === 0) {
    return err(`Definition is missing Acceptance Criteria. Please edit the file and try again.`);
  }
  if (definition.constraints.length === 0) {
    return err(`Definition is missing Constraints. Please edit the file and try again.`);
  }
  if (definition.scope.length === 0) {
    return err(`Definition is missing Scope (files). Please edit the file and try again.`);
  }

  // Use AI-provided shortname if given, otherwise derive from objective (3-5 words)
  const newSlug = shortname
    ? shortname.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 60)
    : slugify(definition.objective);
  cycle = renameCycleFile(cycle, newSlug);

  // Rename git branch
  const newBranch = `hal/${cycle.frontMatter.id}_${newSlug}`;
  const branchErr = renameBranch(newBranch);

  // Update status
  cycle.frontMatter.status = "IMPLEMENTING";
  saveCycle(cycle);

  const branchNote = branchErr
    ? `\n⚠️  Branch rename failed: ${branchErr.split("\n")[0]}`
    : `\nBranch: ${newBranch}`;
  const warningLine = warning ? `\n⚠️  ${warning}` : "";

  return ok(
    `Definition locked. Status: IMPLEMENTING\n` +
      `Cycle file: ${cycle.filePath}` +
      branchNote +
      warningLine +
      `\n\nObjective:   ${definition.objective}\n` +
      `Criteria:    ${definition.criteria.length} item(s)\n` +
      `Constraints: ${definition.constraints.length} item(s)\n` +
      `Scope:       ${definition.scope.length} file(s)\n` +
      `Forbidden:   ${definition.forbiddenPaths.length} path(s)\n\n` +
      `Next: use **#implement** to start the implementation.`,
  );
}

function submitImplementation(cycleId: string | undefined, comment: string): ToolResult {
  const resolved = resolveCycle(cycleId, "IMPLEMENTING");
  if ("error" in resolved) return err(resolved.error);
  const { cycle, warning } = resolved;

  const head = getHeadCommit();
  const implNumber = cycle.implementations.length + 1;
  cycle.implementations.push({
    number: implNumber,
    submittedAt: new Date().toISOString(),
    commit: head,
    comment,
  });
  cycle.frontMatter.status = "REVIEWING";
  saveCycle(cycle);

  const warningLine = warning ? `\n⚠️  ${warning}` : "";
  return ok(
    `Implementation ${implNumber} submitted. Status: REVIEWING\n` +
      `Cycle: ${cycle.frontMatter.id}\n` +
      `Commit: ${head ?? "(unknown)"}\n` +
      `Comment: ${comment}` +
      warningLine +
      `\n\nNext: use **#review** with an independent reviewer.`,
  );
}

function submitReview(
  cycleId: string | undefined,
  verdict: "APPROVED" | "BLOCKED",
  feedback: string,
): ToolResult {
  const resolved = resolveCycle(cycleId, "REVIEWING");
  if ("error" in resolved) return err(resolved.error);
  const { cycle, warning } = resolved;

  const reviewNumber = cycle.reviews.length + 1;
  cycle.reviews.push({
    number: reviewNumber,
    verdict,
    feedback,
    reviewedAt: new Date().toISOString(),
  });

  const warningLine = warning ? `\n⚠️  ${warning}` : "";

  if (verdict === "APPROVED") {
    cycle.frontMatter.status = "DECIDING";
    saveCycle(cycle);
    return ok(
      `Review ${reviewNumber}: APPROVED. Status: DECIDING\n\n` +
        `Feedback: ${feedback}` +
        warningLine +
        `\n\nNext: use **#decide** to make the final approval.`,
    );
  }

  cycle.frontMatter.retryCount += 1;
  if (cycle.frontMatter.retryCount >= MAX_RETRIES) {
    cycle.frontMatter.status = "DECIDING";
    saveCycle(cycle);
    return ok(
      `Review ${reviewNumber}: BLOCKED — retry limit reached (${MAX_RETRIES}/${MAX_RETRIES}). Status: DECIDING\n\n` +
        `Feedback: ${feedback}` +
        warningLine +
        `\n\nEscalating to Human. Use **#decide** to determine next steps.`,
    );
  }

  cycle.frontMatter.status = "IMPLEMENTING";
  saveCycle(cycle);
  return ok(
    `Review ${reviewNumber}: BLOCKED. Status: IMPLEMENTING (retry ${cycle.frontMatter.retryCount}/${MAX_RETRIES})\n\n` +
      `Feedback: ${feedback}` +
      warningLine +
      `\n\nNext: Implementer must address the feedback. Use **#implement** and call submit_implementation() again.`,
  );
}

function decide(cycleId: string | undefined, approved: boolean, feedback: string): ToolResult {
  const resolved = resolveCycle(cycleId, "DECIDING");
  if ("error" in resolved) return err(resolved.error);
  const { cycle, warning } = resolved;

  const warningLine = warning ? `\n⚠️  ${warning}` : "";

  if (approved) {
    cycle.decision = {
      approved: true,
      feedback,
      decidedAt: new Date().toISOString(),
    };
    cycle.frontMatter.status = "DECIDED";
    saveCycle(cycle);
    const total = listCycles().filter((c) => c.frontMatter.status === "DECIDED").length;

    // Merge cycle branch into main
    const mergeMsg = `Merge ${cycle.frontMatter.branch}: ${cycle.definition?.objective ?? cycle.frontMatter.slug}`;
    const mergeErr = mergeBranchToMain(cycle.frontMatter.branch, mergeMsg);
    const mergeNote = mergeErr
      ? `\n⚠️  Auto-merge failed: ${mergeErr}. Merge manually: git checkout main && git merge --no-ff ${cycle.frontMatter.branch}`
      : `\nMerged ${cycle.frontMatter.branch} → main.`;

    return ok(
      `Cycle ${cycle.frontMatter.id} APPROVED. Status: DECIDED\n\n` +
        `Feedback: ${feedback}` +
        mergeNote +
        warningLine +
        `\n\nCycle recorded (${total} completed total). Ready for next **#define**.`,
    );
  }

  // Rejected — record decision, clear definition and implementation artifacts, return to DEFINING
  cycle.decision = {
    approved: false,
    feedback,
    decidedAt: new Date().toISOString(),
  };
  cycle.definition = null;
  cycle.implementations = [];
  cycle.reviews = [];
  cycle.frontMatter.status = "DEFINING";
  cycle.frontMatter.retryCount = 0;
  saveCycle(cycle);
  return ok(
    `Cycle ${cycle.frontMatter.id} REJECTED. Status: DEFINING\n\n` +
      `Feedback: ${feedback}` +
      warningLine +
      `\n\nDefinition cleared. Use **#define** to revise and re-lock.`,
  );
}
