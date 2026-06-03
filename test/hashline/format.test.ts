import { describe, it, expect } from "vitest";
import {
  computeFileHash,
  normalizeFileHashText,
  formatHeader,
  formatLine,
} from "../../.pi/extensions/meeagent/hashline/format.js";

describe("computeFileHash", () => {
  it("returns a 4-char uppercase hex tag", () => {
    expect(computeFileHash("hello\nworld\n")).toMatch(/^[0-9A-F]{4}$/);
  });
  it("is deterministic", () => {
    expect(computeFileHash("a\nb")).toBe(computeFileHash("a\nb"));
  });
  it("ignores trailing whitespace and CR (display-trim safe)", () => {
    expect(computeFileHash("a   \nb\t\n")).toBe(computeFileHash("a\nb\n"));
    expect(computeFileHash("a\r\nb\r\n")).toBe(computeFileHash("a\nb\n"));
  });
  it("changes when real content changes", () => {
    expect(computeFileHash("a\nb")).not.toBe(computeFileHash("a\nc"));
  });
  it("handles content longer than the 16-byte block (exercises the main loop)", () => {
    const long = "const value = computeSomethingExpensive(argument);\n".repeat(8);
    expect(computeFileHash(long)).toMatch(/^[0-9A-F]{4}$/);
    expect(computeFileHash(long)).toBe(computeFileHash(long));
  });
});

describe("normalizeFileHashText", () => {
  it("strips only trailing horizontal ws / CR per line", () => {
    expect(normalizeFileHashText("  x  \r\n y \n")).toBe("  x\n y\n");
  });
});

describe("formatters", () => {
  it("formats the section header ¶PATH#TAG", () => {
    expect(formatHeader("src/a.ts", "A1B2")).toBe("¶src/a.ts#A1B2");
  });
  it("formats a numbered line LINE:TEXT", () => {
    expect(formatLine(2, "  msg = x")).toBe("2:  msg = x");
  });
});
