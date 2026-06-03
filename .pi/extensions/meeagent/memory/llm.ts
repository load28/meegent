import { complete, type Model, type Api, type Usage, type CacheRetention } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface RunLLMOptions {
  /** Route this completion to a specific model instead of the session's `ctx.model`. */
  model?: Model<Api>;
  /** Prompt-cache retention preference; omitted = provider default ("short"). */
  cacheRetention?: CacheRetention;
  /** Session id for providers that support session-based caching (binds related calls). */
  sessionId?: string;
  /** Receives the response Usage for cost/cache accounting. */
  onUsage?: (usage: Usage) => void;
}

/**
 * Run a single LLM completion. Returns text, or "" if unavailable.
 *
 * `opts.model` lets callers route a one-shot completion to a specific model (e.g.
 * the workflow reviewer on a premium model, or memory distill on the cheap model)
 * without changing the session model. `opts.cacheRetention` enables prompt caching
 * on this call, and `opts.onUsage` surfaces the response Usage so callers can log
 * cache hits / cost. When omitted, the session's `ctx.model` is used.
 */
export async function runLLM(
  ctx: ExtensionContext,
  system: string,
  user: string,
  opts: RunLLMOptions = {},
): Promise<string> {
  const model = opts.model ?? ctx.model;
  if (!model) return "";
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) return "";

  const response = await complete(
    model,
    {
      systemPrompt: system,
      messages: [{ role: "user" as const, content: [{ type: "text" as const, text: user }], timestamp: Date.now() }],
    },
    {
      apiKey: auth.apiKey,
      headers: auth.headers,
      signal: ctx.signal,
      ...(opts.cacheRetention ? { cacheRetention: opts.cacheRetention } : {}),
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
    },
  );

  opts.onUsage?.(response.usage);

  return response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

export type RunLLM = (system: string, user: string) => Promise<string>;
