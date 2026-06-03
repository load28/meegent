import { describe, it, expect } from "vitest";
import {
  designPath,
  planPath,
  slug,
  parseTasks,
  markDone,
  firstUndoneIndex,
} from "../../.pi/extensions/meeagent/workflow/docs.js";

describe("workflow-docs", () => {
  it("builds the Superpowers design/plan paths", () => {
    expect(designPath("2026-06-03", "Token Cost")).toBe(
      "docs/superpowers/specs/2026-06-03-token-cost-design.md",
    );
    expect(planPath("2026-06-03", "Token Cost")).toBe(
      "docs/superpowers/plans/2026-06-03-token-cost.md",
    );
  });

  it("slugifies topics (lowercase, spaces->dashes, strip junk)", () => {
    expect(slug("Hello World!")).toBe("hello-world");
    expect(slug("  A/B  test ")).toBe("a-b-test");
  });

  it("parses task checkboxes into index/title/done", () => {
    const md = [
      "# Plan",
      "- [ ] First task",
      "some prose",
      "- [x] Second task",
      "- [ ] Third task",
    ].join("\n");
    expect(parseTasks(md)).toEqual([
      { index: 0, title: "First task", done: false },
      { index: 1, title: "Second task", done: true },
      { index: 2, title: "Third task", done: false },
    ]);
  });

  it("markDone() checks the nth task box, leaving others intact", () => {
    const md = ["- [ ] one", "- [ ] two", "- [ ] three"].join("\n");
    const out = markDone(md, 1);
    expect(out).toBe(["- [ ] one", "- [x] two", "- [ ] three"].join("\n"));
  });

  it("markDone() is a no-op when the task is already done", () => {
    const md = ["- [x] one", "- [ ] two"].join("\n");
    expect(markDone(md, 0)).toBe(md);
  });

  it("firstUndoneIndex() resumes at the first unchecked task", () => {
    expect(
      firstUndoneIndex([
        { index: 0, title: "a", done: true },
        { index: 1, title: "b", done: true },
        { index: 2, title: "c", done: false },
      ]),
    ).toBe(2);
  });

  it("firstUndoneIndex() returns task count when every task is done", () => {
    expect(
      firstUndoneIndex([
        { index: 0, title: "a", done: true },
        { index: 1, title: "b", done: true },
      ]),
    ).toBe(2);
  });

  it("firstUndoneIndex() is 0 for an empty or all-undone plan", () => {
    expect(firstUndoneIndex([])).toBe(0);
    expect(firstUndoneIndex([{ index: 0, title: "a", done: false }])).toBe(0);
  });
});
