# HAL — Structured Agentic Coding Governor

HAL is an MCP server that governs AI-assisted code changes. You describe what you want; HAL guides the AI through a structured cycle—scoping the change, implementing it, reviewing it, and asking for your final approval—before anything is accepted.

---

## Configuration

Add HAL to your MCP-enabled client using `npx`:

```
npx run git+https://github.com/datakurre/dev-mcp.git
```

No installation or build step is needed. `npx` fetches and runs HAL directly from GitHub.

---

## Starting a Cycle

To request a change, describe what you want in plain language. Paste one objective per paragraph, with a blank line between each if you have more than one:

```
Add input validation to the registration form so that empty fields show an error message.

Ensure the API returns a 404 response with a helpful message when a resource is not found.
```

HAL treats each paragraph as a separate objective and opens a cycle for it. It generates a draft definition — a plan naming which files may be changed, what the acceptance criteria are, and what is explicitly out of scope.

---

## Locking a Definition

After HAL generates a draft, you can read and edit it freely. The draft is stored as a plain markdown file in the `.engineering/` folder in the repository.

When you are satisfied, tell HAL to lock it:

```
lock
```

If you have more than one open draft, include the cycle ID to lock a specific one:

```
lock 2026-03-04_01
```

Locking seals the definition and hands it off for implementation. No further edits are possible after locking.

---

## Approving or Rejecting Changes

Once implementation and review are complete, HAL asks for your final approval:

- **To approve:** say something like `approve` or `looks good`
- **To reject:** explain what needs to change; HAL reopens the definition for revision

Approved cycles are recorded in `.engineering/` and the branch is ready to merge.

---

## Tips

- Keep each objective focused on a single concern. HAL works best with clear, scoped requests.
- You do not need to specify files or implementation details — HAL infers scope from your objective and the codebase.
- If a cycle is blocked during review, HAL retries implementation automatically (up to three times) before escalating to you.
