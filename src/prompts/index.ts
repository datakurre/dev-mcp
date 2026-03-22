import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { buildDefinePrompt } from "./define.js";
import { buildImplementPrompt } from "./implement.js";
import { buildReviewPrompt } from "./review.js";
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
        name: "implement",
        description:
          "IMPLEMENT stage: execute all locked definitions and commit the results.",
      },
      {
        name: "review",
        description:
          "REVIEW stage: independently verify the implementation against the definition and produce a verdict.",
      },
      {
        name: "decide",
        description:
          "DECIDE stage: human final approval — approve to complete the cycle or reject to revise the definition.",
      },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name } = request.params;

    switch (name) {
      case "define":
        return buildDefinePrompt();
      case "implement":
        return buildImplementPrompt();
      case "review":
        return buildReviewPrompt();
      case "decide":
        return buildDecidePrompt();
      default:
        throw new Error(`Unknown prompt: ${name}`);
    }
  });
}
