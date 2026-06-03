import { describe, it, expect } from "vitest";
import { createSnapshotStore } from "../../.pi/extensions/meeagent/hashline/snapshots.js";
import { computeFileHash } from "../../.pi/extensions/meeagent/hashline/format.js";

describe("snapshot store", () => {
  it("records content and looks it up by its computed tag", () => {
    const s = createSnapshotStore();
    const content = "a\nb\nc\n";
    s.record("x.ts", content);
    expect(s.lookup("x.ts", computeFileHash(content))).toBe(content);
  });

  it("returns undefined for an unknown tag or path", () => {
    const s = createSnapshotStore();
    s.record("x.ts", "a\n");
    expect(s.lookup("x.ts", "0000")).toBeUndefined();
    expect(s.lookup("other.ts", computeFileHash("a\n"))).toBeUndefined();
  });

  it("evicts the oldest entry past the bound", () => {
    const s = createSnapshotStore(2);
    s.record("a", "1\n");
    s.record("b", "2\n");
    s.record("c", "3\n"); // evicts "a"
    expect(s.lookup("a", computeFileHash("1\n"))).toBeUndefined();
    expect(s.lookup("c", computeFileHash("3\n"))).toBe("3\n");
  });
});
