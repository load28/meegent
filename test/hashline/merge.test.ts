import { describe, it, expect } from "vitest";
import { threeWayMerge } from "../../.pi/extensions/meeagent/hashline/merge.js";

describe("threeWayMerge", () => {
  const base = "line A\nline B\nline C\nline D\n";

  it("lands the model's edit on a file that drifted elsewhere", () => {
    // Model changed B→B2 against base; meanwhile disk gained a new top line (drift far from the edit).
    const intended = "line A\nline B2\nline C\nline D\n";
    const current = "HEADER\nline A\nline B\nline C\nline D\n";
    const res = threeWayMerge(base, current, intended);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.content).toBe("HEADER\nline A\nline B2\nline C\nline D\n");
  });

  it("fails when the drift overlaps the edited region", () => {
    const intended = "line A\nline B2\nline C\nline D\n";
    const current = "line A\nline B-CHANGED\nline C\nline D\n"; // same line the model edited changed on disk
    const res = threeWayMerge(base, current, intended);
    expect(res.ok).toBe(false);
  });
});
