import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadState } from "./state.js";
import { MAX_RETRIES } from "./constants.js";

export function registerResources(server: Server): void {
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: "hal://status",
        name: "HAL Status",
        description:
          "Current workflow state (IDLE / DEFINING / IMPLEMENTING / REVIEWING / DECIDING)",
        mimeType: "text/plain",
      },
      {
        uri: "hal://definition",
        name: "Active Definition",
        description: "The locked Definition Artifact for the current cycle",
        mimeType: "application/json",
      },
      {
        uri: "hal://history",
        name: "Cycle History",
        description: "Log of all completed cycles and their outcomes",
        mimeType: "application/json",
      },
      {
        uri: "hal://latest-review",
        name: "Latest Review",
        description: "The most recent Review Artifact (verdict + feedback)",
        mimeType: "application/json",
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const state = loadState();
    const { uri } = request.params;

    if (uri === "hal://status") {
      let text = state.status;
      if (state.currentCycle && state.currentCycle.retryCount > 0) {
        text += ` (retry ${state.currentCycle.retryCount}/${MAX_RETRIES})`;
      }
      if (state.currentCycle?.intent) {
        text += `\nIntent: ${state.currentCycle.intent}`;
      }
      return { contents: [{ uri, mimeType: "text/plain", text }] };
    }

    if (uri === "hal://definition") {
      const def = state.currentCycle?.definition ?? null;
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(def, null, 2) }],
      };
    }

    if (uri === "hal://history") {
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(state.history, null, 2) }],
      };
    }

    if (uri === "hal://latest-review") {
      const review =
        state.currentCycle?.review ??
        (state.history.length > 0
          ? state.history[state.history.length - 1].review
          : null);
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(review, null, 2) }],
      };
    }

    throw new Error(`Unknown resource URI: ${uri}`);
  });
}
