# HAL — Structured Agentic Coding Governor

HAL is an MCP (Model Context Protocol) server that enforces a governed coding loop. Every change must pass through **Define → Implement → Review → Decide** before being accepted. No code ships without passing all gates.

---

## Usage

### Install & Build

```bash
npm install        # installs dependencies and compiles TypeScript
```

### Common Commands

```bash
npm run build       # compile TypeScript → dist/
npm run build:watch # watch mode — recompiles on every change
npm run dev         # run directly via tsx (no build step)
npm start           # run the compiled server once
```

### Try it

```bash
npm install && npm run build && npm start
```

This starts the HAL MCP server over stdio. Connect it to VSCode or Claude Code as described below, then start a cycle with `/mcp.hal.define` or `/mcp__hal__define`.

---

## MCP Configuration — VSCode

HAL ships with `.vscode/mcp.json`, which starts the server automatically via nodemon (restarts on rebuild).

**Step 1** — Start the TypeScript compiler in watch mode:

```bash
npm run build:watch
```

**Step 2** — Open the project in VSCode. The HAL MCP server starts automatically from `.vscode/mcp.json`. No manual server start needed.

**Step 3** — Open **GitHub Copilot Chat** and use these commands:

| Stage | Command | Notes |
|-------|---------|-------|
| Define | `/mcp.hal.define` | Describe your intent; HAL generates the definition |
| Review | `/mcp.hal.review` | Run after implementation is submitted |
| Decide | `/mcp.hal.decide` | Final human approval |

> **Note:** Run the **Implement** stage using Claude Code (see below), not Copilot Chat. This keeps the implementation session isolated from governance.

---

## MCP Configuration — Claude

The **Claude Code** terminal client handles the Implement stage. It needs file-system and shell access — that's why it runs as a separate session from governance.

**Step 1** — Add HAL as an MCP server. Choose one option:

*Option A — one-time CLI registration (uses the built dist):*
```bash
claude mcp add hal -- node "$(pwd)/dist/index.js"
```

*Option B — project-local config with live-reload (for development):*

Create `.claude/mcp.json` in the project root:
```json
{
  "mcpServers": {
    "hal": {
      "type": "stdio",
      "command": "node_modules/.bin/nodemon",
      "args": ["--quiet", "--watch", "dist", "--ext", "js", "--exec", "node dist/index.js"]
    }
  }
}
```

**Step 2** — Make sure the server is compiled (if not already running `build:watch`):

```bash
npm run build
```

**Step 3** — In a Claude Code terminal session, invoke the implement stage:

```
/mcp__hal__implement
```

Claude Code will read the locked definition and implement it exactly as specified.

---

## Which Client Handles Which Stage

| Stage | Command (VSCode) | Command (Claude Code) | Client |
|-------|------------------|-----------------------|--------|
| Define | `/mcp.hal.define` | `/mcp__hal__define` | GitHub Copilot Chat (or Claude Code) |
| Implement | — | `/mcp__hal__implement` | **Claude Code only** |
| Review | `/mcp.hal.review` | `/mcp__hal__review` | GitHub Copilot Chat (or Claude Code) |
| Decide | `/mcp.hal.decide` | `/mcp__hal__decide` | GitHub Copilot Chat (or Claude Code) |

---

## Development Workflow

To get auto-reload on code changes:

```bash
npm run build:watch   # terminal 1 — watches src/, recompiles to dist/
```

Nodemon (configured in `.vscode/mcp.json`) watches `dist/` and restarts the MCP server whenever compiled output changes.

---

## The Workflow

Work moves through four states in a strict sequence. No stage can be bypassed.

```
DEFINING → IMPLEMENTING → REVIEWING → DECIDING → (next cycle)
```

### Stage 1 — Define

Start a new cycle and describe your intent. HAL generates a complete Definition Artifact with scope, acceptance criteria, constraints, and forbidden paths. Edit the draft freely — it's plain markdown saved in `.engineering/`. When you're satisfied, say **"lock"** to seal it for implementation.

**Example prompts:**

```
/mcp.hal.define Add a rate limiter to the API endpoints
/mcp.hal.define The login form needs to validate email format before submitting
/mcp.hal.define Refactor the config loader to support environment-specific overrides
```

Keep your prompt to the intent — HAL asks follow-up questions if needed.

### Stage 2 — Implement

HAL reads the locked definition and implements it exactly: touching only declared files, avoiding forbidden paths, and ignoring non-goals. When done, it calls `submit_implementation` automatically.

Use the **Claude Code** terminal client for this stage (see [MCP Configuration — Claude](#mcp-configuration--claude)).

### Stage 3 — Review

An independent reviewer checks the implementation in two phases:

- **Phase A (mechanical):** Did it touch only declared files? Did it avoid forbidden paths?
- **Phase B (semantic):** Does it satisfy all acceptance criteria? Were non-goals sneaked in?

If BLOCKED, the state returns to Implementing (up to 3 retries). At the retry limit it escalates to Deciding.

### Stage 4 — Decide

You make the final call. HAL presents a plain-English summary and asks for approval.

- **Approved** → cycle recorded, ready for next cycle
- **Rejected** → explain what needs to change; definition is cleared and returns to Defining

---

## The Definition Artifact

Each cycle lives in `.engineering/YYYY-MM-DD_NN_slug.md` (e.g. `2026-03-04_01_add-rate-limiting.md`). A locked definition looks like this:

```markdown
---
id: "2026-03-04_01"
slug: add-rate-limiting
status: IMPLEMENTING
branch: hal/2026-03-04_01_add-rate-limiting
baseCommit: abc1234
retryCount: 0
startedAt: "2026-03-04T10:00:00.000Z"
---

## Objective
All API endpoints return HTTP 429 after more than 100 requests per minute from a single IP.

## Acceptance Criteria
- A counter per IP is tracked with a 60-second sliding window
- Requests beyond the limit receive 429 with a Retry-After header

## Constraints
- Must not introduce a database dependency

## Scope
- src/middleware/rateLimit.ts
- src/app.ts

## Non-Goals
- Per-user rate limiting

## Invariants
- Existing middleware order is unchanged
- All current tests continue to pass

## Implementation Notes
- (none)

## Forbidden Paths
- src/core/
- tests/
```

Edit any section before saying "lock". The Objective must be a single sentence.

---

## Resources

Read-only data the MCP client can fetch at any time:

| URI | Content |
|-----|---------|
| `hal://status` | Current state and active cycles |
| `hal://cycles` | All cycle records (JSON array) |
| `hal://cycle/{id}` | Full record for a specific cycle |
