import { describe, it, expect } from "vitest";
import { buildView } from "../../.pi/extensions/meeagent/hashline/view.js";
import { preparePatch } from "../../.pi/extensions/meeagent/hashline/patch.js";

/**
 * End-to-end contract the model relies on: read the anchor view, copy its ¶path#TAG into a patch,
 * apply it, and have the just-used tag go stale (forcing re-ground on the next edit).
 */
describe("hashline round-trip", () => {
  it("read-view tag → patch applies → old tag is stale afterwards", () => {
    const path = "greet.ts";
    let disk = "export function greet(name: string) {\n  return `Hi ${name}`;\n}\n";

    // 1. Model "reads" the file and sees the anchor view.
    const view = buildView(path, disk);
    const tag = view.split("\n")[0].split("#")[1]; // ¶greet.ts#TAG → TAG
    expect(view).toContain(`2:  return \`Hi \${name}\`;`);

    // 2. Model authors a patch anchored on that tag + line numbers.
    const patch =
      `*** Begin Patch\n¶${path}#${tag}\n` +
      `replace 2..2:\n+  return \`Hello, \${name}!\`;\n` +
      `*** End Patch\n`;

    const res = preparePatch(patch, () => disk);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    disk = res.files[0].newContent;
    expect(disk).toBe("export function greet(name: string) {\n  return `Hello, ${name}!`;\n}\n");

    // 3. The response carries a fresh, different tag (re-ground signal).
    const newTag = res.files[0].newView.split("\n")[0].split("#")[1];
    expect(newTag).not.toBe(tag);

    // 4. Reusing the now-dead tag is rejected before applying.
    const stale = preparePatch(`*** Begin Patch\n¶${path}#${tag}\ndelete 1\n*** End Patch\n`, () => disk);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error).toMatch(/changed between read and edit/);
  });
});
