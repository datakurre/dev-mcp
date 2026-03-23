/** inputSchema definitions for all HAL tools, with title fields for MCP client display. */

export const startCycleSchema = {
  type: "object" as const,
  properties: {
    intent: {
      type: "string",
      title: "Intent",
      description: "High-level description of what this cycle will achieve",
    },
  },
  required: ["intent"],
};

export const saveDefinitionDraftSchema = {
  type: "object" as const,
  properties: {
    cycleId: {
      type: "string",
      title: "Cycle ID",
      description: "Cycle ID (e.g. '0001'). Optional if only one active cycle.",
    },
    objective: {
      type: "string",
      title: "Objective",
      description: "One-sentence statement of what will be different when complete",
    },
    criteria: {
      type: "array",
      title: "Acceptance Criteria",
      items: { type: "string" },
      description: "Specific, verifiable acceptance criteria",
    },
    constraints: {
      type: "array",
      title: "Constraints",
      items: { type: "string" },
      description: "Hard limits the implementation must respect",
    },
    scope: {
      type: "array",
      title: "Scope",
      items: { type: "string" },
      description: "Exact file paths the Implementer may touch",
    },
    nonGoals: {
      type: "array",
      title: "Non-Goals",
      items: { type: "string" },
      description: "Explicitly out-of-scope items",
    },
    invariants: {
      type: "array",
      title: "Invariants",
      items: { type: "string" },
      description: "Conditions that must remain true before and after",
    },
    implementationNotes: {
      type: "array",
      title: "Implementation Notes",
      items: { type: "string" },
      description: "Ordering or environment constraints only — no design guidance",
    },
    forbiddenPaths: {
      type: "array",
      title: "Forbidden Paths",
      items: { type: "string" },
      description: "File paths the implementation must not touch",
    },
    dependsOn: {
      type: "string",
      title: "Depends On",
      description: "Optional cycle ID that must be APPROVED before this cycle can be locked for implementation",
    },
  },
  required: ["objective", "criteria", "constraints", "scope"],
};

export const lockDefinitionSchema = {
  type: "object" as const,
  properties: {
    cycleId: {
      type: "string",
      title: "Cycle ID",
      description: "Cycle ID (e.g. '2026-03-04'). Optional if only one active cycle.",
    },
    shortname: {
      type: "string",
      title: "Shortname",
      description:
        "3–5 word kebab-case summary of the objective used as the file/branch name (e.g. 'add-jwt-auth', 'fix-login-redirect'). Generate this from the objective before calling.",
    },
  },
  required: [] as string[],
};

export const submitImplementationSchema = {
  type: "object" as const,
  properties: {
    cycleId: {
      type: "string",
      title: "Cycle ID",
      description: "Cycle ID (e.g. '0001'). Optional if only one active cycle.",
    },
    comment: {
      type: "string",
      title: "Comment",
      description: "Brief summary of what was implemented",
    },
  },
  required: ["comment"],
};

export const submitReviewSchema = {
  type: "object" as const,
  properties: {
    cycleId: {
      type: "string",
      title: "Cycle ID",
      description: "Cycle ID (e.g. '0001'). Optional if only one active cycle.",
    },
    verdict: {
      type: "string",
      title: "Verdict",
      enum: ["APPROVED", "BLOCKED"],
    },
    feedback: {
      type: "string",
      title: "Feedback",
      description: "Specific reasoning for the verdict",
    },
  },
  required: ["verdict", "feedback"],
};

export const rebaseOnBaseBranchSchema = {
  type: "object" as const,
  properties: {
    cycleId: {
      type: "string",
      title: "Cycle ID",
      description: "Cycle ID. Optional if only one active cycle.",
    },
  },
  required: [] as string[],
};

export const decideSchema = {
  type: "object" as const,
  properties: {
    cycleId: {
      type: "string",
      title: "Cycle ID",
      description: "Cycle ID (e.g. '0001'). Optional if only one active cycle.",
    },
    approved: {
      type: "boolean",
      title: "Approved",
    },
    feedback: {
      type: "string",
      title: "Feedback",
      description: "Notes on approval or reasons for rejection",
    },
  },
  required: ["approved", "feedback"],
};
