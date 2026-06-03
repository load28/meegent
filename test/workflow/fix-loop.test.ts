import { describe, it, expect } from "vitest";
import {
  decideReviewOutcome,
  type ReviewOutcome,
} from "../../.pi/extensions/meeagent/workflow/gate.js";

/**
 * Integration-style simulation of the setup-workflow execute⇄review fix-loop,
 * built from the exact pure pieces the orchestration drives (decideReviewOutcome
 * + the retriesUsed / taskIndex counters it keeps). Verifies advancement, the
 * retry cap, escalation (halt), and per-task budget reset — the runtime paths
 * that previously had no coverage.
 */
function runLoop(verdicts: boolean[], maxRetries: number) {
  let retriesUsed = 0;
  let taskIndex = 0;
  const trace: ReviewOutcome[] = [];
  for (const pass of verdicts) {
    const outcome = decideReviewOutcome(pass, retriesUsed, maxRetries);
    trace.push(outcome);
    if (outcome === "advance") {
      taskIndex++;
      retriesUsed = 0; // fresh budget for the next task
    } else if (outcome === "retry") {
      retriesUsed++;
    } else {
      break; // halt — auto-loop stops, human takes over
    }
  }
  return { trace, taskIndex, retriesUsed };
}

describe("workflow fix-loop (orchestration simulation)", () => {
  it("advances and resets the retry budget on consecutive passes", () => {
    const r = runLoop([true, true], 3);
    expect(r.trace).toEqual(["advance", "advance"]);
    expect(r.taskIndex).toBe(2);
    expect(r.retriesUsed).toBe(0);
  });

  it("retries up to the cap then halts (escalates) on persistent failure", () => {
    const r = runLoop([false, false, false, false], 3);
    expect(r.trace).toEqual(["retry", "retry", "retry", "halt"]);
    expect(r.taskIndex).toBe(0); // never advanced — no runaway premium reviews
  });

  it("a fix that lands within budget advances and clears retries for the next task", () => {
    const r = runLoop([false, false, true, false], 3);
    expect(r.trace).toEqual(["retry", "retry", "advance", "retry"]);
    expect(r.taskIndex).toBe(1);
    expect(r.retriesUsed).toBe(1); // next task started fresh, then failed once
  });

  it("with zero retries allowed, a single failure halts immediately", () => {
    const r = runLoop([false], 0);
    expect(r.trace).toEqual(["halt"]);
    expect(r.taskIndex).toBe(0);
  });
});
