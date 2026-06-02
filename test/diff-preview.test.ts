import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEditDiff, buildWriteDiff, applyEdits } from "../.pi/extensions/meeagent/diff-preview.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "meeagent-"));
}

describe("applyEdits", () => {
  it("applies sequential oldText->newText replacements", () => {
    const out = applyEdits("const y = 2;\n", [{ oldText: "2", newText: "42" }]);
    expect(out).toBe("const y = 42;\n");
  });
});

describe("buildEditDiff", () => {
  it("produces a unified diff for an existing file", async () => {
    const dir = tmp();
    try {
      writeFileSync(join(dir, "a.ts"), "const x = 1;\nconst y = 2;\n");
      const diff = await buildEditDiff("a.ts", [{ oldText: "2", newText: "42" }], dir);
      expect(diff).toContain("-const y = 2;");
      expect(diff).toContain("+const y = 42;");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("buildWriteDiff", () => {
  it("diffs against empty for a new file", async () => {
    const dir = tmp();
    try {
      const diff = await buildWriteDiff("new.ts", "hello\n", dir);
      expect(diff).toContain("+hello");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
