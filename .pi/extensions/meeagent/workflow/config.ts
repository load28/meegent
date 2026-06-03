/**
 * Shared workflow settings reader (`.pi/settings.json` → `workflow` block).
 *
 * `parseWorkflowConfig` is pure (unit-tested); `loadWorkflowConfig` is the thin
 * fs wrapper. Both the workflow reviewer and the memory subsystem read this so
 * the tiering models and the prompt-cache retention preference live in one place.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CacheRetention } from "@earendil-works/pi-ai";
import { DEFAULT_EXEC_MODEL, DEFAULT_REVIEW_MODEL } from "./tiering.js";

export interface WorkflowConfig {
  execModel: string;
  reviewModel: string;
  cacheRetention: CacheRetention;
}

function isRetention(v: unknown): v is CacheRetention {
  return v === "none" || v === "short" || v === "long";
}

/** Normalize raw parsed JSON into a complete config, applying defaults/fallbacks. */
export function parseWorkflowConfig(raw: unknown): WorkflowConfig {
  const wf =
    raw && typeof raw === "object" && "workflow" in raw
      ? (raw as { workflow?: Record<string, unknown> }).workflow ?? {}
      : {};
  return {
    execModel: typeof wf.execModel === "string" ? wf.execModel : DEFAULT_EXEC_MODEL,
    reviewModel: typeof wf.reviewModel === "string" ? wf.reviewModel : DEFAULT_REVIEW_MODEL,
    cacheRetention: isRetention(wf.cacheRetention) ? wf.cacheRetention : "short",
  };
}

/** Read `.pi/settings.json`; defaults applied on any read/parse failure. */
export function loadWorkflowConfig(cwd: string): WorkflowConfig {
  try {
    return parseWorkflowConfig(JSON.parse(readFileSync(join(cwd, ".pi", "settings.json"), "utf8")));
  } catch {
    return parseWorkflowConfig({});
  }
}
