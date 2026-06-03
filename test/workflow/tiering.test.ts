import { describe, it, expect } from "vitest";
import { parseModelRef } from "../../.pi/extensions/meeagent/workflow/tiering.js";

describe("workflow-tiering parseModelRef", () => {
  it("splits provider from modelId at the first slash", () => {
    expect(parseModelRef("openrouter/anthropic/claude-haiku-4.5")).toEqual({
      provider: "openrouter",
      modelId: "anthropic/claude-haiku-4.5",
    });
  });

  it("keeps colons inside the modelId (OpenRouter variants)", () => {
    expect(parseModelRef("openrouter/anthropic/claude-sonnet-4.6:exacto")).toEqual({
      provider: "openrouter",
      modelId: "anthropic/claude-sonnet-4.6:exacto",
    });
  });

  it("returns undefined for a ref without a provider boundary", () => {
    expect(parseModelRef("claude-haiku-4.5")).toBeUndefined();
    expect(parseModelRef("")).toBeUndefined();
  });
});
