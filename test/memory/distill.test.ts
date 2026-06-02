import { describe, it, expect } from "vitest";
import { distillProject } from "../../.pi/extensions/meeagent/memory/distill.js";

describe("distillProject", () => {
  it("routes project facts to project memory and global facts to global memory", async () => {
    const memories: Record<string, string> = { "/proj/MEMORY.md": "", "/global/MEMORY.md": "" };
    const runLLM = async () => "[project] Uses GraphQL API\n[global] Likes testcontainers";
    const result = await distillProject({
      rawLogs: "User: add a query",
      projectMemoryFile: "/proj/MEMORY.md",
      globalMemoryFile: "/global/MEMORY.md",
      maxChars: 8000,
      runLLM,
      read: (f) => memories[f] ?? "",
      write: (f, c) => { memories[f] = c; },
    });
    expect(memories["/proj/MEMORY.md"]).toContain("Uses GraphQL API");
    expect(memories["/global/MEMORY.md"]).toContain("Likes testcontainers");
    expect(result.factCount).toBe(2);
  });

  it("does nothing and reports zero when raw logs are empty", async () => {
    let called = false;
    const result = await distillProject({
      rawLogs: "   ",
      projectMemoryFile: "/p", globalMemoryFile: "/g", maxChars: 8000,
      runLLM: async () => { called = true; return ""; },
      read: () => "", write: () => {},
    });
    expect(called).toBe(false);
    expect(result.factCount).toBe(0);
  });
});
