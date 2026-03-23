import { readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync } from "fs";
import { join } from "path";
import { CYCLES_DIR } from "../constants.js";
import type { CycleData, CycleFrontMatter } from "./types.js";
import { parseCycleFile, parseFrontMatterOnly } from "./parse.js";
import { formatCycleFile } from "./format.js";

/** File format: {id}_{slug}.md  — underscore separates date-id from slug */
export function getCycleFilePath(id: string, slug: string): string {
  return join(CYCLES_DIR, `${id}_${slug}.md`);
}

/** Returns YYYY-MM-DD_NN (e.g. 2026-03-04_01, 2026-03-04_02 …) */
export function getNextCycleId(): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  mkdirSync(CYCLES_DIR, { recursive: true });
  const files = readdirSync(CYCLES_DIR).filter((f) => f.startsWith(`${today}_`));
  let maxCounter = 0;
  for (const f of files) {
    const m = f.match(new RegExp(`^${today}_(\\d{2})_`));
    if (m) maxCounter = Math.max(maxCounter, parseInt(m[1], 10));
  }
  return `${today}_${String(maxCounter + 1).padStart(2, "0")}`;
}

export function findCycleFile(id: string): string | null {
  mkdirSync(CYCLES_DIR, { recursive: true });
  const files = readdirSync(CYCLES_DIR).filter((f) => f.startsWith(`${id}_`) && f.endsWith(".md"));
  if (files.length === 0) return null;
  return join(CYCLES_DIR, files[0]);
}

export function createCycle(id: string, branch: string, baseBranch: string): CycleData {
  const frontMatter: CycleFrontMatter = {
    id,
    slug: "undefined",
    status: "DEFINING",
    branch,
    baseBranch,
    retryCount: 0,
    startedAt: new Date().toISOString(),
  };
  const data: CycleData = {
    frontMatter,
    definition: null,
    implementations: [],
    reviews: [],
    decision: null,
    filePath: getCycleFilePath(id, "undefined"),
  };
  mkdirSync(CYCLES_DIR, { recursive: true });
  writeFileSync(data.filePath, formatCycleFile(data), "utf-8");
  return data;
}

export function loadCycle(id: string): CycleData | null {
  const filePath = findCycleFile(id);
  if (!filePath) return null;
  try {
    const content = readFileSync(filePath, "utf-8");
    return parseCycleFile(content, filePath);
  } catch {
    return null;
  }
}

export function saveCycle(data: CycleData): void {
  writeFileSync(data.filePath, formatCycleFile(data), "utf-8");
}

export function renameCycleFile(data: CycleData, newSlug: string): CycleData {
  const newPath = getCycleFilePath(data.frontMatter.id, newSlug);
  if (data.filePath !== newPath) {
    renameSync(data.filePath, newPath);
  }
  data.frontMatter.slug = newSlug;
  data.frontMatter.branch = `hal/${data.frontMatter.id}_${newSlug}`;
  data.filePath = newPath;
  writeFileSync(data.filePath, formatCycleFile(data), "utf-8");
  return data;
}

const TERMINAL_STATUSES = new Set(["APPROVED", "REJECTED", "DECIDED"]);

function cycleFiles(): string[] {
  mkdirSync(CYCLES_DIR, { recursive: true });
  return readdirSync(CYCLES_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}.*_.*\.md$/.test(f))
    .sort();
}

/** Returns front matter for every cycle file without parsing the body. */
export function listCycleFrontMatters(): CycleFrontMatter[] {
  return cycleFiles().flatMap((f) => {
    try {
      const fm = parseFrontMatterOnly(readFileSync(join(CYCLES_DIR, f), "utf-8"));
      return fm ? [fm] : [];
    } catch {
      return [];
    }
  });
}

/** Returns full data for every cycle file (active and terminal). Prefer getActiveCycles() where possible. */
export function listCycles(): CycleData[] {
  return cycleFiles().flatMap((f) => {
    try {
      const fp = join(CYCLES_DIR, f);
      const cycle = parseCycleFile(readFileSync(fp, "utf-8"), fp);
      return cycle ? [cycle] : [];
    } catch {
      return [];
    }
  });
}

/**
 * Returns full data for non-terminal cycles only.
 * Two-stage: parse front matter first (cheap), skip terminal-status files,
 * then fully parse only the active ones.
 */
export function getActiveCycles(): CycleData[] {
  return cycleFiles().flatMap((f) => {
    try {
      const fp = join(CYCLES_DIR, f);
      const content = readFileSync(fp, "utf-8");
      const fm = parseFrontMatterOnly(content);
      if (!fm || TERMINAL_STATUSES.has(fm.status)) return [];
      const cycle = parseCycleFile(content, fp);
      return cycle ? [cycle] : [];
    } catch {
      return [];
    }
  });
}
