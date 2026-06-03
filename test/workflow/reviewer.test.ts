import { describe, it, expect } from "vitest";
import { parseVerdict } from "../../.pi/extensions/meeagent/workflow/reviewer.js";

describe("workflow-reviewer parseVerdict", () => {
  it("treats no issues as a pass", () => {
    const v = parseVerdict("Looks good. VERDICT: PASS");
    expect(v.pass).toBe(true);
    expect(v.severity).toBe("None");
    expect(v.issues).toEqual([]);
  });

  it("a Critical issue blocks (fail) and is captured", () => {
    const v = parseVerdict("- [Critical] SQL injection in query builder\n- [Minor] rename var");
    expect(v.pass).toBe(false);
    expect(v.severity).toBe("Critical");
    expect(v.issues).toEqual([
      { severity: "Critical", text: "SQL injection in query builder" },
      { severity: "Minor", text: "rename var" },
    ]);
  });

  it("an Important issue blocks but ranks below Critical", () => {
    const v = parseVerdict("[Important] missing error handling for empty input");
    expect(v.pass).toBe(false);
    expect(v.severity).toBe("Important");
  });

  it("only Minor issues still pass", () => {
    const v = parseVerdict("[Minor] add a comment here");
    expect(v.pass).toBe(true);
    expect(v.severity).toBe("Minor");
  });

  it("is case-insensitive on severity tags", () => {
    const v = parseVerdict("[critical] boom");
    expect(v.pass).toBe(false);
    expect(v.severity).toBe("Critical");
  });
});
