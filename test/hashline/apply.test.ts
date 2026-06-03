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

describe("boundary auto-repair", () => {
  const fn = "function f() {\n  const a = 1;\n  return a;\n}\n";

  it("strips a trailing body line that echoes the line after the range (duplicated closer)", () => {
    // Model replaces the body (lines 2..3) but mistakenly re-includes the closing brace (line 4).
    const out = applyEdits(fn, [{ kind: "replace", start: 2, end: 3, lines: ["  return 42;", "}"] }]);
    expect(out).toBe("function f() {\n  return 42;\n}\n");
  });

  it("strips a leading body line that echoes the line before the range", () => {
    const out = applyEdits(fn, [{ kind: "replace", start: 2, end: 3, lines: ["function f() {", "  return 42;"] }]);
    expect(out).toBe("function f() {\n  return 42;\n}\n");
  });

  it("leaves a body with no boundary echo untouched", () => {
    const out = applyEdits(fn, [{ kind: "replace", start: 2, end: 2, lines: ["  const a = 2;"] }]);
    expect(out).toBe("function f() {\n  const a = 2;\n  return a;\n}\n");
  });
});

describe("block edits", () => {
  const src = "function f() {\n  const a = 1;\n  return a;\n}\nconst x = 2;\n";

  it("replace-block swaps the whole brace block at the anchor", () => {
    const out = applyEdits(src, [{ kind: "replace-block", at: 1, lines: ["function f() { return 42; }"] }]);
    expect(out).toBe("function f() { return 42; }\nconst x = 2;\n");
  });

  it("delete-block removes the whole block", () => {
    const out = applyEdits(src, [{ kind: "delete-block", at: 1 }]);
    expect(out).toBe("const x = 2;\n");
  });
});
