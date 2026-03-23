import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  startCycleSchema,
  saveDefinitionDraftSchema,
  lockDefinitionSchema,
  submitImplementationSchema,
  submitReviewSchema,
  rebaseOnBaseBranchSchema,
  decideSchema,
} from "./schemas.js";
import { err } from "./result.js";
import { startCycle } from "./startCycle.js";
import { saveDefinitionDraft } from "./saveDefinitionDraft.js";
import { lockDefinition } from "./lockDefinition.js";
import { submitImplementation } from "./submitImplementation.js";
import { submitReview } from "./submitReview.js";
import { rebaseOnBaseBranch } from "./rebaseOnBaseBranch.js";
import { decide } from "./decide.js";

export function registerTools(server: Server): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "start_cycle",
        description:
          "Initialize a new work cycle. Creates a numbered cycle file and a git branch. Transitions → DEFINING.",
        inputSchema: startCycleSchema,
        annotations: { title: "Start Cycle", destructiveHint: true, idempotentHint: false },
      },
      {
        name: "save_definition_draft",
        description:
          "Write the generated definition into the cycle markdown file for human review. Does NOT advance state. Call after generating the definition from the objective. The human then edits the file and says 'lock'.",
        inputSchema: saveDefinitionDraftSchema,
        annotations: { title: "Save Definition Draft", idempotentHint: true },
      },
      {
        name: "lock_definition",
        description:
          "Lock the definition from the cycle markdown file. Validates all required fields, renames the cycle file and git branch using the shortname, and transitions DEFINING → IMPLEMENTING.",
        inputSchema: lockDefinitionSchema,
        annotations: { title: "Lock Definition", destructiveHint: true, idempotentHint: false },
      },
      {
        name: "submit_implementation",
        description:
          "Record that implementation is complete. Appends an Implementation section to the cycle file and transitions IMPLEMENTING → REVIEWING.",
        inputSchema: submitImplementationSchema,
        annotations: { title: "Submit Implementation", idempotentHint: false },
      },
      {
        name: "submit_review",
        description:
          "Record the review verdict. Appends a Review section to the cycle file. APPROVED → DECIDING. BLOCKED → IMPLEMENTING (or DECIDING if retry limit reached).",
        inputSchema: submitReviewSchema,
        annotations: { title: "Submit Review", idempotentHint: false },
      },
      {
        name: "rebase_on_base_branch",
        description:
          "Rebase the current cycle branch onto its baseBranch. Call this at the start of every implementation before touching any files.",
        inputSchema: rebaseOnBaseBranchSchema,
        annotations: {
          title: "Rebase on Base Branch",
          destructiveHint: true,
          idempotentHint: false,
        },
      },
      {
        name: "decide",
        description:
          "Human final sign-off. Appends a Decision section to the cycle file. approved=true → DECIDED (cycle complete). approved=false → DEFINING (reopen for revision).",
        inputSchema: decideSchema,
        annotations: { title: "Decide", destructiveHint: true, idempotentHint: false },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = args as Record<string, unknown>;
    const cycleId = a.cycleId ? String(a.cycleId) : undefined;

    switch (name) {
      case "start_cycle":
        return startCycle(String(a.intent));

      case "save_definition_draft":
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
          a.dependsOn ? String(a.dependsOn) : undefined,
        );

      case "lock_definition":
        return lockDefinition(cycleId, a.shortname ? String(a.shortname) : undefined);

      case "submit_implementation":
        return submitImplementation(cycleId, String(a.comment));

      case "submit_review":
        return submitReview(
          cycleId,
          String(a.verdict) as "APPROVED" | "BLOCKED",
          String(a.feedback),
        );

      case "rebase_on_base_branch":
        return rebaseOnBaseBranch(cycleId);

      case "decide":
        return decide(cycleId, Boolean(a.approved), String(a.feedback));

      default:
        return err(`Unknown tool: ${name}`);
    }
  });
}
