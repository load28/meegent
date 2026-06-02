import { describe, it, expect } from "vitest";
import { parseFacts, type Fact } from "../../.pi/extensions/meeagent/memory/facts.js";

describe("parseFacts", () => {
  it("parses [project] and [global] tagged lines", () => {
    const out = `[project] Uses Vue Router for routing
[global] Prefers functional composition over inheritance
ignored line without tag`;
    expect(parseFacts(out)).toEqual<Fact[]>([
      { scope: "project", text: "Uses Vue Router for routing" },
      { scope: "global", text: "Prefers functional composition over inheritance" },
    ]);
  });
  it("trims and skips empty facts", () => {
    expect(parseFacts("[project]   \n[global] x")).toEqual<Fact[]>([{ scope: "global", text: "x" }]);
  });
  it("is case-insensitive on the tag", () => {
    expect(parseFacts("[PROJECT] y")).toEqual<Fact[]>([{ scope: "project", text: "y" }]);
  });
});
