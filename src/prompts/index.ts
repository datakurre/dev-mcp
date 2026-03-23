import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { buildDefinePrompt } from "./define.js";
import { buildDefineBatchPrompt } from "./defineBatch.js";
import { buildImplementPrompt } from "./implement.js";
import { buildImplementBatchClaudePrompt } from "./implementBatchClaude.js";
import { buildImplementBatchCopilotPrompt } from "./implementBatchCopilot.js";
import { buildReviewPrompt } from "./review.js";
import { buildReviewBatchClaudePrompt } from "./reviewBatchClaude.js";
import { buildReviewBatchCopilotPrompt } from "./reviewBatchCopilot.js";
import { buildDecidePrompt } from "./decide.js";

export function registerPrompts(server: Server): void {
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: "define",
        description:
          "DEFINE stage: receive the objective, generate a complete Definition Artifact, save it for review before locking.",
      },
      {
        name: "define_batch",
        description:
          "DEFINE BATCH stage: receive a newline-separated list of objectives and generate one Definition Artifact per objective, saving a draft .engineering doc for each.",
      },
      {
        name: "implement",
        description:
          "IMPLEMENT stage: execute all locked definitions and commit the results.",
      },
      {
        name: "implement_batch_claude",
        description:
          "IMPLEMENT BATCH (claude): dispatch each IMPLEMENTING cycle to the local claude CLI — one independent AI agent per cycle, running sequentially.",
      },
      {
        name: "implement_batch_copilot",
        description:
          "IMPLEMENT BATCH (copilot): dispatch each IMPLEMENTING cycle to the local copilot CLI — one independent AI agent per cycle, running sequentially.",
      },
      {
        name: "review_batch_claude",
        description:
          "REVIEW BATCH (claude): dispatch each REVIEWING cycle to the local claude CLI — one independent AI agent per cycle, running sequentially, using claude-haiku-4-5.",
      },
      {
        name: "review_batch_copilot",
        description:
          "REVIEW BATCH (copilot): dispatch each REVIEWING cycle to the local copilot CLI — one independent AI agent per cycle, running sequentially, using gpt-5-mini.",
      },
      {
        name: "review",
        description:
          "REVIEW stage: independently verify the implementation against the definition and produce a verdict.",
        arguments: [
          {
            name: "cycleId",
            description: "Cycle ID to review (e.g. '2026-03-04_01'). Optional if only one cycle is in REVIEWING state.",
            required: false,
          },
        ],
      },
      {
        name: "decide",
        description:
          "DECIDE stage: human final approval — approve to complete the cycle or reject to revise the definition.",
        arguments: [
          {
            name: "cycleId",
            description: "Cycle ID to decide (e.g. '2026-03-04_01'). Optional if only one cycle is in DECIDING state.",
            required: false,
          },
        ],
      },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name } = request.params;

    switch (name) {
      case "define":
        return buildDefinePrompt();
      case "define_batch":
        return buildDefineBatchPrompt();
      case "implement":
        return buildImplementPrompt();
      case "implement_batch_claude":
        return buildImplementBatchClaudePrompt();
      case "implement_batch_copilot":
        return buildImplementBatchCopilotPrompt();
      case "review_batch_claude":
        return buildReviewBatchClaudePrompt();
      case "review_batch_copilot":
        return buildReviewBatchCopilotPrompt();
      case "review": {
        const cid = (request.params.arguments as Record<string, string> | undefined)?.cycleId;
        return buildReviewPrompt(cid);
      }
      case "decide": {
        const cid = (request.params.arguments as Record<string, string> | undefined)?.cycleId;
        return buildDecidePrompt(cid);
      }
      default:
        throw new Error(`Unknown prompt: ${name}`);
    }
  });
}
