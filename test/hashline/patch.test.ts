import { describe, it, expect } from "vitest";
import { preparePatch } from "../../.pi/extensions/meeagent/hashline/patch.js";
import { computeFileHash } from "../../.pi/extensions/meeagent/hashline/format.js";

const file = "L1\nL2\nL3\n";
const tag = computeFileHash(file);

describe("preparePatch", () => {
  it("applies when the tag matches and returns new content + refreshed view", () => {
    const patch = `*** Begin Patch\n¶a.ts#${tag}\nreplace 2..2:\n+X\n*** End Patch\n`;
    const res = preparePatch(patch, () => file);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.files[0].newContent).toBe("L1\nX\nL3\n");
      expect(res.files[0].newView.split("\n")[0]).toMatch(/^¶a\.ts#[0-9A-F]{4}$/);
      expect(res.files[0].newView).toContain("2:X");
    }
  });

  it("rejects a stale tag before applying", () => {
    const patch = `*** Begin Patch\n¶a.ts#0000\ndelete 1\n*** End Patch\n`;
    const res = preparePatch(patch, () => file);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/changed|stale|hash|re-read/i);
  });

  it("reports a file-not-found error", () => {
    const patch = `*** Begin Patch\n¶missing.ts#0000\ndelete 1\n*** End Patch\n`;
    const res = preparePatch(patch, () => { throw new Error("ENOENT"); });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not found|write/i);
  });

  it("reports a parse error", () => {
    const res = preparePatch("garbage", () => file);
    expect(res.ok).toBe(false);
  });
});
