import { describe, it, expect } from "vitest";
import { parseSignal, formatSignal, type TaskSignal } from "../../.pi/extensions/meeagent/workflow/signal.js";

describe("compressed task signal", () => {
  it("parses a fenced signal block with a changed_files list", () => {
    const text = [
      "RED→GREEN→REFACTOR done.",
      "[[TASK-COMPLETE]]",
      "```signal",
      "status: complete",
      "changed_files:",
      "- src/a.ts",
      "- src/b.ts",
      "summary: add foo() and wire it into bar",
      "blockers: none",
      "next: hook foo into the CLI",
      "```",
    ].join("\n");
    expect(parseSignal(text)).toEqual<TaskSignal>({
      status: "complete",
      changedFiles: ["src/a.ts", "src/b.ts"],
      summary: "add foo() and wire it into bar",
      blockers: [],
      next: "hook foo into the CLI",
    });
  });

  it("treats `none` blockers/next as empty and defaults next to none", () => {
    const text = "```signal\nstatus: blocked\nchanged_files:\nsummary: stuck\nblockers: needs API key\n```";
    expect(parseSignal(text)).toEqual<TaskSignal>({
      status: "blocked",
      changedFiles: [],
      summary: "stuck",
      blockers: ["needs API key"],
      next: "none",
    });
  });

  it("parses bare labelled lines without a fence", () => {
    const sig = parseSignal("status: failed\nsummary: tests red\nblockers: none\nnext: none");
    expect(sig?.status).toBe("failed");
    expect(sig?.summary).toBe("tests red");
  });

  it("coerces an unknown status to complete", () => {
    expect(parseSignal("status: done\nsummary: x")?.status).toBe("complete");
  });

  it("returns undefined when no signal keys are present", () => {
    expect(parseSignal("just some prose with no schema")).toBeUndefined();
    expect(parseSignal("```signal\n(empty)\n```")).toBeUndefined();
  });

  it("round-trips through formatSignal", () => {
    const sig: TaskSignal = {
      status: "complete",
      changedFiles: ["x.ts"],
      summary: "did the thing",
      blockers: [],
      next: "none",
    };
    const reparsed = parseSignal(formatSignal(sig));
    expect(reparsed).toEqual(sig);
  });
});
