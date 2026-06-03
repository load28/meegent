/**
 * Model tiering for the workflow — the section-8 orchestration topology:
 *
 *   [orchestrator / Sonnet]  brainstorm · plan · final integration cross-review
 *           │ delegates a narrow task spec
 *           ▼
 *   [implementer / Qwen3-Coder-Next]  implement + verify + refine loop, CLOSED
 *           │ returns only a compressed signal (status/changed_files/summary/…)
 *           └─ self-review (the ~59% verify/refine token cost) runs on THIS cheap
 *              tier, not the premium model.
 *
 * The implementer is the planned local Qwen3-Coder-Next; until a local runtime
 * exists we stand it in with the identical model on OpenRouter
 * (`qwen/qwen3-coder-next`, which also prices cacheRead so caching survives).
 *
 * `parseModelRef` is pure and unit-tested; the resolve/swap helpers touch the pi
 * runtime and are typecheck-gated. The build loop stays on a single model so its
 * prefix cache survives; reviews run as separate completions (see reviewer.ts).
 */

import type { Model, Api } from "@earendil-works/pi-ai";
import type { ExtensionContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Verified OpenRouter model refs (see docs/superpowers/specs/2026-06-03-spike-notes.md). */
// Implementer tier: stand-in for the planned local Qwen3-Coder-Next.
export const DEFAULT_EXEC_MODEL = "openrouter/qwen/qwen3-coder-next";
// Orchestrator tier: final integration / cross-file review.
export const DEFAULT_REVIEW_MODEL = "openrouter/anthropic/claude-sonnet-4.6";

export interface ModelRef {
  provider: string;
  modelId: string;
}

/**
 * Split a `<provider>/<modelId>` ref at the FIRST slash. The modelId keeps any
 * further slashes or colons (e.g. `anthropic/claude-sonnet-4.6:exacto`).
 * Returns undefined when there is no provider boundary.
 */
export function parseModelRef(ref: string): ModelRef | undefined {
  const i = ref.indexOf("/");
  if (i <= 0 || i === ref.length - 1) return undefined;
  return { provider: ref.slice(0, i), modelId: ref.slice(i + 1) };
}

/** Resolve a model ref against the session's registry, or undefined if unknown. */
export function resolveModel(ctx: ExtensionContext, ref: string): Model<Api> | undefined {
  const parsed = parseModelRef(ref);
  if (!parsed) return undefined;
  return ctx.modelRegistry.find(parsed.provider, parsed.modelId);
}

/** Switch the active session model. Returns false when no API key is configured. */
export function swapTo(pi: ExtensionAPI, model: Model<Api>): Promise<boolean> {
  return pi.setModel(model);
}
