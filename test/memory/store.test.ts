import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMemory, writeMemory, appendRawLog, readState, writeState } from "../../.pi/extensions/meeagent/memory/store.js";

function tmp() { return mkdtempSync(join(tmpdir(), "mee-store-")); }

describe("memory file IO", () => {
  it("returns empty string for a missing MEMORY file", () => {
    const dir = tmp();
    try { expect(readMemory(join(dir, "nope.md"))).toBe(""); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("writes then reads MEMORY, creating parent dirs", () => {
    const dir = tmp();
    try {
      const f = join(dir, "a/b/MEMORY.md");
      writeMemory(f, "hello");
      expect(readMemory(f)).toBe("hello");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("appends raw log lines under a dated file", () => {
    const dir = tmp();
    try {
      appendRawLog(dir, "2026-06-02", "first");
      appendRawLog(dir, "2026-06-02", "second");
      const body = readFileSync(join(dir, "2026-06-02.md"), "utf8");
      expect(body).toContain("first");
      expect(body).toContain("second");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("state IO", () => {
  it("returns a default state when file missing", () => {
    const dir = tmp();
    try { expect(readState(join(dir, "state.json"))).toEqual({ projects: {}, globalLastSynthTs: 0 }); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("round-trips state", () => {
    const dir = tmp();
    try {
      const f = join(dir, "state.json");
      writeState(f, { projects: { k: { lastDistillTs: 5, undistilledLogCount: 2 } }, globalLastSynthTs: 9 });
      expect(readState(f)).toEqual({ projects: { k: { lastDistillTs: 5, undistilledLogCount: 2 } }, globalLastSynthTs: 9 });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
