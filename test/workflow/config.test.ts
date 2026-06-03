import { describe, it, expect } from "vitest";
import { parseWorkflowConfig } from "../../.pi/extensions/meeagent/workflow/config.js";
import {
  DEFAULT_EXEC_MODEL,
  DEFAULT_REVIEW_MODEL,
} from "../../.pi/extensions/meeagent/workflow/tiering.js";

describe("workflow config", () => {
  it("falls back to defaults when the workflow block is missing", () => {
    expect(parseWorkflowConfig({})).toEqual({
      execModel: DEFAULT_EXEC_MODEL,
      reviewModel: DEFAULT_REVIEW_MODEL,
      cacheRetention: "short",
    });
  });

  it("reads overrides from the workflow block", () => {
    const cfg = parseWorkflowConfig({
      workflow: {
        execModel: "openrouter/anthropic/claude-haiku-4.5",
        reviewModel: "openrouter/anthropic/claude-sonnet-4.6",
        cacheRetention: "long",
      },
    });
    expect(cfg).toEqual({
      execModel: "openrouter/anthropic/claude-haiku-4.5",
      reviewModel: "openrouter/anthropic/claude-sonnet-4.6",
      cacheRetention: "long",
    });
  });

  it("ignores an invalid cacheRetention value", () => {
    const cfg = parseWorkflowConfig({ workflow: { cacheRetention: "forever" } });
    expect(cfg.cacheRetention).toBe("short");
  });

  it("tolerates non-object input", () => {
    expect(parseWorkflowConfig(null).cacheRetention).toBe("short");
    expect(parseWorkflowConfig(undefined).execModel).toBe(DEFAULT_EXEC_MODEL);
  });
});
