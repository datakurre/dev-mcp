import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getActiveCycles, loadCycle } from "./cycles.js";
import { MAX_RETRIES } from "./constants.js";

export function registerResources(server: Server): void {
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: "hal://status",
        name: "Status",
        description: "Summary of all active cycles and their current stages",
        mimeType: "text/plain",
      },
      {
        uri: "hal://cycles",
        name: "Active Cycles",
        description: "All currently active cycles (DEFINING, IMPLEMENTING, REVIEWING, DECIDING). For full history use hal://cycle/{id}.",
        mimeType: "application/json",
      },
      {
        uri: "hal://cycle/{id}",
        name: "Cycle by ID",
        description:
          "Full data for a single cycle identified by its ID (e.g. hal://cycle/2026-03-04_01)",
        mimeType: "application/json",
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === "hal://status") {
      const active = getActiveCycles();
      if (active.length === 0) {
        return { contents: [{ uri, mimeType: "text/plain", text: "IDLE — no active cycles." }] };
      }
      const lines = active.map((c) => {
        const fm = c.frontMatter;
        const retryNote = fm.retryCount > 0 ? ` (retry ${fm.retryCount}/${MAX_RETRIES})` : "";
        return `${fm.id} [${fm.status}${retryNote}] ${fm.slug} — ${fm.branch}`;
      });
      return { contents: [{ uri, mimeType: "text/plain", text: lines.join("\n") }] };
    }

    if (uri === "hal://cycles") {
      const active = getActiveCycles();
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(active, null, 2) }],
      };
    }

    // hal://cycle/{id}  e.g. hal://cycle/2026-03-04_01
    const cycleMatch = uri.match(/^hal:\/\/cycle\/(.+)$/);
    if (cycleMatch) {
      const id = cycleMatch[1];
      const cycle = loadCycle(id);
      if (!cycle) {
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify({ error: `Cycle ${id} not found.` }),
            },
          ],
        };
      }
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(cycle, null, 2) }],
      };
    }

    throw new Error(`Unknown resource URI: ${uri}`);
  });
}
