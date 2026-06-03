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
  /** Implementer tier — narrow implementation (stand-in for local Qwen3-Coder-Next). */
  execModel: string;
  /**
   * Per-task verify/refine review. Runs on the IMPLEMENTER tier by default so the
   * verify/refine loop (the ~59% token cost) stays cheap and the loop is closed
   * locally — not on the premium model. Defaults to `execModel` when unset.
   */
  selfReviewModel: string;
  /**
   * Orchestrator tier — the final, once-per-run integration cross-file review
   * over the whole diff (premium / Sonnet). Kept named `reviewModel` so existing
   * `.pi/settings.json` files keep working.
   */
  reviewModel: string;
  cacheRetention: CacheRetention;
  /** Max fix re-injections per task before halting and escalating to the human. */
  maxReviewRetries: number;
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
  const execModel = typeof wf.execModel === "string" ? wf.execModel : DEFAULT_EXEC_MODEL;
  return {
    execModel,
    // The verify/refine loop is closed on the implementer tier: default to execModel.
    selfReviewModel: typeof wf.selfReviewModel === "string" ? wf.selfReviewModel : execModel,
    reviewModel: typeof wf.reviewModel === "string" ? wf.reviewModel : DEFAULT_REVIEW_MODEL,
    cacheRetention: isRetention(wf.cacheRetention) ? wf.cacheRetention : "short",
    maxReviewRetries:
      typeof wf.maxReviewRetries === "number" && Number.isFinite(wf.maxReviewRetries) && wf.maxReviewRetries >= 0
        ? Math.floor(wf.maxReviewRetries)
        : 3,
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
