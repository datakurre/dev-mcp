import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { STATE_FILE } from "./constants.js";

export type Status =
  | "IDLE"
  | "DEFINING"
  | "IMPLEMENTING"
  | "REVIEWING"
  | "DECIDING";

export type Verdict = "APPROVED" | "BLOCKED";

export interface Definition {
  objective: string;
  criteria: string[];
  constraints: string[];
  scope: string[];
  nonGoals: string[];
  invariants: string[];
  implementationNotes: string[];
  forbiddenPaths: string[];
}

export interface Review {
  verdict: Verdict;
  feedback: string;
  reviewedAt: string;
}

export interface Cycle {
  intent: string;
  baseCommit: string | null;
  definition: Definition | null;
  implementationComment: string | null;
  diff: string | null;
  headCommitAtSubmission: string | null;
  review: Review | null;
  retryCount: number;
  startedAt: string;
}

export interface CompletedCycle extends Cycle {
  approved: boolean;
  humanFeedback: string;
  decidedAt: string;
}

export interface HalState {
  status: Status;
  currentCycle: Cycle | null;
  history: CompletedCycle[];
}

export function initialState(): HalState {
  return { status: "IDLE", currentCycle: null, history: [] };
}

export function loadState(): HalState {
  if (!existsSync(STATE_FILE)) return initialState();
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as HalState;
  } catch {
    return initialState();
  }
}

export function saveState(state: HalState): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
