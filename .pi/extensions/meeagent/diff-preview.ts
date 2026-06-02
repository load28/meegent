import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createTwoFilesPatch } from "diff";

export interface EditOp {
  oldText: string;
  newText: string;
}

/** Apply sequential exact-text replacements (preview-only; pi's edit tool is authoritative). */
export function applyEdits(content: string, edits: EditOp[]): string {
  let out = content;
  for (const { oldText, newText } of edits) {
    out = out.replace(oldText, newText);
  }
  return out;
}

async function readOrEmpty(absPath: string): Promise<string> {
  try {
    return await readFile(absPath, "utf8");
  } catch {
    return "";
  }
}

/** Drop the `Index:`/`===` preamble createTwoFilesPatch emits, keeping ---/+++/@@/± lines. */
function stripPreamble(patch: string): string {
  return patch
    .split("\n")
    .filter((l) => !l.startsWith("Index: ") && !/^=+$/.test(l))
    .join("\n");
}

/** Unified diff for an `edit` tool call, computed before applying. */
export async function buildEditDiff(path: string, edits: EditOp[], cwd: string): Promise<string> {
  const abs = resolve(cwd, path.replace(/^@/, ""));
  const before = await readOrEmpty(abs);
  const after = applyEdits(before, edits);
  return stripPreamble(createTwoFilesPatch(path, path, before, after, "", "", { context: 3 }));
}

/** Unified diff for a `write` tool call, computed before applying. */
export async function buildWriteDiff(path: string, content: string, cwd: string): Promise<string> {
  const abs = resolve(cwd, path.replace(/^@/, ""));
  const before = await readOrEmpty(abs);
  return stripPreamble(createTwoFilesPatch(path, path, before, content, "", "", { context: 3 }));
}
