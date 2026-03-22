export function formatList(items: string[]): string {
  if (items.length === 0) return "  (none)";
  return items.map((item, i) => `${i + 1}. ${item}`).join("\n");
}

export function formatScope(files: string[]): string {
  if (files.length === 0) return "  (none declared)";
  return files.map((f) => `- ${f}`).join("\n");
}
