import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Read a MEMORY/markdown file, returning "" if it does not exist. */
export function readMemory(file: string): string {
  try { return readFileSync(file, "utf8"); }
  catch { return ""; }
}

/** Write a MEMORY/markdown file, creating parent directories. */
export function writeMemory(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}

/** Append a raw log entry to <logDir>/<date>.md (date = "YYYY-MM-DD"). */
export function appendRawLog(logDir: string, date: string, entry: string): void {
  mkdirSync(logDir, { recursive: true });
  appendFileSync(join(logDir, `${date}.md`), `${entry}\n`, "utf8");
}

export interface ProjectState { lastDistillTs: number; undistilledLogCount: number; }
export interface MemoryState {
  projects: Record<string, ProjectState>;
  /** Reserved for Phase 2 global-synthesis scheduling; not yet consumed. */
  globalLastSynthTs: number;
}

export function readState(file: string): MemoryState {
  try { return JSON.parse(readFileSync(file, "utf8")) as MemoryState; }
  catch { return { projects: {}, globalLastSynthTs: 0 }; }
}

export function writeState(file: string, state: MemoryState): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2), "utf8");
}
