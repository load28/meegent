import { describe, it, expect } from "vitest";
import { isDistillDue } from "../../.pi/extensions/meeagent/memory/schedule.js";

const cfg = { threshold: 3, intervalMs: 1000 };

describe("isDistillDue", () => {
  it("is due when undistilled logs reach the threshold", () => {
    expect(isDistillDue({ lastDistillTs: 0, undistilledLogCount: 3 }, 1, cfg)).toBe(true);
  });
  it("is due when the interval has elapsed and there is at least one log", () => {
    expect(isDistillDue({ lastDistillTs: 0, undistilledLogCount: 1 }, 2000, cfg)).toBe(true);
  });
  it("is not due with no logs even past the interval", () => {
    expect(isDistillDue({ lastDistillTs: 0, undistilledLogCount: 0 }, 999999, cfg)).toBe(false);
  });
  it("is not due below threshold and within interval", () => {
    expect(isDistillDue({ lastDistillTs: 500, undistilledLogCount: 1 }, 600, cfg)).toBe(false);
  });
  it("is due exactly at the interval boundary", () => {
    expect(isDistillDue({ lastDistillTs: 0, undistilledLogCount: 1 }, 1000, cfg)).toBe(true);
  });
});
