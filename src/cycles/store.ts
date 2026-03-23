import { readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync } from "fs";
import { join } from "path";
import { CYCLES_DIR } from "../constants.js";
import type { CycleData, CycleFrontMatter } from "./types.js";
import { parseCycleFile } from "./parse.js";
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

export function listCycles(): CycleData[] {
  mkdirSync(CYCLES_DIR, { recursive: true });
  return readdirSync(CYCLES_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}.*_.*\.md$/.test(f))
    .sort()
    .map((f) => {
      try {
        const fp = join(CYCLES_DIR, f);
        return parseCycleFile(readFileSync(fp, "utf-8"), fp);
      } catch {
        return null;
      }
    })
    .filter((c): c is CycleData => c !== null);
}

export function getActiveCycles(): CycleData[] {
  return listCycles().filter((c) => c.frontMatter.status !== "DECIDED");
}
