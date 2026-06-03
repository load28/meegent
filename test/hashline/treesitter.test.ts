import { describe, it, expect } from "vitest";
import { ensureLanguage } from "../../.pi/extensions/meeagent/hashline/treesitter.js";
import { resolveBlock, resolveBlockHeuristic } from "../../.pi/extensions/meeagent/hashline/block.js";

const toLines = (s: string) => s.replace(/\n$/, "").split("\n");

describe("tree-sitter block resolution", () => {
  it("resolves a TS function block correctly where the brace heuristic is fooled by a brace in a string", async () => {
    const ok = await ensureLanguage("x.ts");
    expect(ok).toBe(true);
    const lines = toLines('function f() {\n  const s = "}";\n  return s;\n}\nconst x = 1;\n');

    // Heuristic stops early at the string brace on line 2.
    expect(resolveBlockHeuristic(lines, 1)).toEqual({ start: 1, end: 2 });
    // Tree-sitter matches the real closing brace on line 4.
    expect(resolveBlock(lines, 1, "x.ts")).toEqual({ start: 1, end: 4 });
  });

  it("resolves a Python def block via tree-sitter", async () => {
    expect(await ensureLanguage("a.py")).toBe(true);
    const lines = toLines("def greet(name):\n    msg = name\n    print(msg)\nother()\n");
    expect(resolveBlock(lines, 1, "a.py")).toEqual({ start: 1, end: 3 });
  });

  it("falls back to the heuristic for an unsupported extension", async () => {
    expect(await ensureLanguage("notes.txt")).toBe(false);
    const lines = toLines("a {\n  b\n}\nc\n");
    expect(resolveBlock(lines, 1, "notes.txt")).toEqual(resolveBlockHeuristic(lines, 1));
  });
});
