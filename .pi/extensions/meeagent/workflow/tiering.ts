/**
 * Model tiering for the workflow: cheap model (Haiku) executes code, premium
 * model (Sonnet) reviews. `parseModelRef` is pure and unit-tested; the resolve/
 * swap helpers touch the pi runtime and are typecheck-gated.
 *
 * The execution loop stays on a single model so its prefix cache survives;
 * reviews run as separate completions (see reviewer.ts) rather than swapping the
 * session model on every task.
 */

import type { Model, Api } from "@earendil-works/pi-ai";
import type { ExtensionContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Verified OpenRouter model refs (see docs/superpowers/specs/2026-06-03-spike-notes.md). */
export const DEFAULT_EXEC_MODEL = "openrouter/anthropic/claude-haiku-4.5";
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
