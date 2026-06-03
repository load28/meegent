/**
 * Prompt-cache configuration and usage accounting for the workflow.
 *
 * pi-ai applies Anthropic-style `cache_control` automatically for Anthropic
 * format providers and reports cache hits via `Usage`. These helpers pick a
 * `cacheRetention` preference and distill `Usage` into a small cost summary so
 * setup-workflow can log per-phase savings. Pure — unit-tested in isolation.
 *
 * NOTE: whether OpenRouter actually passes `cache_control` through on the
 * openai-completions path is spike 0.2 (docs/superpowers/specs/2026-06-03-spike-notes.md);
 * if cacheRead stays 0 live, inject OpenRouter cache markers in a
 * `before_provider_request` hook from setup-workflow.
 */

import type { CacheRetention, Usage } from "@earendil-works/pi-ai";

export interface UsageSummary {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUSD: number;
}

/** Distill a pi-ai Usage into cache-hit tokens and total cost. Safe on undefined. */
export function summarizeUsage(usage: Usage | undefined): UsageSummary {
  if (!usage) return { cacheReadTokens: 0, cacheWriteTokens: 0, costUSD: 0 };
  return {
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    costUSD: usage.cost.total,
  };
}

/** Long-lived sessions benefit from "long" retention; otherwise the cheaper "short". */
export function cacheRetentionFor(longLived: boolean): CacheRetention {
  return longLived ? "long" : "short";
}

/** Build the StreamOptions slice that enables prompt caching for a complete() call. */
export function streamCacheOptions(retention: CacheRetention): { cacheRetention: CacheRetention } {
  return { cacheRetention: retention };
}
