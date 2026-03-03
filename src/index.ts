#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";
import { registerTools } from "./tools.js";

const server = new Server(
  { name: "hal", version: "1.0.0" },
  { capabilities: { resources: {}, prompts: {}, tools: {} } },
);

registerResources(server);
registerPrompts(server);
registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
