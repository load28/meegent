import { describe, it, expect } from "vitest";
import { buildView } from "../../.pi/extensions/meeagent/hashline/view.js";

describe("buildView", () => {
  const content = "def greet(name):\n    msg = name\n    print(msg)\n";

  it("renders header + all numbered lines", () => {
    const out = buildView("greet.py", content);
    expect(out.split("\n")[0]).toMatch(/^¶greet\.py#[0-9A-F]{4}$/);
    expect(out).toContain("1:def greet(name):");
    expect(out).toContain("3:    print(msg)");
  });

  it("honors offset/limit but keeps absolute numbers and whole-file tag", () => {
    const full = buildView("greet.py", content);
    const tag = full.split("\n")[0];
    const out = buildView("greet.py", content, 2, 1); // line 2 only
    expect(out.split("\n")[0]).toBe(tag); // same whole-file tag
    expect(out).toContain("2:    msg = name");
    expect(out).not.toContain("1:def greet");
    expect(out).not.toContain("3:    print");
  });

  it("handles a file without a trailing newline", () => {
    const out = buildView("a.txt", "only line");
    expect(out).toBe(out.split("\n")[0] + "\n1:only line");
  });
});
