import { describe, it, expect } from "vitest";
import {
  summarizeUsage,
  cacheRetentionFor,
  streamCacheOptions,
  formatUsage,
} from "../../.pi/extensions/meeagent/workflow/caching.js";

const usage = {
  input: 1000,
  output: 200,
  cacheRead: 800,
  cacheWrite: 50,
  totalTokens: 2050,
  cost: { input: 0.001, output: 0.001, cacheRead: 0.00008, cacheWrite: 0.0000625, total: 0.0021425 },
};

describe("workflow-caching", () => {
  it("summarizeUsage extracts cache tokens and total cost", () => {
    expect(summarizeUsage(usage)).toEqual({
      cacheReadTokens: 800,
      cacheWriteTokens: 50,
      costUSD: 0.0021425,
    });
  });

  it("summarizeUsage tolerates missing usage", () => {
    expect(summarizeUsage(undefined)).toEqual({
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUSD: 0,
    });
  });

  it("cacheRetentionFor picks long for long-lived sessions, short otherwise", () => {
    expect(cacheRetentionFor(true)).toBe("long");
    expect(cacheRetentionFor(false)).toBe("short");
  });

  it("streamCacheOptions wraps the retention preference", () => {
    expect(streamCacheOptions("short")).toEqual({ cacheRetention: "short" });
    expect(streamCacheOptions("long")).toEqual({ cacheRetention: "long" });
  });

  it("formatUsage renders a compact cost/cache line", () => {
    expect(
      formatUsage("리뷰", { cacheReadTokens: 800, cacheWriteTokens: 50, costUSD: 0.0021 }),
    ).toBe("리뷰: $0.002100 · cacheRead 800 · cacheWrite 50");
  });
});
