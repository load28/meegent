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
      // The verify/refine loop is closed on the implementer tier → defaults to execModel.
      selfReviewModel: DEFAULT_EXEC_MODEL,
      reviewModel: DEFAULT_REVIEW_MODEL,
      cacheRetention: "short",
      maxReviewRetries: 3,
    });
  });

  it("defaults selfReviewModel to execModel (verify/refine stays on the cheap tier)", () => {
    expect(parseWorkflowConfig({ workflow: { execModel: "openrouter/qwen/qwen3-coder-flash" } }).selfReviewModel).toBe(
      "openrouter/qwen/qwen3-coder-flash",
    );
  });

  it("reads overrides from the workflow block", () => {
    const cfg = parseWorkflowConfig({
      workflow: {
        execModel: "openrouter/qwen/qwen3-coder-next",
        selfReviewModel: "openrouter/qwen/qwen3-coder-flash",
        reviewModel: "openrouter/anthropic/claude-sonnet-4.6",
        cacheRetention: "long",
        maxReviewRetries: 5,
      },
    });
    expect(cfg).toEqual({
      execModel: "openrouter/qwen/qwen3-coder-next",
      selfReviewModel: "openrouter/qwen/qwen3-coder-flash",
      reviewModel: "openrouter/anthropic/claude-sonnet-4.6",
      cacheRetention: "long",
      maxReviewRetries: 5,
    });
  });

  it("defaults and validates maxReviewRetries (non-negative number)", () => {
    expect(parseWorkflowConfig({}).maxReviewRetries).toBe(3);
    expect(parseWorkflowConfig({ workflow: { maxReviewRetries: 0 } }).maxReviewRetries).toBe(0);
    expect(parseWorkflowConfig({ workflow: { maxReviewRetries: -1 } }).maxReviewRetries).toBe(3);
    expect(parseWorkflowConfig({ workflow: { maxReviewRetries: "two" } }).maxReviewRetries).toBe(3);
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
