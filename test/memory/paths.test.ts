import { describe, it, expect } from "vitest";
import { projectKey, globalDir, projectDir, paths, MEMORY_MAX_CHARS } from "../../.pi/extensions/meeagent/memory/paths.js";

describe("projectKey", () => {
  it("sanitizes an absolute path to a stable key", () => {
    expect(projectKey("/Users/me/Downloads/source/tooday")).toBe("Users-me-Downloads-source-tooday");
  });
  it("collapses non-alphanumerics and trims separators", () => {
    expect(projectKey("/a/b.c/d_e")).toBe("a-b-c-d-e");
  });
});

describe("paths", () => {
  it("builds global and project file paths under root", () => {
    const p = paths("/root", "/Users/me/proj");
    expect(p.globalMemory).toBe("/root/global/MEMORY.md");
    expect(p.projectMemory).toBe("/root/projects/Users-me-proj/MEMORY.md");
    expect(p.projectLogDir).toBe("/root/projects/Users-me-proj/logs");
    expect(p.state).toBe("/root/state.json");
  });
  it("exposes a memory size cap", () => {
    expect(MEMORY_MAX_CHARS).toBeGreaterThan(0);
  });
});
