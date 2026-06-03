import { describe, it, expect } from "vitest";
import { parsePatch, type ParsedSection } from "../../.pi/extensions/meeagent/hashline/parse.js";

const wrap = (body: string) => `*** Begin Patch\n${body}\n*** End Patch\n`;

describe("parsePatch", () => {
  it("parses replace/insert/delete with +TEXT bodies", () => {
    const out = parsePatch(wrap(
      "¶a.ts#A1B2\n" +
      "insert after 1:\n+  hi\n" +
      "replace 2..3:\n+  x\n+  y\n" +
      "delete 4"
    ));
    const s = out.sections[0] as ParsedSection;
    expect(s.path).toBe("a.ts");
    expect(s.tag).toBe("A1B2");
    expect(s.edits).toEqual([
      { kind: "insert", pos: { type: "after", line: 1 }, lines: ["  hi"] },
      { kind: "replace", start: 2, end: 3, lines: ["  x", "  y"] },
      { kind: "delete", start: 4, end: 4 },
    ]);
  });

  it("treats bare + as a blank line and unescapes ++ / +-", () => {
    const out = parsePatch(wrap("¶a#0000\ninsert head:\n+\n++keep plus\n+-keep dash"));
    expect((out.sections[0].edits[0] as Extract<ParsedSection["edits"][number], { kind: "insert" }>).lines)
      .toEqual(["", "+keep plus", "-keep dash"]);
  });

  it("parses a single-line delete and head/tail inserts", () => {
    const out = parsePatch(wrap("¶a#0000\ndelete 5\ninsert tail:\n+end"));
    expect(out.sections[0].edits).toEqual([
      { kind: "delete", start: 5, end: 5 },
      { kind: "insert", pos: { type: "tail" }, lines: ["end"] },
    ]);
  });

  it("parses replace block and delete block ops", () => {
    const out = parsePatch(wrap("¶a#0000\nreplace block 3:\n+  new body\ndelete block 10"));
    expect(out.sections[0].edits).toEqual([
      { kind: "replace-block", at: 3, lines: ["  new body"] },
      { kind: "delete-block", at: 10 },
    ]);
  });

  it("errors on a -old / context body row", () => {
    expect(() => parsePatch(wrap("¶a#0000\nreplace 1..1:\n-old"))).toThrow(/body row|Unrecognized/i);
  });

  it("errors without the Begin/End envelope", () => {
    expect(() => parsePatch("¶a#0000\ndelete 1")).toThrow(/Begin Patch/);
  });
});
