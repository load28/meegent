import { describe, it, expect } from "vitest";
import { synthesizeGlobal } from "../../.pi/extensions/meeagent/memory/synthesize.js";

describe("synthesizeGlobal", () => {
  it("rewrites global memory from project memories via the LLM", async () => {
    let store = "old global";
    const result = await synthesizeGlobal({
      projectMemories: ["- Uses Vue Router", "- Uses React Router"],
      currentGlobal: store,
      maxChars: 8000,
      runLLM: async (_s, user) => {
        expect(user).toContain("Vue Router");
        return "- Routing approach varies per framework; learn the project's router first";
      },
      writeGlobal: (c) => { store = c; },
    });
    expect(store).toContain("Routing approach varies");
    expect(result.updated).toBe(true);
  });

  it("skips when there are no project memories", async () => {
    const result = await synthesizeGlobal({
      projectMemories: [], currentGlobal: "g", maxChars: 8000,
      runLLM: async () => "x", writeGlobal: () => {},
    });
    expect(result.updated).toBe(false);
  });
});
