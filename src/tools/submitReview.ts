import { ok, err, ToolResult } from "./result.js";
import { resolveCycle, saveCycle } from "../cycles.js";
import { MAX_RETRIES } from "../constants.js";

export function submitReview(
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
