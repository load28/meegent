import { describe, it, expect } from "vitest";
import { resolveBlock } from "../../.pi/extensions/meeagent/hashline/block.js";

const toLines = (s: string) => s.replace(/\n$/, "").split("\n");

describe("resolveBlock", () => {
  it("matches a brace block from its opening line to the closer", () => {
    const lines = toLines("function f() {\n  const a = 1;\n  return a;\n}\nconst x = 2;\n");
    expect(resolveBlock(lines, 1)).toEqual({ start: 1, end: 4 });
  });

  it("handles nested braces", () => {
    const lines = toLines("if (a) {\n  while (b) {\n    c();\n  }\n}\nafter();\n");
    expect(resolveBlock(lines, 1)).toEqual({ start: 1, end: 5 });
  });

  it("resolves an indentation block (Python-style)", () => {
    const lines = toLines("def greet(name):\n    msg = name\n    print(msg)\nother()\n");
    expect(resolveBlock(lines, 1)).toEqual({ start: 1, end: 3 });
  });

  it("includes interior blank lines but trims trailing ones in an indentation block", () => {
    const lines = toLines("def f():\n    a = 1\n\n    b = 2\n\ntop()\n");
    expect(resolveBlock(lines, 1)).toEqual({ start: 1, end: 4 });
  });

  it("throws when the start line is out of bounds", () => {
    expect(() => resolveBlock(["a"], 5)).toThrow(/bound/i);
  });
});
