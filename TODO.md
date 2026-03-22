# TODO — Multi-cycle concurrency improvements

Actionable tasks derived from the concurrency analysis. Ordered by impact / dependency.

---

## 1 — Add `cycleId` argument to `#review` and `#decide` prompts

The `#review` and `#decide` prompts currently hard-pick the first matching cycle.
MCP prompts support an `arguments` field; exposing `cycleId` on both removes ambiguity entirely.

- [x] Add `arguments` array to the `review` and `decide` prompt descriptors in `src/prompts/index.ts` (`ListPromptsRequestSchema` handler), each with one optional `cycleId: string` argument
- [x] Update `buildReviewPrompt()` in `src/prompts/review.ts` to accept an optional `cycleId` parameter and pass it to `resolveCycle(cycleId, "REVIEWING")`
- [x] Update `buildDecidePrompt()` in `src/prompts/decide.ts` to accept an optional `cycleId` parameter and pass it to `resolveCycle(cycleId, "DECIDING")`
- [x] Update the `GetPromptRequestSchema` dispatcher in `src/prompts/index.ts` to extract `request.params.arguments?.cycleId` and forward it to each builder

---

## 2 — Make review phase A branch-safe

`getChangedFiles` is called relative to HEAD, but the reviewer may not be on the cycle's branch.
The review prompt should explicitly check out the cycle branch before computing the diff.

- [x] Add a `checkoutBranch(name: string): string | null` helper to `src/git/commands.ts`
- [x] In `buildReviewPrompt()` (`src/prompts/review.ts`), capture `getCurrentBranch()` before the phase A diff, call `checkoutBranch(fm.branch)` if not already on it, compute `getChangedFiles`, then restore the original branch via `checkoutBranch(originalBranch)` — handle checkout errors gracefully and surface them as a phase A warning

---

## 3 — Warn in `#implement` when multiple cycles are IMPLEMENTING

Concurrent IMPLEMENTING cycles are the most likely source of branch confusion. The implementer prompt should surface a clear caution when this situation is detected so the agent is forced to be intentional.

- [x] In `buildImplementPrompt()` (`src/prompts/implement.ts`), when `implementing.length > 1`, prepend a visible warning block to the prompt text explaining that each cycle must be implemented sequentially on its own branch — check out the branch, implement, commit, then move to the next

---

## 4 — Guard `start_cycle` against an active IMPLEMENTING cycle

`start_cycle` already refuses to run off `main`, but it does not warn when another cycle is already IMPLEMENTING, which is when cross-branch confusion is most likely.

- [x] In `startCycle()` (`src/tools/startCycle.ts`), after the branch check, call `getActiveCycles()` and return a soft warning (non-error) in the success message if any cycle is currently in `IMPLEMENTING` state, advising the human to complete that cycle before context-switching

---

## 5 — Add `dependsOn` field to `CycleFrontMatter` (optional chaining)

Allows expressing that a cycle cannot advance to IMPLEMENTING until a named predecessor is DECIDED, removing rebase risk for dependent cycles entirely.

- [x] Add optional `dependsOn?: string` to `CycleFrontMatter` interface in `src/cycles/types.ts`
- [x] Persist/parse `dependsOn` in `formatFrontMatter` / `parseFrontMatter` (`src/cycles/format.ts`, `src/cycles/parse.ts`)
- [x] Add optional `dependsOn` parameter to `save_definition_draft` tool schema in `src/tools/schemas.ts` and wire it through `saveDefinitionDraft()` in `src/tools/saveDefinitionDraft.ts`
- [x] In `lockDefinition()` (`src/tools/lockDefinition.ts`), check if the referenced `dependsOn` cycle is DECIDED; if not, block with an error explaining the dependency

---

## 6 — Strengthen phase A: verify branch has commits above its base

The current check only uses `git diff --name-only baseCommit..HEAD`, which is relative to the working tree state. Augment it to also verify that the cycle branch actually has commits above its `baseCommit`, so a forgotten `git checkout` cannot produce a false-positive pass.

- [x] Add `getBranchCommitCount(baseCommit: string, branch: string): number` helper to `src/git/commands.ts` using `git rev-list --count baseCommit..branch`
- [x] In `buildReviewPrompt()` (`src/prompts/review.ts`), after the existing `isDiffEmpty` check, also check `getBranchCommitCount(fm.baseCommit, fm.branch) === 0` and, if so, produce a BLOCKED result with reason "no commits on cycle branch above baseCommit"
