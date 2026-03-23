# HAL — Structured Agentic Coding Governor

HAL is an MCP server that governs AI-assisted code changes through a structured three-stage cycle:

1. **DEFINE** — You describe what you want. HAL scaffolds a Definition Artifact: a scoped plan listing acceptance criteria, affected files, constraints, and non-goals. You review and edit the draft freely before locking it with HAL.
2. **IMPLEMENT** — A coding agent implements the locked definition on a dedicated branch, then hands off for review.
3. **REVIEW** — A separate agent independently checks the implementation against the definition and produces a verdict. HAL asks for your final approval before anything is accepted.

Nothing is implemented until the definition is locked. Nothing is accepted until you approve.

---

## Configuration

HAL runs as an MCP server. No installation or build step is needed — `npx` fetches and runs it directly from GitHub.

### VS Code

Add the following to your `.vscode/mcp.json` (or user-level `mcp.json`):

```json
{
  "servers": {
    "hal": {
      "command": "npx",
      "args": ["--yes", "git+https://github.com/datakurre/dev-mcp.git"]
    }
  }
}
```

### Claude Desktop

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hal": {
      "command": "npx",
      "args": ["--yes", "git+https://github.com/datakurre/dev-mcp.git"]
    }
  }
}
```

---

## Starting a Cycle

### Single objective — `/define`

Use the `/define` prompt to open a single cycle. HAL will ask for your objective if you have not already provided one, then generate a Definition Artifact and save it as a draft markdown file in `.engineering/`.

Example — paste your objective directly after invoking the prompt:

```
Add input validation to the registration form so that empty fields show an error message.
```

### Multiple objectives at once — `/define_batch`

Use the `/define_batch` prompt to define several changes in one go. Paste one objective per paragraph, separated by a blank line:

```
Add input validation to the registration form so that empty fields show an error message.

Ensure the API returns a 404 response with a helpful message when a resource is not found.

Refactor the database connection pool to support configurable timeout settings.
```

HAL creates one cycle per objective, saves a draft definition for each, and stays on the main branch throughout so all cycles start from the same commit.

> **Batch define from a sub-agent:** If your MCP client supports spawning sub-agents (e.g. Copilot or Claude CLI), use `/define_batch_copilot` or `/define_batch_claude` to dispatch each definition to a dedicated agent running in parallel.

---

## Locking a Definition

After HAL generates a draft, open the file in `.engineering/` and edit it freely — it is plain markdown. When you are satisfied, tell HAL to lock it:

```
lock
```

If you have more than one open draft, include the cycle ID:

```
lock 2026-03-04_01
```

Locking seals the definition, renames the file and branch to include a short slug, and advances the cycle to IMPLEMENTING.

---

## Implementing Changes

Once a definition is locked, use the `/implement` prompt to run the implementation stage for all locked cycles, or use `/implement_batch_copilot` / `/implement_batch_claude` to dispatch each cycle to an independent sub-agent.

---

## Reviewing Changes

After implementation, use the `/review` prompt to verify the implementation against the definition. Pass an optional cycle ID if more than one cycle is in REVIEWING state:

```
/review 2026-03-04_01
```

Use `/review_batch_copilot` or `/review_batch_claude` to run reviews for all REVIEWING cycles in parallel via sub-agents.

---

## Approving or Rejecting Changes

Once review is complete, the cycle artifact moves to DECIDING state. HAL will show you the file path and ask you to open it and fill in the **Approved** checkbox in the Decision section:

- **To approve:** check `[x] yes` in the Decision section of the cycle file
- **To reject:** check `[x] no` and optionally add feedback in the same section

Then invoke `/decide` (or `/decide <cycle-id>`) and HAL will read your checkboxes, call the appropriate action, and report the result. Rejected cycles move to REJECTED state; approved cycles are merged into main automatically.

---

## Tips

- Keep each objective focused on a single concern. HAL works best with clear, scoped requests.
- You do not need to specify files or implementation details — HAL infers scope from your objective and the codebase.
- If a cycle is blocked during review, HAL retries implementation automatically (up to three times) before escalating to you.
- Definitions can be edited freely before locking — use this to correct scope, tighten acceptance criteria, or add constraints.
