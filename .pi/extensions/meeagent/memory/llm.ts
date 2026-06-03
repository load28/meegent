import { complete, type Model, type Api } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * Run a single LLM completion. Returns text, or "" if unavailable.
 *
 * `modelOverride` lets callers route a one-shot completion to a specific model
 * (e.g. the workflow reviewer on a premium model) without changing the session
 * model. When omitted, the session's `ctx.model` is used — existing memory
 * distill/synthesize callers are unaffected.
 */
export async function runLLM(
  ctx: ExtensionContext,
  system: string,
  user: string,
  modelOverride?: Model<Api>,
): Promise<string> {
  const model = modelOverride ?? ctx.model;
  if (!model) return "";
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) return "";

  const response = await complete(
    model,
    {
      systemPrompt: system,
      messages: [{ role: "user" as const, content: [{ type: "text" as const, text: user }], timestamp: Date.now() }],
    },
    { apiKey: auth.apiKey, headers: auth.headers, signal: ctx.signal },
  );

  return response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

export type RunLLM = (system: string, user: string) => Promise<string>;
