import { describe, it, expect } from "vitest";
import { createModeState, type PermissionMode } from "../.pi/extensions/meeagent/mode-state.js";

describe("mode-state", () => {
  it("defaults to 'default'", () => {
    const s = createModeState();
    expect(s.current()).toBe<PermissionMode>("default");
  });

  it("cycles default -> acceptEdits -> plan -> default", () => {
    const s = createModeState();
    expect(s.cycle()).toBe("acceptEdits");
    expect(s.cycle()).toBe("plan");
    expect(s.cycle()).toBe("default");
  });

  it("set() jumps to a specific mode", () => {
    const s = createModeState();
    s.set("plan");
    expect(s.current()).toBe("plan");
  });

  it("notifies subscribers on cycle and set with (next, prev)", () => {
    const s = createModeState();
    const calls: Array<[PermissionMode, PermissionMode]> = [];
    s.onChange((next, prev) => calls.push([next, prev]));
    s.cycle();              // default -> acceptEdits
    s.set("default");       // acceptEdits -> default
    expect(calls).toEqual([
      ["acceptEdits", "default"],
      ["default", "acceptEdits"],
    ]);
  });

  it("set() to the same mode does not notify", () => {
    const s = createModeState();
    let n = 0;
    s.onChange(() => n++);
    s.set("default");
    expect(n).toBe(0);
  });
});
