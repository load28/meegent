import type { ProjectState } from "./store.js";

export interface DistillConfig { threshold: number; intervalMs: number; }

/** Decide whether a project's raw logs should be distilled now. */
export function isDistillDue(state: ProjectState, now: number, cfg: DistillConfig): boolean {
  if (state.undistilledLogCount <= 0) return false;
  if (state.undistilledLogCount >= cfg.threshold) return true;
  return now - state.lastDistillTs >= cfg.intervalMs;
}
