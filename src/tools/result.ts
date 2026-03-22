export type ToolResult = { content: [{ type: "text"; text: string }]; isError?: true };

export function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function err(text: string): ToolResult {
  return { content: [{ type: "text", text: `I'm sorry, Dave. ${text}` }], isError: true };
}
