const STOP_WORDS = new Set([
  "a", "an", "the", "to", "for", "of", "in", "on", "at", "by", "with",
  "and", "or", "is", "are", "was", "were", "be", "been", "that", "this",
  "from", "into", "as", "it", "its", "so", "do", "not", "all", "up",
]);

/** Extract 3–5 meaningful words from text and join with hyphens. */
export function slugify(text: string, maxWords = 5): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .slice(0, maxWords);
  return words.join("-") || "undefined";
}

export function bulletList(items: string[]): string {
  if (!items || items.length === 0) return "(none)";
  return items.map((item) => `- ${item}`).join("\n");
}

export function parseBullets(text: string): string[] {
  if (!text || text.trim() === "(none)") return [];
  return text
    .split("\n")
    .filter((line) => line.trimStart().startsWith("- "))
    .map((line) =>
      line
        .trimStart()
        .slice(2)
        .trim()
        // Strip trailing parenthetical annotations, e.g. "src/foo.ts (new)" → "src/foo.ts"
        .replace(/\s*\([^)]*\)\s*$/, ""),
    )
    .filter(Boolean);
}

/** Convert a glob pattern (supports * and **) to a RegExp. */
function globToRegex(pattern: string): RegExp {
  // Replace ** with a placeholder before escaping
  const ph = pattern.replace(/\*\*/g, "\x00");
  // Escape regex special chars (not * or the placeholder)
  const escaped = ph.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexStr = escaped
    .replace(/\x00/g, ".*")   // ** → any path segment(s)
    .replace(/\*/g, "[^/]*"); // *  → any chars except /
  return new RegExp(`^${regexStr}$`);
}

/**
 * Returns true if `file` matches any entry in `patterns`.
 * Patterns may be exact paths or glob patterns containing * or **.
 */
export function matchesScope(file: string, patterns: string[]): boolean {
  return patterns.some((pattern) =>
    pattern.includes("*") ? globToRegex(pattern).test(file) : pattern === file,
  );
}
