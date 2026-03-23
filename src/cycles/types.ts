export type CycleStatus = "DEFINING" | "IMPLEMENTING" | "REVIEWING" | "DECIDING" | "APPROVED" | "REJECTED";
export type Verdict = "APPROVED" | "BLOCKED";

export interface CycleDefinition {
  objective: string;
  criteria: string[];
  constraints: string[];
  scope: string[];
  nonGoals: string[];
  invariants: string[];
  implementationNotes: string[];
  forbiddenPaths: string[];
}

export interface ImplementationEntry {
  number: number;
  submittedAt: string;
  commit: string | null;
  comment: string;
}

export interface ReviewEntry {
  number: number;
  verdict: Verdict;
  feedback: string;
  reviewedAt: string;
}

export interface DecisionEntry {
  approved: boolean | null; // null = pending (checkbox template not yet filled)
  feedback: string;
  decidedAt: string; // empty string if not yet decided
}

export interface CycleFrontMatter {
  id: string; // "2026-03-04_01"
  slug: string; // "undefined" or "add-jwt-auth"
  status: CycleStatus;
  branch: string; // "hal/2026-03-04_01_add-jwt-auth"
  baseBranch: string; // "main" or "master"
  retryCount: number;
  startedAt: string;
  dependsOn?: string; // optional cycle ID that must be APPROVED before this one can be locked
}

export interface CycleData {
  frontMatter: CycleFrontMatter;
  definition: CycleDefinition | null;
  implementations: ImplementationEntry[];
  reviews: ReviewEntry[];
  decision: DecisionEntry | null;
  filePath: string;
}
