import { describe, it, expect } from "vitest";
import { applyEdits } from "../../.pi/extensions/meeagent/hashline/apply.js";
import type { Edit } from "../../.pi/extensions/meeagent/hashline/parse.js";

const c = "L1\nL2\nL3\nL4\n";

describe("applyEdits", () => {
  it("replaces a range with a body of any length (1→2)", () => {
    const edits: Edit[] = [{ kind: "replace", start: 2, end: 2, lines: ["A", "B"] }];
    expect(applyEdits(c, edits)).toBe("L1\nA\nB\nL3\nL4\n");
  });
  it("inserts before/after using ORIGINAL line numbers", () => {
    const edits: Edit[] = [
      { kind: "insert", pos: { type: "before", line: 1 }, lines: ["TOP"] },
      { kind: "insert", pos: { type: "after", line: 4 }, lines: ["BOT"] },
    ];
    expect(applyEdits(c, edits)).toBe("TOP\nL1\nL2\nL3\nL4\nBOT\n");
  });
  it("supports head/tail inserts", () => {
    expect(applyEdits(c, [{ kind: "insert", pos: { type: "head" }, lines: ["H"] }])).toBe("H\nL1\nL2\nL3\nL4\n");
    expect(applyEdits(c, [{ kind: "insert", pos: { type: "tail" }, lines: ["T"] }])).toBe("L1\nL2\nL3\nL4\nT\n");
  });
  it("deletes a range", () => {
    expect(applyEdits(c, [{ kind: "delete", start: 2, end: 3 }])).toBe("L1\nL4\n");
  });
  it("applies multiple edits anchored on original numbers (bottom-up safe)", () => {
    const edits: Edit[] = [
      { kind: "insert", pos: { type: "after", line: 1 }, lines: ["x"] },
      { kind: "delete", start: 3, end: 3 },
    ];
    expect(applyEdits(c, edits)).toBe("L1\nx\nL2\nL4\n");
  });
  it("preserves absence of a trailing newline", () => {
    expect(applyEdits("a\nb", [{ kind: "replace", start: 1, end: 1, lines: ["A"] }])).toBe("A\nb");
  });
  it("throws on out-of-bounds line numbers", () => {
    expect(() => applyEdits(c, [{ kind: "replace", start: 9, end: 9, lines: ["z"] }])).toThrow(/bound/i);
  });
});
