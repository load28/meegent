import { describe, it, expect } from "vitest";
import { createWorkflowState, type Phase } from "../../.pi/extensions/meeagent/workflow/state.js";

describe("workflow-state", () => {
  it("starts idle at task 0", () => {
    const s = createWorkflowState();
    expect(s.phase()).toBe<Phase>("idle");
    expect(s.taskIndex()).toBe(0);
  });

  it("advances through the happy path idle->brainstorm->plan->execute->review", () => {
    const s = createWorkflowState();
    s.setPhase("brainstorm");
    s.setPhase("plan");
    s.setPhase("execute");
    s.setPhase("review");
    expect(s.phase()).toBe("review");
  });

  it("nextTask() increments the task index", () => {
    const s = createWorkflowState();
    expect(s.taskIndex()).toBe(0);
    s.nextTask();
    expect(s.taskIndex()).toBe(1);
    s.nextTask();
    expect(s.taskIndex()).toBe(2);
  });

  it("reset() returns to idle at task 0", () => {
    const s = createWorkflowState();
    s.setPhase("execute");
    s.nextTask();
    s.reset();
    expect(s.phase()).toBe("idle");
    expect(s.taskIndex()).toBe(0);
  });

  it("notifies subscribers on phase change with (next, prev)", () => {
    const s = createWorkflowState();
    const calls: Array<[Phase, Phase]> = [];
    s.onPhaseChange((next, prev) => calls.push([next, prev]));
    s.setPhase("brainstorm");
    s.setPhase("plan");
    expect(calls).toEqual([
      ["brainstorm", "idle"],
      ["plan", "brainstorm"],
    ]);
  });

  it("setPhase() to the same phase does not notify", () => {
    const s = createWorkflowState();
    let n = 0;
    s.onPhaseChange(() => n++);
    s.setPhase("idle");
    expect(n).toBe(0);
  });
});
