import { describe, it, expect } from "vitest";
import {
  isDocPath,
  isTaskComplete,
  decideReviewOutcome,
  TASK_COMPLETE_MARKER,
  lastAssistantText,
} from "../../.pi/extensions/meeagent/workflow/gate.js";

describe("workflow gate — HARD-GATE doc-path allow-list", () => {
  it("allows design/plan docs under docs/superpowers", () => {
    expect(isDocPath("docs/superpowers/specs/2026-06-03-x-design.md")).toBe(true);
    expect(isDocPath("docs/superpowers/plans/2026-06-03-x.md")).toBe(true);
  });

  it("normalizes leading @, ./, and backslashes", () => {
    expect(isDocPath("@docs/superpowers/plans/x.md")).toBe(true);
    expect(isDocPath("./docs/superpowers/specs/x.md")).toBe(true);
    expect(isDocPath("docs\\superpowers\\plans\\x.md")).toBe(true);
  });

  it("blocks code and any non-design doc", () => {
    expect(isDocPath("src/index.ts")).toBe(false);
    expect(isDocPath(".pi/extensions/meeagent/workflow/state.ts")).toBe(false);
    expect(isDocPath("docs/plans/other.md")).toBe(false);
    expect(isDocPath("docs/superpowers/notes.md")).toBe(false);
  });
});

describe("workflow gate — task-completion signal", () => {
  it("detects the explicit task-complete marker", () => {
    expect(isTaskComplete(`done.\n${TASK_COMPLETE_MARKER}`)).toBe(true);
    expect(isTaskComplete("RED added, still working")).toBe(false);
    expect(isTaskComplete("")).toBe(false);
  });
});

describe("workflow gate — review fix-loop cap (escalation)", () => {
  it("advances on a passing review", () => {
    expect(decideReviewOutcome(true, 0, 3)).toBe("advance");
    expect(decideReviewOutcome(true, 5, 3)).toBe("advance");
  });

  it("retries while retries remain", () => {
    expect(decideReviewOutcome(false, 0, 3)).toBe("retry");
    expect(decideReviewOutcome(false, 2, 3)).toBe("retry");
  });

  it("halts (escalate to human) once retries are exhausted", () => {
    expect(decideReviewOutcome(false, 3, 3)).toBe("halt");
    expect(decideReviewOutcome(false, 4, 3)).toBe("halt");
  });

  it("halts immediately when no retries are allowed", () => {
    expect(decideReviewOutcome(false, 0, 0)).toBe("halt");
  });
});

describe("workflow gate — last assistant text extraction", () => {
  it("returns the joined text of the most recent assistant message", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "go" }] },
      { role: "assistant", content: [{ type: "text", text: "first" }] },
      { role: "toolResult", content: [{ type: "text", text: "tool out" }] },
      {
        role: "assistant",
        content: [
          { type: "thinking", text: "hmm" },
          { type: "text", text: "line A" },
          { type: "text", text: "line B" },
        ],
      },
    ];
    expect(lastAssistantText(messages)).toBe("line A\nline B");
  });

  it("returns empty string when there is no assistant text", () => {
    expect(lastAssistantText([{ role: "user", content: [{ type: "text", text: "go" }] }])).toBe("");
    expect(lastAssistantText([])).toBe("");
  });
});
