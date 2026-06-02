import { describe, it, expect } from "vitest";
import { extractSessionSummary } from "../../.pi/extensions/meeagent/memory/extract.js";

describe("extractSessionSummary", () => {
  it("collects user request text and edited file paths", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "add routing to the app" }] },
      { role: "assistant", content: [
        { type: "text", text: "I'll edit the router." },
        { type: "toolCall", name: "edit", input: { path: "src/router.ts" } },
      ] },
      { role: "toolResult", toolName: "edit" },
    ];
    const out = extractSessionSummary(messages as never);
    expect(out).toContain("User: add routing to the app");
    expect(out).toContain("Edited: src/router.ts");
  });

  it("returns empty string when there is nothing to record", () => {
    expect(extractSessionSummary([] as never)).toBe("");
  });

  it("ignores non-edit/write tool calls for the edited list", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "list files" }] },
      { role: "assistant", content: [{ type: "toolCall", name: "ls", input: { path: "." } }] },
    ];
    const out = extractSessionSummary(messages as never);
    expect(out).toContain("User: list files");
    expect(out).not.toContain("Edited:");
  });
});
