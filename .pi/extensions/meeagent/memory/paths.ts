import { homedir } from "node:os";
import { join } from "node:path";

export const DISTILL_LOG_THRESHOLD = 3;
export const DISTILL_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const MEMORY_MAX_CHARS = 8000;

/** Default root for all meeagent memory (outside any project repo). */
export function defaultRoot(): string {
  return join(homedir(), ".meeagent");
}

/** Stable, readable key for a project, derived from its absolute cwd. */
export function projectKey(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function globalDir(root: string): string {
  return join(root, "global");
}

export function projectDir(root: string, cwd: string): string {
  return join(root, "projects", projectKey(cwd));
}

export interface MemoryPaths {
  globalMemory: string;
  projectMemory: string;
  projectLogDir: string;
  state: string;
}

export function paths(root: string, cwd: string): MemoryPaths {
  const pdir = projectDir(root, cwd);
  return {
    globalMemory: join(globalDir(root), "MEMORY.md"),
    projectMemory: join(pdir, "MEMORY.md"),
    projectLogDir: join(pdir, "logs"),
    state: join(root, "state.json"),
  };
}
