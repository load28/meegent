import { describe, it, expect } from "vitest";
import { buildMemoryBlock, mergeFacts } from "../../.pi/extensions/meeagent/memory/inject.js";

describe("buildMemoryBlock", () => {
  it("includes both tiers when present", () => {
    const block = buildMemoryBlock("proj stuff", "global stuff");
    expect(block).toContain("Project memory");
    expect(block).toContain("proj stuff");
    expect(block).toContain("Global memory");
    expect(block).toContain("global stuff");
  });
  it("returns empty string when both tiers empty", () => {
    expect(buildMemoryBlock("", "")).toBe("");
  });
  it("omits an empty tier", () => {
    const block = buildMemoryBlock("", "g");
    expect(block).not.toContain("Project memory");
    expect(block).toContain("Global memory");
  });
});

describe("mergeFacts", () => {
  it("appends new bullet facts, skipping duplicates", () => {
    const out = mergeFacts("- a\n", ["a", "b"], 8000);
    expect(out).toBe("- a\n- b");
  });
  it("truncates oldest lines when over the cap", () => {
    const out = mergeFacts("- old1\n- old2\n", ["new"], 12);
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out).toContain("- new");
  });
  it("hard-caps a single oversized line to maxChars", () => {
    const out = mergeFacts("", ["x".repeat(50)], 10);
    expect(out.length).toBe(10);
  });
});
