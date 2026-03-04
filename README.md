# HAL — Structured Agentic Coding Governor

HAL is an MCP (Model Context Protocol) server that enforces a governed loop separating definition, implementation, and review. No code is accepted without passing all three gates.

---

## Quick Start

### 1. Install & Build

```bash
npm install   # installs dependencies and runs tsc automatically
```

### 2. Connect to VSCode

HAL is pre-configured in `.vscode/mcp.json`. It runs via **nodemon**, which restarts the server automatically whenever you build. Open the project in VSCode and the MCP server starts immediately.

### 3. Start using HAL

In GitHub Copilot Chat, type:

```
/mcp.hal.hal
```

That's it. HAL will tell you your current status and exactly what to do next.

---

## Which Client to Use

HAL splits work across two AI clients to keep the implementation stage isolated from governance:

| Stage | Command | Client |
|---|---|---|
| DEFINE | `/mcp.hal.define` | GitHub Copilot Chat |
| IMPLEMENT | `/mcp.hal.implement` | **Claude terminal client** |
| REVIEW | `/mcp.hal.review` | GitHub Copilot Chat |
| DECIDE | `/mcp.hal.decide` | GitHub Copilot Chat |
| Status | `/mcp.hal.hal` | Either |

### GitHub Copilot Chat (DEFINE, REVIEW, DECIDE)

HAL is pre-configured in `.vscode/mcp.json`. Open Copilot Chat in VSCode and type the commands directly:

```
/mcp.hal.define
/mcp.hal.review
/mcp.hal.decide
```

### Claude Terminal Client (IMPLEMENT)

The Claude terminal client runs as a separate agentic session with shell and file system access. Set the following environment variables to connect it to the HAL MCP server:

```bash
export MCP_BASE_URL=http://localhost:<port>
export MCP_API_KEY=<your-key>
```

Then invoke the implement stage:

```
claude mcp invoke /mcp.hal.implement
```

---

## Development Workflow

To get auto-reload on code changes, run the TypeScript compiler in watch mode in a terminal:

```bash
npm run build:watch
```

Nodemon watches `dist/` and restarts the MCP server whenever the build output changes. No manual restarts needed.

**Other run modes:**

```bash
npm run dev     # tsx direct (no build step, for quick iteration)
npm start       # run the built dist/index.js once
```

---

## The Five Commands

These are the only commands you need to know. Type them in GitHub Copilot Chat to move through the workflow.

| Command | When to use | What happens |
|---|---|---|
| `/mcp.hal.hal` | Anytime | Shows status, progress, and what to do next |
| `/mcp.hal.define` | IDLE or DEFINING | AI asks clarifying questions → saves definition draft |
| `/mcp.hal.implement` | IMPLEMENTING | AI implements the locked definition |
| `/mcp.hal.review` | REVIEWING | AI independently reviews the implementation |
| `/mcp.hal.decide` | DECIDING | You approve or reject the final result |

HAL always tells you which command to use next — you never have to guess.

---

## The Workflow

Work moves through five states in a strict sequence. No stage can be bypassed.

```
IDLE → DEFINING → IMPLEMENTING → REVIEWING → DECIDING → IDLE
```

### Stage 1 — DEFINE (`/mcp.hal.define`)

The AI enters DEFINE MODE. Hard rules apply:
- It will **not** suggest implementation details, algorithms, or design patterns
- It **will** ask clarifying questions one or two at a time
- It **will** challenge vague language ("make it better", "handle errors")
- It **will** force explicit decisions on tradeoffs

When all 8 sections of the Definition Artifact are complete, the AI saves a draft to `.agents/hal/definition.md`. You can open and edit this file freely — it's plain markdown. When you're happy, say **"lock"** and the definition is locked for implementation.

**What good definition prompts look like:**

```
/mcp.hal.define I want to add a rate limiter to the API endpoints
```
```
/mcp.hal.define The login form needs to validate email format before submitting
```
```
/mcp.hal.define Refactor the config loader to support environment-specific overrides
```

Keep your initial prompt to the intent — the AI will extract everything else through questions.

### Stage 2 — IMPLEMENT (`/mcp.hal.implement`)

The AI receives the locked definition and implements it exactly. It will:
- Touch only the files listed in the definition scope
- Avoid forbidden paths
- Not implement anything in Non-Goals
- Commit all changes when done

When finished, it calls `submit_implementation` automatically.

**Using the Claude terminal client:**

Use the **Claude terminal client** for this stage — not Copilot Chat. See [Which Client to Use](#which-client-to-use) for setup, then run:

```
claude mcp invoke /mcp.hal.implement
```

If you want to give context about the environment, say it before invoking the command.

### Stage 3 — REVIEW (`/mcp.hal.review`)

An independent reviewer AI checks the implementation in two phases:

**Phase A (mechanical):** Did the implementation touch only the declared files? Did it touch any forbidden paths? Is the diff empty?

**Phase B (semantic):** Does it satisfy all acceptance criteria? Are edge cases handled? Were any non-goals sneaked in?

If the review is BLOCKED, the state returns to IMPLEMENTING (up to 3 retries). At the retry limit, it escalates to DECIDING.

**What good review prompts look like:**

No special prompt needed — just type `/mcp.hal.review`. The reviewer has everything it needs from the locked definition and git diff.

### Stage 4 — DECIDE (`/mcp.hal.decide`)

You make the final call. The AI presents a plain-English summary of what was built and the reviewer's verdict, then asks:

> Do you approve this implementation? (yes / no)

- **yes** → cycle recorded in history, returns to IDLE
- **no** → you explain what needs to change, definition is cleared, returns to DEFINING

---

## The Definition Artifact

The definition draft is saved to `.agents/hal/definition.md` after the DEFINE Q&A. It looks like this:

```markdown
---
intent: "Add rate limiting to API endpoints"
status: DRAFT
---

# HAL Definition Artifact

## Change Objective
All API endpoints return HTTP 429 after more than 100 requests per minute from a single IP.

## Acceptance Criteria
- A counter per IP is tracked with a 60-second sliding window
- Requests beyond the limit receive 429 with a Retry-After header
- Requests within the limit pass through unchanged

## Constraints
- Must not introduce a database dependency
- Must work with the existing Express middleware stack

## Scope (Claimed Files)
- src/middleware/rateLimit.ts
- src/app.ts

## Non-Goals
- Per-user rate limiting (only per-IP)
- Configurable limits via environment variables

## Invariants
- Existing middleware order is unchanged
- All current tests continue to pass

## Implementation Notes
- (none)

## Forbidden Paths
- src/core/
- tests/
```

Edit any section before saying "lock". Bullet points are parsed as list items. The `Change Objective` section should be a single sentence.

---

## State & History

HAL persists state to `.agents/hal/state.json`. Delete it to reset to `IDLE`.

After an approved cycle, the full record is added to `history` in state.json. Review artifacts (with rollback plans) are written to `ce-reviews/`.

---

## Resources

Read-only data the MCP client can fetch at any time:

| URI | Content |
|---|---|
| `hal://status` | Current state + retry count + active intent |
| `hal://definition` | Locked Definition Artifact (JSON) |
| `hal://history` | All completed cycles (JSON array) |
| `hal://latest-review` | Most recent verdict and feedback (JSON) |

---

## Tools Reference

| Tool | When called | What it does |
|---|---|---|
| `start_cycle(intent)` | IDLE | Starts a new cycle, records baseline commit |
| `save_definition_draft(...)` | DEFINING | Saves definition as markdown, stays in DEFINING |
| `lock_definition()` | DEFINING | Reads markdown draft, locks definition → IMPLEMENTING |
| `set_definition(...)` | DEFINING | Locks definition directly (programmatic use) |
| `submit_implementation(comment)` | IMPLEMENTING | Snapshots git diff → REVIEWING |
| `submit_review(verdict, feedback)` | REVIEWING | APPROVED → DECIDING, BLOCKED → IMPLEMENTING |
| `decide(approved, feedback)` | DECIDING | true → IDLE, false → DEFINING |

---

## Source Layout

```
src/
├── index.ts       ← server init + transport
├── constants.ts   ← MAX_RETRIES, STATE_FILE, DEFINITION_DRAFT_FILE
├── state.ts       ← types + loadState / saveState
├── markdown.ts    ← definition draft save / markdown parser
├── git.ts         ← getHeadCommit / getGitDiff / getChangedFiles
├── resources.ts   ← hal:// resource handlers
├── prompts.ts     ← hal / hal-define / hal-implement / hal-review / hal-decide
└── tools.ts       ← all seven tool implementations
```
