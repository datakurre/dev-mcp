# Refactoring TODO

Suggested refactorings to follow MCP best practices and split code into single-purpose files.

---

## 1 — Split `cycles.ts` into focused modules

`cycles.ts` is ~500 lines and owns types, parsing, formatting, file I/O, and cycle resolution.
Each concern belongs in its own file under `src/cycles/`.

- [x] Create `src/cycles/types.ts` — move all TypeScript interfaces and type aliases (`CycleStatus`, `Verdict`, `CycleDefinition`, `ImplementationEntry`, `ReviewEntry`, `DecisionEntry`, `CycleFrontMatter`, `CycleData`)
- [x] Create `src/cycles/utils.ts` — move pure helpers: `slugify`, `parseBullets`, `bulletList`, `globToRegex`, `matchesScope`
- [x] Create `src/cycles/parse.ts` — move all parsing functions: `parseFrontMatter`, `parseSections`, `parseImplementationSection`, `parseReviewSection`, `parseDecisionSection`, `parseCycleFile`
- [x] Create `src/cycles/format.ts` — move `formatFrontMatter` and `formatCycleFile`
- [x] Create `src/cycles/store.ts` — move file-system operations: `getCycleFilePath`, `getNextCycleId`, `findCycleFile`, `createCycle`, `loadCycle`, `saveCycle`, `renameCycleFile`, `listCycles`, `getActiveCycles`
- [x] Create `src/cycles/resolve.ts` — move `resolveCycle` and its `ResolveResult` type
- [x] Create `src/cycles/index.ts` — barrel that re-exports everything public from the modules above, keeping all existing import paths working

---

## 2 — Split `tools.ts` into one file per tool

`tools.ts` mixes the MCP registration layer (schemas + dispatcher) with seven distinct tool implementations.

- [x] Create `src/tools/result.ts` — extract the shared `ToolResult` type and the `ok` / `err` helper functions used by all tools
- [x] Create `src/tools/schemas.ts` — extract all `inputSchema` JSON objects as named, typed constants (one export per tool), so schemas are defined once and reused by both the registration handler and any validators
- [x] Create `src/tools/startCycle.ts` — move `startCycle` implementation
- [x] Create `src/tools/saveDefinitionDraft.ts` — move `saveDefinitionDraft` implementation
- [x] Create `src/tools/lockDefinition.ts` — move `lockDefinition` implementation
- [x] Create `src/tools/submitImplementation.ts` — move `submitImplementation` implementation
- [x] Create `src/tools/submitReview.ts` — move `submitReview` implementation
- [x] Create `src/tools/rebaseOnBaseBranch.ts` — move `rebaseOnBaseBranch` implementation
- [x] Create `src/tools/decide.ts` — move `decide` implementation
- [x] Reduce `src/tools/index.ts` (current `tools.ts`) to only the MCP registration: `ListToolsRequestSchema` handler (imports schemas from `schemas.ts`) and the `CallToolRequestSchema` dispatcher (imports tool functions)

---

## 3 — Split `prompts.ts` into one file per prompt

`prompts.ts` is ~500 lines of inline template strings. Each stage prompt is an independent concern.

- [x] Create `src/prompts/define.ts` — move the `define` prompt builder (all context computation + message assembly)
- [x] Create `src/prompts/implement.ts` — move the `implement` prompt builder
- [x] Create `src/prompts/review.ts` — move the `review` prompt builder (Phase A pre-computation, rollback plan, etc.)
- [x] Create `src/prompts/decide.ts` — move the `decide` prompt builder
- [x] Reduce `src/prompts/index.ts` (current `prompts.ts`) to only the MCP registration: `ListPromptsRequestSchema` handler and the `GetPromptRequestSchema` dispatcher that delegates to the four builders above

---

## 4 — Split `git.ts` into low-level commands vs. composite operations

`git.ts` mixes thin wrappers around single git commands with higher-level composite operations.

- [x] Create `src/git/commands.ts` — move single-command wrappers: `getHeadCommit`, `getGitDiff`, `getChangedFiles`, `getCurrentBranch`, `getMainBranch`, `createBranch`, `renameBranch`, `deleteBranch`, `rebaseBranch`
- [x] Create `src/git/operations.ts` — move composite workflows: `computeRollback`, `mergeBranchToMain`
- [x] Create `src/git/index.ts` — barrel re-exporting everything, keeping existing import paths working

---

## 5 — MCP best-practice improvements

- [x] Add `title` fields to all tool `inputSchema` objects — the MCP spec recommends a human-readable `title` on each schema property; clients use it in UI labels
- [x] Add `annotations` to tool definitions (`readOnlyHint`, `destructiveHint`, `idempotentHint`) for the tools that qualify — e.g. `rebase_on_base_branch` and `decide` (with `approved: true`) are destructive; `save_definition_draft` is idempotent
- [x] Return structured `content` arrays with `type: "text"` items consistently — verify no tool accidentally returns plain strings instead of the `ToolResult` shape (already done, but make it a lint-enforced type)
- [x] Validate unknown tool names with an exhaustive `switch` + `default` that returns a typed error rather than the current `if`-chain fallthrough
- [x] Add a `hal://cycle/{id}` resource entry to the `ListResourcesRequestSchema` response (the `ReadResourceRequestSchema` handler already handles this URI pattern but it is not advertised in the resource list)
